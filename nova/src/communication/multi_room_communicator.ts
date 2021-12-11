import { isLeft } from "fp-ts/lib/Either";
import * as t from 'io-ts';
import { set } from "nova_ecs/datatypes/set";
import { Communicator, MessageWithSource, Peers } from "nova_ecs/plugins/multiplayer_plugin";
import { DefaultMap, setDifference } from "nova_ecs/utils";
import { BehaviorSubject, EMPTY, Observable, of, Subject } from "rxjs";
import { filter, map, mergeMap, takeUntil, tap } from "rxjs/operators";

const RoomMessage = t.intersection([
    t.type({
        room: t.string,
    }),
    t.partial({
        message: t.unknown,
        peers: set(t.string),
        inRoom: t.boolean,
        getPeers: t.literal(true),
    })
]);
type RoomMessage = t.TypeOf<typeof RoomMessage>;

class RoomCommunicator implements Communicator {
    constructor(private communicator: Communicator,
        public messages: Observable<MessageWithSource<unknown>>,
        public sendMessage: (message: unknown, destination?: string) => void,
        public peers: Peers,
        public servers: BehaviorSubject<Set<string>>) { }
    get uuid() {
        return this.communicator.uuid;
    }
}

export class MultiRoom {
    private roomMap: DefaultMap<string, [Communicator, () => void]>;
    private roomPeers = new DefaultMap<string, Peers>(() =>
        new Peers(new BehaviorSubject(new Set())));

    constructor(private communicator: Communicator) {
        const messages = communicator.messages.pipe(
            map(({ message, source }) => ({
                maybeMessage: RoomMessage.decode(message),
                source,
            })),
            tap(({ maybeMessage }) => {
                if (isLeft(maybeMessage)) {
                    console.warn(`Got invalid message ${JSON.stringify(maybeMessage, undefined, 2)}`);
                }
            }),
            mergeMap(({ maybeMessage, source }) => {
                if (isLeft(maybeMessage)) {
                    return EMPTY;
                } else {
                    return of({
                        message: maybeMessage.right,
                        source
                    })
                }
            }));


        if (communicator.uuid && communicator.servers.value.has(communicator.uuid)) {
            // We are a server. Keep track of all peers for each room.
            messages.pipe(
                filter(({ message }) => 'inRoom' in message)
            ).subscribe(({ message, source }) => {
                const peers = this.roomPeers.get(message.room);
                const currentPeers = new Set([...peers.current.value]);
                if (message.inRoom) {
                    currentPeers.add(source);
                    peers.current.next(currentPeers);
                } else {
                    currentPeers.delete(source);
                    peers.current.next(currentPeers);
                }

                communicator.sendMessage(RoomMessage.encode({
                    room: message.room,
                    peers: currentPeers,
                }), currentPeers);
            });
        }

        communicator.peers.leave.subscribe(peer => {
            for (const [, peers] of this.roomPeers) {
                if (peers.current.value.has(peer)) {
                    const newPeers = new Set([...peers.current.value]);
                    newPeers.delete(peer);
                    peers.current.next(newPeers);
                }
            }
        });

        this.roomMap = new DefaultMap(key => {
            // TODO: Correctly clean up subscriptions
            const finish = new Subject();
            const cleanup = () => {
                finish.next(true);
            }

            const roomMessages = messages.pipe(
                takeUntil(finish),
                filter(({ message }) => message.room === key)
            );

            const peers = this.roomPeers.get(key);
            roomMessages.pipe(
                takeUntil(finish),
                filter(({ message }) => Boolean(message.peers)),
                filter(({ source }) => communicator.servers.value.has(source))
            ).subscribe(({ message }) => {
                peers.current.next(message.peers!);
            });

            return [new RoomCommunicator(
                communicator,
                roomMessages.pipe(
                    takeUntil(finish),
                    filter(({ message }) => 'message' in message),
                    map(({ message, source }) => ({ message: message.message, source }))
                ),
                (message: unknown, destination?: string | Set<string>) => {
                    let destSet: Set<string>;
                    if (destination instanceof Set) {
                        destSet = destination;
                    } else if (typeof destination === 'string') {
                        destSet = new Set([destination]);
                    } else {
                        destSet = new Set(peers.current.value);
                        // Don't send to self
                        destSet.delete(communicator.uuid ?? '');
                    }
                    this.communicator.sendMessage(RoomMessage.encode({
                        message,
                        room: key,
                    }), destSet);
                },
                peers,
                communicator.servers,
            ), cleanup];
        });
    }

    join(room: string) {
        const [communicatorRoom] = this.roomMap.get(room);
        // Notify the server that we are in this room.
        this.communicator.sendMessage(RoomMessage.encode({
            room: room,
            inRoom: true,
        }), [...this.communicator.servers.value][0]);
        return communicatorRoom;
    }

    leave(room: string) {
        // Notify the server that we are not in this room.
        this.communicator.sendMessage(RoomMessage.encode({
            room: room,
            inRoom: false,
        }), [...this.communicator.servers.value][0]);
        const [, cleanup] = this.roomMap.get(room);
        this.roomPeers.delete(room);
        this.roomMap.delete(room)
        if (cleanup) {
            cleanup()
        }
    }
}
