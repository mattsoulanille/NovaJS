import 'jasmine';
import * as fs from 'fs';
import * as path from 'path';
import { isLeft } from 'fp-ts/lib/Either.js';
import { MockCommunicator } from 'nova_ecs/plugins/mock_communicator';
import { CommunicatorResource } from 'nova_ecs/plugins/multiplayer_plugin';
import { SerializerPlugin } from 'nova_ecs/plugins/serializer_plugin';
import { SnapshotPolicies, SnapshotPoliciesResource } from 'nova_ecs/plugins/snapshot_plugin';
import { TimePlugin, TimeResource } from 'nova_ecs/plugins/time_plugin';
import { Entity } from 'nova_ecs/entity';
import { System } from 'nova_ecs/system';
import { World } from 'nova_ecs/world';
import {
    ControlAction, ControlEvent, Controls, getActions, SavedControls,
} from '../nova_plugin/core/index.js';
import {
    ControlledByComponent, PlayerShipSelector, ShipControlEvent,
    ShipControlStateComponent,
} from '../nova_plugin/player/index.js';
import { unwrapRollbackMessage, wrapRollbackMessage } from './rollback_protocol.js';
import { SimulationBridgeHost } from './simulation_bridge_host.js';
import { InputRecord, SimulationInput } from './simulation_input.js';
import { takeTickInputs } from './tick_inputs.js';

/**
 * Quick key taps (LOST_KEY_TAPS): a key pressed AND released between two
 * simulation steps used to reach the step as a release only. The bridge
 * host queues inputs until its next step, so both events landed in the
 * same tick's record; the release applied after the press and the ship's
 * control state said `false` by the time the edge handlers
 * (ShipControlEvent systems: land, target cycling, escort orders...) ran.
 * A synthetic 0 ms tap was always lost in the browser, a 60 ms one about
 * one time in six.
 *
 * The contract pinned here, for whatever arrives between two steps:
 * every press reaches a step as its own 'start' edge, in the order typed;
 * a release takes effect on the step AFTER its press, so held-state
 * consumers see a tapped key held for exactly one tick and never stuck.
 */

function makeWorld(communicator?: MockCommunicator) {
    const world = new World('key tap world');
    world.addPlugin(SerializerPlugin);
    world.addPlugin(TimePlugin);
    const policies = new SnapshotPolicies();
    const time = world.resources.get(TimeResource)!;
    policies.addResource({
        name: 'time',
        save: () => ({ ...time }),
        restore: saved => Object.assign(time, saved as object),
    });
    world.resources.set(SnapshotPoliciesResource, policies);
    if (communicator) {
        world.resources.set(CommunicatorResource, communicator);
    }
    return world;
}

function makeFakeSimulationData() {
    return {
        ids: Promise.resolve({} as never),
        data: { Ship: { getCached: () => undefined } },
    } as never;
}

/**
 * A host over a world with one controlled ship and two observers: the
 * edges each tick's ShipControlEvent handlers saw, and the held state
 * the tick's step systems saw.
 */
function makeHarness(communicator?: MockCommunicator) {
    const world = makeWorld(communicator);
    const ship = new Entity('ship')
        .addComponent(ControlledByComponent, {
            peerId: communicator?.uuid ?? 'local',
        })
        .addComponent(PlayerShipSelector, undefined);
    world.entities.set('ship', ship);

    let tick = 0;
    /** tick -> actions a ShipControlEvent handler saw at 'start'. */
    const edges: [number, ControlAction[]][] = [];
    /** How many times the edge handler ran per tick. */
    const handlerRuns = new Map<number, number>();
    /** tick -> actions held (truthy) during the tick's step. */
    const held = new Map<number, ControlAction[]>();
    world.addSystem(new System({
        name: 'KeyTapEdgeProbe',
        events: [ShipControlEvent],
        args: [ShipControlStateComponent] as const,
        step(state) {
            handlerRuns.set(tick, (handlerRuns.get(tick) ?? 0) + 1);
            const started = [...state].filter(([, v]) => v === 'start')
                .map(([action]) => action).sort();
            if (started.length > 0) {
                edges.push([tick, started]);
            }
        },
    }));
    world.addSystem(new System({
        name: 'KeyTapHeldProbe',
        args: [ShipControlStateComponent] as const,
        step(state) {
            held.set(tick, [...state].filter(([, v]) => Boolean(v))
                .map(([action]) => action).sort());
        },
    }));

    const host = new SimulationBridgeHost(world, makeFakeSimulationData());
    return {
        world, host, edges, held, handlerRuns,
        step(count = 1) {
            for (let i = 0; i < count; i++) {
                tick++;
                host.step();
            }
        },
        send(...events: ControlEvent[]) {
            host.controlEvents(events);
        },
    };
}

const press = (action: ControlAction): ControlEvent =>
    ({ action, state: 'start' });
const release = (action: ControlAction): ControlEvent =>
    ({ action, state: false });

describe('quick key taps', () => {
    it('a press and release between two steps still reach a step as a start edge', () => {
        const h = makeHarness();
        h.send(press('nearestTarget'));
        h.send(release('nearestTarget'));
        h.step();
        expect(h.edges).toEqual([[1, ['nearestTarget']]]);
        // Held for exactly the tick of its press...
        expect(h.held.get(1)).toEqual(['nearestTarget']);
        // ...and released on the next step, with nothing more to send.
        h.step();
        expect(h.held.get(2)).toEqual([]);
        h.step(3);
        expect(h.edges).toEqual([[1, ['nearestTarget']]]);
        expect(h.held.get(5)).toEqual([]);
    });

    it('a press and release in ONE batch (one keyboard event pair) behave the same', () => {
        const h = makeHarness();
        h.send(press('land'), release('land'));
        h.step(2);
        expect(h.edges).toEqual([[1, ['land']]]);
        expect(h.held.get(1)).toEqual(['land']);
        expect(h.held.get(2)).toEqual([]);
    });

    it('a held key: one edge, held every tick until the release step', () => {
        const h = makeHarness();
        h.send(press('accelerate'));
        h.step(3);
        h.send(release('accelerate'));
        h.step();
        expect(h.edges).toEqual([[1, ['accelerate']]]);
        expect(h.held.get(1)).toEqual(['accelerate']);
        expect(h.held.get(3)).toEqual(['accelerate']);
        expect(h.held.get(4)).toEqual([]);
    });

    it('a double tap within one tick is two edges, on consecutive ticks', () => {
        // The choice: every press the player made is an action (two quick
        // Tabs cycle the target twice), so the second tap is not merged
        // into the first; it waits one tick for its own edge.
        const h = makeHarness();
        h.send(press('nextTarget'));
        h.send(release('nextTarget'));
        h.send(press('nextTarget'));
        h.send(release('nextTarget'));
        h.step(4);
        expect(h.edges).toEqual([
            [1, ['nextTarget']],
            [2, ['nextTarget']],
        ]);
        expect(h.held.get(1)).toEqual(['nextTarget']);
        expect(h.held.get(2)).toEqual(['nextTarget']);
        expect(h.held.get(3)).toEqual([]);
        expect(h.held.get(4)).toEqual([]);
    });

    it('two different keys tapped in one tick: both edges, in the order typed', () => {
        const h = makeHarness();
        h.send(press('nearestTarget'));
        h.send(release('nearestTarget'));
        h.send(press('cloak'));
        h.send(release('cloak'));
        h.step(3);
        // The queue is taken in authored order, so the second tap waits
        // behind the first's release: one tick each.
        expect(h.edges).toEqual([
            [1, ['nearestTarget']],
            [2, ['cloak']],
        ]);
        // One ShipControlEvent per tick: an edge handler that acts on
        // 'start' must not act twice for one press.
        expect(h.handlerRuns.get(1)).toBe(1);
        expect(h.handlerRuns.get(2)).toBe(1);
        expect(h.held.get(1)).toEqual(['nearestTarget']);
        expect(h.held.get(2)).toEqual(['cloak']);
        expect(h.held.get(3)).toEqual([]);
    });

    it('a burst of separate presses on one tick never double-fires an edge', () => {
        // Separate control inputs on one tick used to apply one at a
        // time: each application decayed the previous one's 'start' to
        // plain held, and each emitted its own ShipControlEvent, so the
        // LAST press fired its edge handlers once per input and the rest
        // never fired.
        const h = makeHarness();
        h.send(press('accelerate'));
        h.send(press('nearestTarget'));
        h.step();
        expect(h.edges).toEqual([[1, ['accelerate', 'nearestTarget']]]);
        expect(h.handlerRuns.get(1)).toBe(1);
    });

    it('a release then press of the same key in one tick is a fresh edge', () => {
        const h = makeHarness();
        h.send(press('firePrimary'));
        h.step();
        h.send(release('firePrimary'));
        h.send(press('firePrimary'));
        h.step();
        expect(h.edges).toEqual([
            [1, ['firePrimary']],
            [2, ['firePrimary']],
        ]);
        // Never released in between: the key was down again before the
        // step could see it up.
        expect(h.held.get(2)).toEqual(['firePrimary']);
    });

    describe('the Alt+C modifier combo (return to bay)', () => {
        let controls: Controls;
        beforeAll(() => {
            const decoded = SavedControls.pipe(Controls).decode(JSON.parse(
                fs.readFileSync(path.resolve(process.cwd(),
                    'settings/controls.json'), 'utf8')));
            if (isLeft(decoded)) {
                throw new Error('Failed to decode settings/controls.json');
            }
            controls = decoded.right;
        });

        function key(type: 'keydown' | 'keyup', code: string, alt: boolean) {
            return {
                type, code, repeat: false,
                getModifierState: (m: string) => alt && m === 'Alt',
            } as unknown as KeyboardEvent;
        }

        it('an instant Alt+C tap reaches the step as returnToBay alone', () => {
            const h = makeHarness();
            const down = getActions(controls, key('keydown', 'KeyC', true));
            const up = getActions(controls, key('keyup', 'KeyC', true));
            expect(down).toEqual(['returnToBay']);
            h.send(...down.map(press));
            h.send(...up.map(release));
            h.step(2);
            expect(h.edges).toEqual([[1, ['returnToBay']]]);
            expect(h.held.get(2)).toEqual([]);
        });
    });

    describe('takeTickInputs', () => {
        const control = (...events: ControlEvent[]): SimulationInput =>
            ({ kind: 'control', events });
        const target: SimulationInput = { kind: 'setTarget', target: 'x' };

        it('merges adjacent control inputs and keeps the rest in order', () => {
            const queue = [control(press('accelerate')), control(press('turnLeft')),
                target];
            expect(takeTickInputs(queue)).toEqual({
                now: [control(press('accelerate'), press('turnLeft')), target],
                later: [],
            });
        });

        it('never moves a control across another kind of input', () => {
            const queue = [control(press('accelerate')), target,
                control(press('turnLeft'))];
            expect(takeTickInputs(queue)).toEqual({
                now: [control(press('accelerate')), target],
                later: [control(press('turnLeft'))],
            });
        });

        it('cuts mid-input at the release of a press it already holds', () => {
            const queue = [control(press('attack'), press('escortSelectFighters')),
                control(release('attack'), press('formation')), target];
            const before = structuredClone(queue);
            expect(takeTickInputs(queue)).toEqual({
                now: [control(press('attack'), press('escortSelectFighters'))],
                later: [control(release('attack'), press('formation')), target],
            });
            const mid = [control(press('cloak'), press('land'), release('cloak'))];
            expect(takeTickInputs(mid)).toEqual({
                now: [control(press('cloak'), press('land'))],
                later: [control(release('cloak'))],
            });
            // Pure: the queue (perhaps already part of a record) is intact.
            expect(queue).toEqual(before);
        });

        it('drops a control input with no events', () => {
            expect(takeTickInputs([control(), target])).toEqual({
                now: [target], later: [],
            });
            expect(takeTickInputs([control()])).toEqual({ now: [], later: [] });
        });
    });

    describe('record ticks', () => {
        function published(communicator: MockCommunicator): InputRecord[] {
            const records: InputRecord[] = [];
            const send = communicator.sendMessage.bind(communicator);
            spyOn(communicator, 'sendMessage').and.callFake((message, dest) => {
                const unwrapped = unwrapRollbackMessage(message);
                if (unwrapped?.kind === 'inputs') {
                    records.push(unwrapped.record);
                }
                return send(message, dest);
            });
            return records;
        }

        it('a tap split across ticks never stacks onto one tick while catching up', () => {
            // Catching up, records are stamped at the room clock's next
            // tick — which stands still within one burst of steps. The
            // release held back from the press's record must still land
            // on a LATER tick than the press, or the relay's log (and
            // every other peer) would see the tap collapse again.
            const communicator = new MockCommunicator('me');
            const h = makeHarness(communicator);
            const records = published(communicator);
            spyOn(performance, 'now').and.returnValue(1000);
            communicator.messages.next({
                source: 'server',
                message: wrapRollbackMessage({ kind: 'tickSync', tick: 50 }),
            });
            h.send(press('nearestTarget'), release('nearestTarget'));
            h.host.step(5);
            expect(records.map(r => [r.tick, r.inputs])).toEqual([
                [51, [{ kind: 'control', events: [press('nearestTarget')] }]],
                [52, [{ kind: 'control', events: [release('nearestTarget')] }]],
            ]);
            // And the next batch after the burst, still under the same
            // clock reading, goes after both.
            h.send(press('cloak'));
            h.host.step();
            expect(records[2]?.tick).toBe(53);
        });
    });
});
