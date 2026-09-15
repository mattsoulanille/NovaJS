import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { World } from 'nova_ecs/world';
import * as PIXI from 'pixi.js';
import { applySimulationFrame } from '../communication/apply_simulation_frame.js';
import { SimulationFrame } from '../communication/simulation_frame.js';
import { SourceComponent } from '../nova_plugin/combat/index.js';
import { BayFighterComponent, FighterRefund } from '../nova_plugin/escorts/index.js';
import { makeSystem } from '../nova_plugin/make_system.js';
import { MissionShipComponent, PlayerEscortComponent } from '../nova_plugin/player/index.js';
import { makeShip } from '../nova_plugin/ship/index.js';
import { completeEntity } from '../nova_plugin/spawn/index.js';
import { FleetLedger, refundLostFighters } from './fleet_ledger.js';
import type { SimulationGameData } from './gamedata/simulation_game_data.js';

/**
 * ============================================================================
 * LOST VERSUS DESTROYED (maintainer ruling #148)
 * ============================================================================
 *
 * A hired or captured escort that leaves the world WITHOUT DYING — its
 * insertion never took, a rollback correction removed it, a desync of any
 * kind — must come back when the player next enters a system; one that
 * was DESTROYED stays destroyed. The client tells them apart at the one
 * place it sees every removal: the display world's mirror of the
 * simulation, where the frame pump hands each removed entity to
 * FleetLedger.noteRemoved after the frame's events (a death, a carry)
 * have been emitted. These specs drive that seam with hand-built frames
 * over a real system world's serializer.
 */
describe('the fleet ledger\'s lost roster (ruling #148)', () => {
    const PLAYER = 'player-uuid';
    const OTHER = 'somebody-else';
    const SHIP_ID = 'test:ship';

    function movement() {
        return {
            accelerating: 0, position: new Position(100, 100),
            rotation: new Angle(0), turnBack: false, turning: 0,
            velocity: new Vector(0, 0),
        };
    }

    async function bench() {
        const gameData = new MockGameData();
        gameData.data.Ship.map.set(SHIP_ID,
            { ...getDefaultShipData(), id: SHIP_ID });
        const world = await makeSystem('test:system', gameData, undefined,
            { npcs: false });
        const serializer = world.resources.get(SerializerResource)!;
        const display = new World('display');
        const fleet = new FleetLedger();

        /** A hired escort of `player`, mirrored into the display world. */
        async function escort(uuid: string, player = PLAYER,
            setup: (ship: Entity) => void = () => { }) {
            const ship = makeShip(gameData.data.Ship.map.get(SHIP_ID)!);
            ship.components.set(MovementStateComponent, movement());
            ship.components.set(PlayerEscortComponent,
                { player, parent: player, provenance: 'hired' });
            setup(ship);
            await completeEntity(world, ship);
            applySimulationFrame(frame({ added: [[uuid, serializer.encode(ship)]] }),
                serializer, display);
            expect(display.entities.has(uuid)).toBeTrue();
            return ship;
        }

        function frame(parts: Partial<SimulationFrame>): SimulationFrame {
            return { added: [], changed: [], removed: [], events: [], ...parts };
        }

        /** The pump's application of a frame that removes `uuids`. */
        function remove(...uuids: string[]) {
            applySimulationFrame(frame({ removed: uuids }), serializer, display, {
                emitEvents: true,
                onRemove: (uuid, entity) =>
                    fleet.noteRemoved(uuid, entity, PLAYER, serializer),
            });
        }

        return { serializer, display, fleet, escort, frame, remove };
    }

    it('records an escort removed without a death or a carry as LOST, '
        + 'as a serializer round trip of its last mirrored state', async () => {
            const { fleet, display, escort, remove } = await bench();
            const ship = await escort('e1');
            // Display-only baggage on the mirrored entity (a sprite the
            // display attached) must not ride the lost record.
            const mirrored = display.entities.get('e1')!;
            mirrored.components.set(PixiSpriteStandIn, new PIXI.Sprite());
            spyOn(console, 'warn');
            remove('e1');
            expect(display.entities.has('e1')).toBeFalse();
            expect(fleet.lost.map(row => row.uuid)).toEqual(['e1']);
            const kept = fleet.lost[0];
            expect(kept.player).toBe(PLAYER);
            expect(kept.entity).not.toBe(mirrored);
            expect(kept.entity.components.get(PlayerEscortComponent))
                .toEqual(ship.components.get(PlayerEscortComponent)!);
            expect(kept.entity.components.has(PixiSpriteStandIn)).toBeFalse();
            expect(kept.entity.components.get(MovementStateComponent)?.position)
                .toEqual(new Position(100, 100));
        });

    it('does NOT record an escort whose death was seen: destroyed stays '
        + 'destroyed', async () => {
            const { fleet, remove, escort } = await bench();
            await escort('doomed');
            // The DeathEvent subscriber ran during the frame's events.
            fleet.noteDeath('doomed');
            remove('doomed');
            expect(fleet.lost).toEqual([]);
        });

    it('does NOT record an escort a carry event already filed on a '
        + 'roster', async () => {
            const { fleet, remove, escort } = await bench();
            const ship = await escort('landing');
            fleet.pushCarried(fleet.landed,
                { player: PLAYER, uuid: 'landing', entity: ship });
            remove('landing');
            expect(fleet.lost).toEqual([]);
            expect(fleet.landed.length).toBe(1);
        });

    it('ignores mission ships — the mission machinery\'s business',
        async () => {
            const { fleet, remove, escort } = await bench();
            await escort('mission', PLAYER, ship => ship.components.set(
                MissionShipComponent, { mission: 'nova:500', owner: PLAYER }));
            remove('mission');
            expect(fleet.lost).toEqual([]);
            expect(fleet.lostFighters).toEqual([]);
        });

    it('ignores another player\'s escort when the local player is known, '
        + 'and drops one recorded between worlds at the take', async () => {
            const { fleet, remove, escort, serializer, display, frame }
                = await bench();
            await escort('theirs', OTHER);
            remove('theirs');
            expect(fleet.lost).toEqual([]);
            // Between worlds (no local player to compare against) the
            // marker's player is trusted...
            await escort('theirs-2', OTHER);
            spyOn(console, 'warn');
            applySimulationFrame(frame({ removed: ['theirs-2'] }), serializer,
                display, {
                onRemove: (uuid, entity) =>
                    fleet.noteRemoved(uuid, entity, undefined, serializer),
            });
            expect(fleet.lost.map(row => row.player)).toEqual([OTHER]);
            // ...and the take, which is per player, never hands it to
            // this client's batch.
            expect(fleet.takeLost(PLAYER)).toEqual([]);
            expect(fleet.lost).toEqual([]);
        });

    it('takes an escort back off the roster when the world re-adds it '
        + '(a correction that removed and restored it)', async () => {
            const { fleet, remove, escort } = await bench();
            spyOn(console, 'warn');
            await escort('flicker');
            remove('flicker');
            expect(fleet.lost.length).toBe(1);
            await escort('flicker');
            fleet.escortReturned('flicker');
            expect(fleet.lost).toEqual([]);
        });

    it('is taken into the next system entry\'s batch, minus anything the '
        + 'batch already carries under the same uuid', async () => {
            const { fleet, remove, escort } = await bench();
            spyOn(console, 'warn');
            await escort('lost-1');
            await escort('lost-2');
            remove('lost-1', 'lost-2');
            const taken = fleet.takeLost(PLAYER, ['lost-2']);
            expect(taken.map(row => row.uuid)).toEqual(['lost-1']);
            expect(fleet.lost).toEqual([]);
        });

    it('rides the save like the other rosters, so a lost escort survives '
        + 'the session too', async () => {
            const { fleet, remove, escort } = await bench();
            spyOn(console, 'warn');
            await escort('lost');
            remove('lost');
            expect(fleet.escortsToSave(PLAYER, undefined).map(e => e.uuid))
                .toEqual(['lost']);
            expect(fleet.summary().lost).toEqual([{ player: PLAYER, uuid: 'lost' }]);
            fleet.reset();
            expect(fleet.lost).toEqual([]);
        });
});

/**
 * ============================================================================
 * LOST FIGHTERS, OWED A ROUND (issue #258)
 * ============================================================================
 *
 * The same evidence, one more explained removal (a docking), and a
 * different remedy: a bay fighter is ammunition, so a lost one is not
 * respawned — its round goes back to the bay that launched it, through a
 * `refundFighter` input record sent when the fleet next goes into the
 * world (refundLostFighters). Destroyed gets nothing; docked already got
 * its round from the simulation.
 */
describe('the fleet ledger\'s lost fighters (issue #258)', () => {
    const PLAYER = 'player-uuid';
    const OTHER = 'somebody-else';
    const CARRIER = 'hired-carrier-uuid';
    const BAY = 'nova:150';
    const SHIP_ID = 'test:ship';

    function movement() {
        return {
            accelerating: 0, position: new Position(100, 100),
            rotation: new Angle(0), turnBack: false, turning: 0,
            velocity: new Vector(0, 0),
        };
    }

    async function bench() {
        const gameData = new MockGameData();
        gameData.data.Ship.map.set(SHIP_ID,
            { ...getDefaultShipData(), id: SHIP_ID });
        const world = await makeSystem('test:system', gameData, undefined,
            { npcs: false });
        const serializer = world.resources.get(SerializerResource)!;
        const display = new World('display');
        const fleet = new FleetLedger();

        function frame(parts: Partial<SimulationFrame>): SimulationFrame {
            return { added: [], changed: [], removed: [], events: [], ...parts };
        }

        /** A bay fighter of `player`, launched by `carrier`, mirrored. */
        async function fighter(uuid: string, carrier = PLAYER,
            player = PLAYER) {
            const ship = makeShip(gameData.data.Ship.map.get(SHIP_ID)!);
            ship.components.set(MovementStateComponent, movement());
            ship.components.set(PlayerEscortComponent,
                { player, parent: carrier });
            ship.components.set(BayFighterComponent, { bayWeaponId: BAY });
            ship.components.set(SourceComponent, carrier);
            await completeEntity(world, ship);
            applySimulationFrame(frame({ added: [[uuid, serializer.encode(ship)]] }),
                serializer, display);
            expect(display.entities.has(uuid)).toBeTrue();
            return ship;
        }

        function remove(...uuids: string[]) {
            applySimulationFrame(frame({ removed: uuids }), serializer, display, {
                emitEvents: true,
                onRemove: (uuid, entity) =>
                    fleet.noteRemoved(uuid, entity, PLAYER, serializer),
            });
        }

        /** The refund seam: what the bridge was asked to credit. */
        const refunds: FighterRefund[] = [];
        const bridge = {
            refundFighter: async (refund: FighterRefund) => {
                refunds.push(refund);
            },
        };
        const ctx = {
            fleet, gameData: gameData as unknown as SimulationGameData,
            ownerUuid: () => undefined,
        };
        spyOn(console, 'warn');
        return { fleet, display, fighter, remove, refunds, bridge, ctx };
    }

    it('records a fighter removed without a death, a docking or a carry '
        + 'with its carrier and bay — and NOT on the escort roster',
        async () => {
            const { fleet, fighter, remove } = await bench();
            await fighter('f1');
            remove('f1');
            expect(fleet.lost).toEqual([]);
            expect(fleet.lostFighters).toEqual([
                { player: PLAYER, uuid: 'f1', carrier: PLAYER, bayWeaponId: BAY },
            ]);
            expect(fleet.summary().lostFighters).toEqual(fleet.lostFighters);
            // A session roster: not in the save's escorts.
            expect(fleet.escortsToSave(PLAYER, undefined)).toEqual([]);
        });

    it('does NOT record a destroyed fighter, nor one that docked (its '
        + 'round was credited by the dock)', async () => {
            const { fleet, fighter, remove } = await bench();
            await fighter('doomed');
            await fighter('home');
            fleet.noteDeath('doomed');
            fleet.noteDocked('home');
            remove('doomed', 'home');
            expect(fleet.lostFighters).toEqual([]);
        });

    it('does NOT record a fighter a carry event filed, nor one with no '
        + 'carrier link to refund to', async () => {
            const { fleet, fighter, remove } = await bench();
            const landing = await fighter('landing');
            fleet.pushCarried(fleet.landed,
                { player: PLAYER, uuid: 'landing', entity: landing });
            await fighter('unlinked', PLAYER, PLAYER);
            fleet.escortReturned('unlinked');
            remove('landing');
            expect(fleet.lostFighters).toEqual([]);
        });

    it('takes a fighter back off the roster when the world re-adds it '
        + '(a correction that restored it), so nothing is refunded',
        async () => {
            const { fleet, fighter, remove } = await bench();
            await fighter('flicker');
            remove('flicker');
            expect(fleet.lostFighters.length).toBe(1);
            await fighter('flicker');
            fleet.escortReturned('flicker');
            expect(fleet.lostFighters).toEqual([]);
        });

    it('refunds the player\'s own fighter to the player at the fleet '
        + 'entry, and drops other peers\' entries', async () => {
            const { fleet, fighter, remove, refunds, bridge, ctx }
                = await bench();
            await fighter('mine');
            remove('mine');
            fleet.lostFighters.push(
                { player: OTHER, uuid: 'theirs', carrier: OTHER, bayWeaponId: BAY });
            await refundLostFighters(ctx, bridge, undefined, PLAYER, new Map());
            expect(refunds).toEqual([{ carrier: PLAYER, bayWeaponId: BAY }]);
            expect(fleet.lostFighters).toEqual([]);
        });

    it('refunds a hired carrier\'s fighter under the uuid the carrier was '
        + 'just re-inserted under, or the one it still flies under',
        async () => {
            const { fleet, fighter, remove, refunds, bridge, ctx, display }
                = await bench();
            await fighter('batch', CARRIER);
            await fighter('flight', 'in-flight-carrier');
            remove('batch', 'flight');
            display.entities.set('in-flight-carrier', new Entity('carrier')
                .addComponent(PlayerEscortComponent,
                    { player: PLAYER, parent: PLAYER }));
            await refundLostFighters(ctx, bridge, display, PLAYER,
                new Map([[CARRIER, 'fresh-carrier-uuid']]));
            expect(refunds).toEqual([
                { carrier: 'fresh-carrier-uuid', bayWeaponId: BAY },
                { carrier: 'in-flight-carrier', bayWeaponId: BAY },
            ]);
            expect(fleet.lostFighters).toEqual([]);
        });

    it('waits for a carrier that is still on a roster, and drops a '
        + 'fighter whose carrier is gone for good', async () => {
            const { fleet, fighter, remove, refunds, bridge, ctx, display }
                = await bench();
            await fighter('held', CARRIER);
            await fighter('orphan', 'destroyed-carrier');
            remove('held', 'orphan');
            fleet.jumping.push({ player: PLAYER, uuid: CARRIER,
                entity: new Entity('carrier') });
            await refundLostFighters(ctx, bridge, display, PLAYER, new Map());
            expect(refunds).toEqual([]);
            expect(fleet.lostFighters.map(row => row.uuid)).toEqual(['held']);
            // The held batch goes down: the carrier's fresh uuid resolves.
            fleet.jumping.length = 0;
            await refundLostFighters(ctx, bridge, display, PLAYER,
                new Map([[CARRIER, 'fresh-carrier-uuid']]));
            expect(refunds).toEqual([
                { carrier: 'fresh-carrier-uuid', bayWeaponId: BAY }]);
            expect(fleet.lostFighters).toEqual([]);
        });

    it('keeps a fighter whose refund the bridge refused, re-keyed to the '
        + 'carrier it resolved, for the next attempt', async () => {
            const { fleet, fighter, remove, refunds, ctx } = await bench();
            await fighter('retry', CARRIER);
            remove('retry');
            const refusing = {
                refundFighter: async () => { throw new Error('closed'); },
            };
            await refundLostFighters(ctx, refusing, undefined, PLAYER,
                new Map([[CARRIER, 'fresh-carrier-uuid']]));
            expect(fleet.lostFighters).toEqual([{
                player: PLAYER, uuid: 'retry', carrier: 'fresh-carrier-uuid',
                bayWeaponId: BAY,
            }]);
            const display = new World('display');
            display.entities.set('fresh-carrier-uuid', new Entity('carrier')
                .addComponent(PlayerEscortComponent,
                    { player: PLAYER, parent: PLAYER }));
            await refundLostFighters(ctx, {
                refundFighter: async (refund: FighterRefund) => {
                    refunds.push(refund);
                },
            }, display, PLAYER, new Map());
            expect(refunds).toEqual([
                { carrier: 'fresh-carrier-uuid', bayWeaponId: BAY }]);
            expect(fleet.lostFighters).toEqual([]);
        });

    it('is cleared by the session teardown', async () => {
        const { fleet, fighter, remove } = await bench();
        await fighter('gone');
        remove('gone');
        fleet.reset();
        expect(fleet.lostFighters).toEqual([]);
    });
});

/** A stand-in for a display-only component the mirror carries. */
import { Component } from 'nova_ecs/component';
const PixiSpriteStandIn = new Component<PIXI.Sprite>('PixiSpriteStandIn');
