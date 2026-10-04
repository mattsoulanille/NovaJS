import 'jasmine';
import * as http from 'http';
import { AddressInfo } from 'net';
import { firstValueFrom, filter } from 'rxjs';
import { Communicator, CommunicatorResource } from 'nova_ecs/plugins/multiplayer_plugin';
import { SerializerPlugin } from 'nova_ecs/plugins/serializer_plugin';
import { TimePlugin } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { resetWarnThrottle } from '../common/log_throttle.js';
import { connectUrlWithVersion } from '../common/version_handshake.js';
import { CommunicatorClient } from './communicator_client.js';
import { CommunicatorServer } from './communicator_server.js';
import { MultiRoom } from './multi_room_communicator.js';
import { unwrapRollbackMessage, wrapRollbackMessage } from './rollback_protocol.js';
import { SimulationBridgeHost } from './simulation_bridge_host.js';
import { InputRecord, SimulationInput, SimulationInputType } from './simulation_input.js';
import { SocketChannelClient } from './socket_channel_client.js';
import { SocketChannelServer } from './socket_channel_server.js';
import { UncarriableMessageError } from './wire_send_policy.js';

const BUILD = 'local-input-gate-build';

/**
 * #295: the host runs the wire's own codec on EVERY input it schedules,
 * before applying or publishing it. The authoring host's records never
 * cross the receiving codecs, so an input the wire refuses used to apply
 * on this peer while the room never saw it: the sender's socket threw on
 * it (a hard error in development, a silent drop in production, #272),
 * or the relay's decode dropped it — either way the author diverged from
 * its own input.
 *
 * The matrix pins that the two gates are ONE: for every member of
 * SimulationInputType, valid and invalid, the host's verdict (schedule
 * it, or drop it with a warning naming its kind) equals the real wire's
 * (the live Avro codec over real sockets: the sending socket's encode,
 * then the receiving room's decode and unwrapRollbackMessage — the
 * relay's gate). And what the host applies is exactly what the room
 * receives.
 */
describe('the local input gate', () => {
    let httpServer: http.Server;
    let channel: SocketChannelServer;
    let clientChannel: SocketChannelClient;

    beforeEach(async () => {
        resetWarnThrottle();
        httpServer = http.createServer();
        channel = new SocketChannelServer({
            server: httpServer, buildVersion: BUILD, warn: () => undefined,
        });
        await new Promise<void>(resolve => httpServer.listen(0, () => resolve()));
    });

    afterEach(async () => {
        clientChannel?.disconnect();
        channel.wss.close();
        await new Promise<void>(resolve => httpServer.close(() => resolve()));
    });

    /** A client room joined to a server room over the live binary wire. */
    async function joinedRoom() {
        const port = (httpServer.address() as AddressInfo).port;
        const serverRoom = new MultiRoom(new CommunicatorServer(channel)).join('nova:129');
        clientChannel = new SocketChannelClient({
            webSocketFactory: () => new WebSocket(
                connectUrlWithVersion(`ws://127.0.0.1:${port}`, BUILD)),
            warn: () => undefined,
            timeout: 5000,
            // The spec runner's default: strict, so an uncarriable send
            // THROWS (#272) — which is what the host used to hit.
        });
        const room = new MultiRoom(new CommunicatorClient(clientChannel)).join('nova:129');
        await firstValueFrom(room.peers.current.pipe(
            filter(peers => peers.has('server') && peers.size === 2)));
        const received: unknown[] = [];
        serverRoom.messages.subscribe(({ message }) => received.push(message));
        return { room, received };
    }

    let marker = 0;
    /**
     * The room messages the server received from `send`, in order: a
     * tickSync marker is sent after it, and everything before the marker
     * belongs to `send` (the socket is ordered).
     */
    async function receivedFrom(room: Communicator, received: unknown[],
        send: () => void): Promise<unknown[]> {
        const start = received.length;
        send();
        const tick = ++marker;
        room.sendMessage(wrapRollbackMessage({ kind: 'tickSync', tick }), 'server');
        const isMarker = (message: unknown) => {
            const unwrapped = unwrapRollbackMessage(message);
            return unwrapped?.kind === 'tickSync' && unwrapped.tick === tick;
        };
        for (let wait = 0; !received.slice(start).some(isMarker); wait++) {
            if (wait > 200) {
                throw new Error('marker never arrived');
            }
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        return received.slice(start, received.findIndex(
            (message, i) => i >= start && isMarker(message)));
    }

    /** The inputs the server decoded (its relay's gate) from `messages`. */
    function decodedInputs(messages: unknown[]): SimulationInput[] {
        const inputs: SimulationInput[] = [];
        for (const message of messages) {
            const unwrapped = unwrapRollbackMessage(message);
            if (unwrapped?.kind === 'inputs') {
                inputs.push(...unwrapped.record.inputs);
            }
        }
        return inputs;
    }

    /**
     * Every union member, valid and invalid. The invalid ones cover both
     * halves of the wire: the sending schema (most shapes, and an
     * addEntity whose component data does not fit its registered
     * component's schema — a shape the structural io-ts EncodedEntity
     * alone admits) and the receiving decode.
     */
    const cases: { name: string, valid: boolean, input: unknown }[] = [
        { name: 'control', valid: true, input: { kind: 'control', events: [{ action: 'accelerate', state: 'start' }] } },
        { name: 'control, state:stop (#270)', valid: false, input: { kind: 'control', events: [{ action: 'accelerate', state: 'stop' }] } },
        { name: 'analogControl', valid: true, input: { kind: 'analogControl', heading: 1.5, throttle: null } },
        { name: 'analogControl, string heading', valid: false, input: { kind: 'analogControl', heading: 'north', throttle: null } },
        { name: 'setTarget', valid: true, input: { kind: 'setTarget', target: 'ship' } },
        { name: 'setTarget, numeric target', valid: false, input: { kind: 'setTarget', target: 5 } },
        { name: 'setPlanetTarget', valid: true, input: { kind: 'setPlanetTarget', target: null } },
        { name: 'setPlanetTarget, object target', valid: false, input: { kind: 'setPlanetTarget', target: {} } },
        { name: 'hail', valid: true, input: { kind: 'hail', action: { kind: 'bribe', target: 'ship' } } },
        { name: 'hail, no target', valid: false, input: { kind: 'hail', action: { kind: 'bribe' } } },
        { name: 'acceptMission', valid: true, input: { kind: 'acceptMission', accepted: { missionId: 'nova:1', mission: null, creditsDelta: -0 } } },
        { name: 'acceptMission, numeric missionId', valid: false, input: { kind: 'acceptMission', accepted: { missionId: 3, mission: null } } },
        { name: 'acceptMission, with a change of ship and a move', valid: true, input: { kind: 'acceptMission', accepted: { missionId: 'nova:1', mission: null, shipChange: { shipId: 'nova:130' }, moveToSystem: { systemId: 'nova:129', keepCoordinates: false } } } },
        { name: 'refuseMission', valid: true, input: { kind: 'refuseMission', refused: { missionId: 'nova:1', bitsSet: [3], shipChange: { shipId: 'nova:130' } } } },
        { name: 'refuseMission, change of ship without a class', valid: false, input: { kind: 'refuseMission', refused: { missionId: 'nova:1', shipChange: {} } } },
        { name: 'escortAction', valid: true, input: { kind: 'escortAction', action: { kind: 'queueUpgrade', target: 'escort', toShip: 'nova:130' } } },
        { name: 'escortAction, upgrade without a class', valid: false, input: { kind: 'escortAction', action: { kind: 'queueUpgrade', target: 'escort' } } },
        { name: 'refundFighter', valid: true, input: { kind: 'refundFighter', refund: { carrier: 'carrier', bayWeaponId: 'nova:200' } } },
        { name: 'refundFighter, no bay weapon', valid: false, input: { kind: 'refundFighter', refund: { carrier: 'carrier' } } },
        { name: 'addEntity', valid: true, input: { kind: 'addEntity', uuid: 'e', entity: { name: 'e', components: [['Fuel', { current: 1, recharge: 0, max: 2, min: 0 }], ['Foo', { x: 1 }]] } } },
        { name: 'addEntity, component data off its schema', valid: false, input: { kind: 'addEntity', uuid: 'e', entity: { name: 'e', components: [['Fuel', { bogus: 1 }]] } } },
        { name: 'removeEntity', valid: true, input: { kind: 'removeEntity', uuid: 'e' } },
        { name: 'removeEntity, numeric uuid', valid: false, input: { kind: 'removeEntity', uuid: 7 } },
        { name: 'setJumpRoute', valid: true, input: { kind: 'setJumpRoute', route: ['nova:128'] } },
        { name: 'setJumpRoute, numeric system', valid: false, input: { kind: 'setJumpRoute', route: [1] } },
        { name: 'removePeer', valid: true, input: { kind: 'removePeer', peerId: 'peer' } },
        { name: 'removePeer, no peer', valid: false, input: { kind: 'removePeer' } },
        { name: 'an unknown kind', valid: false, input: { kind: 'teleport' } },
        // Admitted in a normalised form: the wire sends an absent
        // required nullable as null, and the room applies null.
        { name: 'analogControl, throttle absent', valid: true, input: { kind: 'analogControl', heading: 1 } },
    ];

    it('covers every SimulationInputType member, valid and invalid', () => {
        // Each member is t.strict: an exact type over the props.
        const members = (SimulationInputType as unknown as {
            types: { type: { props: { kind: { value: string } } } }[],
        }).types.map(member => member.type.props.kind.value).sort();
        expect(members.length).toBe(13);
        const kindsOf = (valid: boolean) => [...new Set(cases
            .filter(c => c.valid === valid)
            .map(c => (c.input as { kind: string }).kind))]
            .filter(kind => members.includes(kind)).sort();
        expect(kindsOf(true)).toEqual(members);
        expect(kindsOf(false)).toEqual(members);
    });

    it('the host and the wire agree on every input, and the host applies what the room receives', async () => {
        const { room, received } = await joinedRoom();
        const world = new World('local input gate');
        world.addPlugin(SerializerPlugin);
        world.addPlugin(TimePlugin);
        world.resources.set(CommunicatorResource, room);
        const host = new SimulationBridgeHost(world, {} as never);
        const rollback = (host as unknown as {
            rollback: { tick: number, getInputs(tick: number): InputRecord[] | undefined },
        }).rollback;
        const warn = spyOn(console, 'warn');

        for (const { name, valid, input } of cases) {
            // The wire's verdict: the raw record through the real
            // sending socket, then the server room's decode.
            let sendRefused = false;
            const wireMessages = await receivedFrom(room, received, () => {
                try {
                    room.sendMessage(wrapRollbackMessage({
                        kind: 'inputs',
                        record: { tick: 1, inputs: [input as SimulationInput] },
                    }), 'server');
                } catch (error) {
                    expect(error).toBeInstanceOf(UncarriableMessageError);
                    sendRefused = true;
                }
            });
            const wireInputs = decodedInputs(wireMessages);
            const wireAdmits = !sendRefused && wireInputs.length === 1;

            // The host's verdict: schedule it and step. Without the
            // gate an uncarriable input throws out of step() (the
            // strict send in publishInputs) after it was already
            // applied.
            warn.calls.reset();
            const hostMessages = await receivedFrom(room, received, () => {
                (host as unknown as { schedule(input: unknown): void }).schedule(input);
                expect(() => host.step()).withContext(name).not.toThrow();
            });
            const refusals = warn.calls.allArgs().map(args => String(args[0]))
                .filter(line => line.includes('the wire would refuse'));
            const applied = rollback.getInputs(rollback.tick)
                ?.flatMap(record => record.inputs) ?? [];
            const hostAdmits = applied.length === 1;

            expect(wireAdmits).withContext(`${name}: the wire`).toBe(valid);
            expect(hostAdmits).withContext(`${name}: the host`).toBe(wireAdmits);
            if (hostAdmits) {
                // Published, and applied here exactly as the room got it.
                expect(decodedInputs(hostMessages)).withContext(name).toEqual(applied);
                expect(applied).withContext(name).toEqual(wireInputs);
                expect(refusals).withContext(name).toEqual([]);
            } else {
                // Neither applied nor published; the warning names the kind.
                expect(hostMessages).withContext(name).toEqual([]);
                expect(refusals.length).withContext(name).toBe(1);
                expect(refusals[0]).withContext(name)
                    .toContain(`local ${(input as { kind: string }).kind} input`);
            }
        }
    });
});
