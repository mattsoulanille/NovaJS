import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultPlanetData } from 'novadatainterface/planet_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { PlayerEscortComponent, CreditsComponent } from '../nova_plugin/player/index.js';
import { FuelComponent, ShipComponent, ShipDataComponent } from '../nova_plugin/ship/index.js';
import { Stat } from '../nova_plugin/core/index.js';
import { CarriedEscort } from '../spaceport/landed_escorts.js';
import { ClientStateSlot, LiveSystem, requestGateLaunch, requestLaunch } from './client_state.js';
import { runDockingFrame } from './docking.js';
import { FleetLedger } from './fleet_ledger.js';
import type { ClientRuntime } from './runtime.js';

/**
 * ============================================================================
 * THE LOST-ESCORT RETRY AT A SAME-SYSTEM LIFT-OFF (issue #257)
 * ============================================================================
 *
 * Ruling #148 retries a lost (not destroyed) hired or captured escort at
 * the player's next SYSTEM ENTRY (jumpTo's takeLost, system_entry.ts).
 * Issue #257 extends the ruling: a land-and-lift-off in the SAME system is
 * also a "next time the fleet goes back into the world", so the two
 * lift-off paths of runDockingFrame take the lost roster too - the
 * spaceport launch and the hypergate lift-off whose map closed without a
 * pick. A lost escort rides the ordinary insertion (fresh uuid, formation
 * station, command reset), NOT restocked: it never touched a pad.
 *
 * The system-entry retry itself is pinned in system_entry (ruling #148);
 * these specs pin the lift-off half.
 */
describe('the docking frame takes the lost roster at a lift-off (issue #257)',
    () => {
        const SYSTEM = 'nova:128';
        const PLANET = 'nova:128';
        const PLAYER = 'player-uuid';
        const HULL = 'nova:128';
        const ESCORT_SHIP = 'nova:130';

        function movement() {
            return {
                accelerating: 0, position: new Position(0, 0),
                rotation: new Angle(0), turnBack: false, turning: 0,
                velocity: new Vector(0, 0),
            };
        }

        function gameData(): MockGameData {
            const data = new MockGameData();
            data.data.Planet.map.set(PLANET, {
                ...getDefaultPlanetData(), id: PLANET, name: 'Port',
            });
            data.data.Ship.map.set(HULL, { ...getDefaultShipData(), id: HULL });
            data.data.Ship.map.set(ESCORT_SHIP,
                { ...getDefaultShipData(), id: ESCORT_SHIP });
            return data;
        }

        /** A lost hired escort, as the ledger records it. */
        function lostEscort(uuid: string): CarriedEscort {
            return {
                player: PLAYER, uuid,
                entity: new Entity('escort')
                    .addComponent(ShipComponent, { id: ESCORT_SHIP })
                    .addComponent(ShipDataComponent,
                        gameData().data.Ship.map.get(ESCORT_SHIP)!)
                    .addComponent(MovementStateComponent, movement())
                    .addComponent(PlayerEscortComponent, {
                        player: PLAYER, parent: PLAYER, provenance: 'hired',
                    }),
            };
        }

        function bench(kind: 'landed' | 'gateMap') {
            const inserted: string[] = [];
            const insertedEntities: Entity[] = [];
            const bridge = {
                addEntity: async (uuid: string, entity: Entity) => {
                    inserted.push(uuid);
                    insertedEntities.push(entity);
                },
                removeEntity: async () => undefined,
            };
            const world = new World('display');
            const live = {
                systemId: SYSTEM, world, bridge,
            } as unknown as LiveSystem;
            const data = gameData();
            const player = new Entity('player')
                .addComponent(ShipComponent, { id: HULL })
                .addComponent(CreditsComponent, { credits: 1_000 })
                .addComponent(MovementStateComponent, movement());
            const fleet = new FleetLedger();
            const state = new ClientStateSlot(kind === 'landed'
                ? {
                    kind: 'landed', system: live,
                    ship: { uuid: PLAYER, entity: player, planetId: PLANET },
                }
                : {
                    kind: 'gateMap', system: live,
                    ship: { uuid: PLAYER, entity: player, planetId: PLANET },
                });
            const runtime = {
                state, fleet, gameData: data, communicator: { uuid: 'peer-1' },
            } as unknown as ClientRuntime;
            return {
                runtime, live, inserted, insertedEntities, player, fleet,
                state, data,
            };
        }

        it('respawns a lost escort at the spaceport launch, un-restocked, '
            + 'and drains the roster', async () => {
                const { runtime, live, inserted, insertedEntities, player,
                    fleet, state, data } = bench('landed');
                const lost = lostEscort('lost-1');
                // Fuel below full: the restock is for escorts that visited
                // the port, and this one never did.
                lost.entity.components.set(FuelComponent, new Stat(
                    { current: 10, recharge: 0, max: 100 }));
                fleet.lost.push(lost);
                state.apply(s => requestLaunch(s, player));
                await runDockingFrame(runtime, live);
                expect(inserted.length).toBe(2);
                expect(inserted[0]).toBe(PLAYER);
                expect(state.state.kind).toBe('inSpace');
                expect(fleet.lost).toEqual([]);
                // UN-RESTOCKED: the restock belongs to escorts that put
                // down at the port (takeLandedEscortsRestocked); a lost
                // one never touched the pad, so its fuel rides the
                // insertion exactly as it stood on its last mirrored
                // frame - the same rule that keeps the jump roster
                // un-restocked (escort_restock.ts).
                const insertedLost = insertedEntities.find(
                    (entity: Entity) =>
                        entity.components.get(PlayerEscortComponent)
                            ?.provenance === 'hired');
                expect(insertedLost).toBeDefined();
                expect(insertedLost!.components.get(FuelComponent)!.current)
                    .toBe(10);
            });

        it('respawns a lost escort at the gate lift-off whose map closed '
            + 'without a pick', async () => {
                const { runtime, live, inserted, player, fleet, state }
                    = bench('gateMap');
                fleet.lost.push(lostEscort('lost-gate'));
                state.apply(s => requestGateLaunch(s, player));
                await runDockingFrame(runtime, live);
                expect(inserted.length).toBe(2);
                expect(inserted[0]).toBe(PLAYER);
                expect(state.state.kind).toBe('inSpace');
                expect(fleet.lost).toEqual([]);
            });

        it('leaves the lost roster alone while the player is docked and '
            + 'not launching', async () => {
                const { runtime, live, inserted, fleet, state } = bench('landed');
                fleet.lost.push(lostEscort('lost-1'));
                await runDockingFrame(runtime, live);
                expect(inserted).toEqual([]);
                expect(state.state.kind).toBe('landed');
                expect(fleet.lost.length).toBe(1);
            });

        it('puts a lost escort whose insertion rejected on the jump roster '
            + 'for the standing flush (un-restocked, as at a system entry)',
        async () => {
            const { runtime, live, inserted, player, fleet, state }
                = bench('landed');
            const lost = lostEscort('lost-1');
            fleet.lost.push(lost);
            // The player goes in; the escort's own insertion rejects.
            const failingBridge = live.bridge as unknown as {
                addEntity: (uuid: string, entity: unknown) => Promise<void>,
            };
            failingBridge.addEntity = async (uuid: string) => {
                if (uuid !== PLAYER) {
                    throw new Error('staging always fails');
                }
                inserted.push(uuid);
            };
            state.apply(s => requestLaunch(s, player));
            await runDockingFrame(runtime, live);
            expect(inserted).toEqual([PLAYER]);
            expect(state.state.kind).toBe('inSpace');
            // The JUMP roster, not the landed one: flushCarriedJumpEscorts
            // re-inserts un-restocked every frame, which is what a lost
            // escort wants (it never touched a pad) — the same routing
            // the system-entry retry gives its own failed batch
            // (system_entry.ts). The lost roster itself has no standing
            // flush; putting it back there would idle until the next
            // entry or lift-off. The uuid is the MINTED one (a failed
            // row is re-keyed to the uuid the retry was about to insert
            // under - fleet_insertion.ts), not the lost row's old one.
            expect(fleet.jumping.length).toBe(1);
            expect(fleet.jumping[0].player).toBe(PLAYER);
            expect(fleet.jumping[0].uuid).not.toBe('lost-1');
            expect(fleet.jumping[0].entity).toBe(lost.entity);
            expect(fleet.lost).toEqual([]);
            expect(fleet.landed).toEqual([]);
        });

        /**
         * THE PLAYER-REJECTION HALF OF THE FAILURE POLICY (issue #31 + #257):
         * when the player's own insertion rejects, nothing went in and the
         * block re-runs next frame with the state still `launching`. The
         * landed half goes back to `landed` and the lost half back to
         * `lost` — never to `landed`, because the re-run restocks the landed
         * roster (takeLandedEscortsRestocked: fuel -> max) and a lost escort
         * never touched the pad. The re-run is what makes the routing
         * observable: a lost escort put back on the wrong roster would lift
         * off with full fuel.
         */
        for (const kind of ['landed', 'gateMap'] as const) {
            it(`hands each half back to its own roster when the player `
                + `insertion rejects at the ${kind} lift-off, so the re-run `
                + 'stays un-restocked', async () => {
                    const { runtime, live, inserted, insertedEntities, player,
                        fleet, state } = bench(kind);
                    const landed = lostEscort('landed-1');
                    landed.entity.components.set(FuelComponent, new Stat(
                        { current: 10, recharge: 0, max: 100 }));
                    const lost = lostEscort('lost-1');
                    lost.entity.components.set(FuelComponent, new Stat(
                        { current: 10, recharge: 0, max: 100 }));
                    fleet.landed.push(landed);
                    fleet.lost.push(lost);
                    let playerRejects = true;
                    const bridge = live.bridge as unknown as {
                        addEntity: (uuid: string, entity: Entity) => Promise<void>,
                    };
                    bridge.addEntity = async (uuid: string, entity: Entity) => {
                        if (uuid === PLAYER && playerRejects) {
                            throw new Error('the player record was rejected');
                        }
                        inserted.push(uuid);
                        insertedEntities.push(entity);
                    };
                    state.apply(s => kind === 'landed'
                        ? requestLaunch(s, player) : requestGateLaunch(s, player));
                    await expectAsync(runDockingFrame(runtime, live)).toBeRejected();
                    expect(inserted).toEqual([]);
                    // Still docked, still launching: the block runs again.
                    expect(state.state.kind).toBe(kind);
                    expect((state.state as { launching?: Entity }).launching)
                        .toBe(player);
                    // Each half on the roster it came from.
                    expect(fleet.landed.map(row => row.uuid)).toEqual(['landed-1']);
                    expect(fleet.lost.map(row => row.uuid)).toEqual(['lost-1']);
                    expect(fleet.jumping).toEqual([]);
                    // The re-run: the landed escort leaves the pad restocked,
                    // the lost one exactly as it stood.
                    playerRejects = false;
                    await runDockingFrame(runtime, live);
                    expect(inserted.length).toBe(3);
                    expect(inserted[0]).toBe(PLAYER);
                    expect(state.state.kind).toBe('inSpace');
                    expect(fleet.landed).toEqual([]);
                    expect(fleet.lost).toEqual([]);
                    expect(insertedEntities).toContain(landed.entity);
                    expect(insertedEntities).toContain(lost.entity);
                    expect(landed.entity.components.get(FuelComponent)!.current)
                        .toBe(100);
                    expect(lost.entity.components.get(FuelComponent)!.current)
                        .toBe(10);
                });
        }
    });
