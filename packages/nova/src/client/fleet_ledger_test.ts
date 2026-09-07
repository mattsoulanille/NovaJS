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
import { BayFighterComponent } from '../nova_plugin/escorts/bay_plugin.js';
import { makeSystem } from '../nova_plugin/make_system.js';
import { MissionShipComponent } from '../nova_plugin/player/mission_ship_component.js';
import { PlayerEscortComponent } from '../nova_plugin/player/player_escort.js';
import { makeShip } from '../nova_plugin/ship/make_ship.js';
import { completeEntity } from '../nova_plugin/spawn/entity_data_loader.js';
import { FleetLedger } from './fleet_ledger.js';

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

    it('ignores bay fighters and mission ships — the magazine\'s and the '
        + 'mission machinery\'s business', async () => {
            const { fleet, remove, escort } = await bench();
            await escort('fighter', PLAYER, ship => ship.components.set(
                BayFighterComponent, { bayWeaponId: 'nova:150', slot: 0 } as never));
            await escort('mission', PLAYER, ship => ship.components.set(
                MissionShipComponent, { mission: 'nova:500', owner: PLAYER }));
            remove('fighter', 'mission');
            expect(fleet.lost).toEqual([]);
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

/** A stand-in for a display-only component the mirror carries. */
import { Component } from 'nova_ecs/component';
const PixiSpriteStandIn = new Component<PIXI.Sprite>('PixiSpriteStandIn');
