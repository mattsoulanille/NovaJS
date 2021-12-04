import { isLeft } from "fp-ts/lib/Either";
import * as t from 'io-ts';
import { set } from "nova_ecs/datatypes/set";
import { Communicator, MessageWithSource } from "nova_ecs/plugins/multiplayer_plugin";
import { DefaultMap } from "nova_ecs/utils";
import { BehaviorSubject, EMPTY, Observable, of } from "rxjs";
import { filter, map, mergeMap, tap } from "rxjs/operators";

const RoomMessage = t.intersection([
    t.type({
        room: t.string,
    }),
    t.partial({
        message: t.unknown,
        peers: set(t.string),
    })
]);
type RoomMessage = t.TypeOf<typeof RoomMessage>;

class WrappedCommunicator implements Communicator {
    constructor(private communicator: Communicator,
        public messages: Observable<MessageWithSource<unknown>>,
        public sendMessage: (message: unknown, destination?: string) => void,
        public peers: BehaviorSubject<Set<string>>) { }
    get uuid() {
        return this.communicator.uuid;
    }
}

export class MultiRoom {
    private roomMap: DefaultMap<string, Communicator>;

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

        this.roomMap = new DefaultMap(key => new WrappedCommunicator(
            communicator,
            messages.pipe(
                filter(({ message }) => message.room === key),
                map(({ message, source }) => ({ message: message.message, source }))
            ),
            (message: unknown, destination?: string) =>
                this.sendMessage(message, key, destination),
            new BehaviorSubject(new Set<string>())
        ));
    }

    join(room: string) {
        const communicator = this.roomMap.get(room);
        communicator.peers
        return communicator;
    }

    leave(room: string) {

    }

    private sendMessage(message: unknown, room: string, destination?: string) {
        this.communicator.sendMessage(RoomMessage.encode({
            message,
            room
        }), destination);
    }
}
