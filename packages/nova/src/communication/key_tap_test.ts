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
import { RoomClock } from './room_clock.js';
import { SIMULATION_STEP_MS } from '../nova_plugin/make_system.js';

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
            // The next batch, still under the same clock reading, is not
            // stamped before them (authored order) — and not pushed past
            // them either: only a held-back remainder is bumped.
            h.send(press('cloak'));
            h.host.step();
            expect(records[2]?.tick).toBe(52);
        });

        /** A host in a room whose clock reads `tick` at `now` (mocked). */
        function roomHarness(tick: number) {
            const communicator = new MockCommunicator('me');
            const h = makeHarness(communicator);
            const records = published(communicator);
            let now = 1000;
            spyOn(performance, 'now').and.callFake(() => now);
            communicator.messages.next({
                source: 'server',
                message: wrapRollbackMessage({ kind: 'tickSync', tick }),
            });
            // The host's own estimate, by the host's own arithmetic.
            const clock = new RoomClock();
            clock.sync(tick, 1000);
            const clockNext = () =>
                Math.ceil(clock.estimatedServerTick(now)!) + 1;
            return {
                h, records, clockNext,
                /** One wall-clock tick passes. */
                advance() { now += SIMULATION_STEP_MS; },
                /** The latest record's lead over the clock's next tick. */
                lead() { return records.at(-1)!.tick - clockNext(); },
            };
        }

        const steer = (heading: number) => ({ heading, throttle: 1 });

        it('a catch-up burst with a record every step leaves no lasting lead over the clock', () => {
            // Hub review: a per-tick input stream (the autopilot's and the
            // touch stick's analogControl, one per frame) through a
            // catch-up — the room clock estimate standing still while the
            // local tick races behind it. Each record must not be bumped
            // past its predecessor, or the burst's length would become a
            // permanent lead (input latency) for as long as the stream
            // runs.
            const r = roomHarness(50);
            for (let i = 0; i < 10; i++) {
                r.h.host.analogControl(steer(i / 10));
                r.h.host.step();
            }
            // The burst: all at the clock's next tick, as before this
            // change (a record per step from one peer stacks; seq orders
            // them where they apply, #359).
            expect(r.records.map(x => x.tick)).toEqual(Array(10).fill(51));
            // The clock runs again with the stream still going: every
            // record is stamped at the clock's next tick, no lead.
            const leads: number[] = [];
            for (let i = 0; i < 20; i++) {
                r.advance();
                r.h.host.analogControl(steer(1 + i / 10));
                r.h.host.step();
                leads.push(r.lead());
            }
            expect(leads).toEqual(Array(20).fill(0));
        });

        it('a tap inside a catch-up burst leads the clock by one tick at most, then none', () => {
            const r = roomHarness(50);
            const ticks: number[] = [];
            for (let i = 0; i < 6; i++) {
                r.h.host.analogControl(steer(i / 10));
                if (i === 2) {
                    r.h.send(press('nearestTarget'), release('nearestTarget'));
                }
                r.h.host.step();
                ticks.push(r.records.at(-1)!.tick);
            }
            // The press went out with step 2's record at 51; its release
            // was held back and went on 52 with step 3's; what follows
            // keeps authored order (not before 52) without a further bump.
            const pressRecord = r.records.find(x => x.inputs.some(input =>
                input.kind === 'control' && input.events[0]!.state === 'start'))!;
            const releaseRecord = r.records.find(x => x.inputs.some(input =>
                input.kind === 'control' && input.events[0]!.state === false))!;
            expect([pressRecord.tick, releaseRecord.tick]).toEqual([51, 52]);
            expect(ticks).toEqual([51, 51, 51, 52, 52, 52]);
            expect(Math.max(...ticks) - r.clockNext()).toBeLessThanOrEqual(1);
            // As soon as the clock moves, the stream is back at its next
            // tick.
            const leads: number[] = [];
            for (let i = 0; i < 5; i++) {
                r.advance();
                r.h.host.analogControl(steer(1));
                r.h.host.step();
                leads.push(r.lead());
            }
            expect(leads).toEqual([0, 0, 0, 0, 0]);
        });

        it('a tap every step through a catch-up: the lead is bounded and decays', () => {
            // The worst case for the bump: every step holds a release
            // back, so every record carries a remainder. While the clock
            // stands still each remainder adds a tick; once the clock
            // runs, the lead cannot grow and is gone a few ticks after
            // the taps stop.
            const r = roomHarness(50);
            for (let i = 0; i < 4; i++) {
                r.h.send(press('nextTarget'), release('nextTarget'));
                r.h.host.step();
            }
            // Frozen clock: 51 (press), then each step's record carries the
            // previous release and its own press: 52, 53, 54.
            expect(r.records.map(x => x.tick)).toEqual([51, 52, 53, 54]);
            const leads: number[] = [];
            for (let i = 0; i < 24; i++) {
                r.advance();
                if (i < 4) {
                    r.h.send(press('nextTarget'), release('nextTarget'));
                }
                r.h.host.analogControl(steer(i));
                r.h.host.step();
                leads.push(r.lead());
            }
            // Never more than the frozen burst built, never growing...
            expect(Math.max(...leads)).toBeLessThanOrEqual(3);
            for (let i = 1; i < leads.length; i++) {
                expect(leads[i]!).toBeLessThanOrEqual(leads[i - 1]!);
            }
            // ...and gone once the taps have drained.
            expect(leads.slice(-8)).toEqual(Array(8).fill(0));
            // Every tap still reached its own tick: 8 presses, 8 edges.
            r.h.host.step(120);
            expect(r.h.edges.filter(([, actions]) =>
                actions.includes('nextTarget')).length).toBe(8);
        });
    });
});
