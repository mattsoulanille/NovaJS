import 'jasmine';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { World } from 'nova_ecs/world';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { getSyntheticGameData } from '../../communication/simulation_test_fixture.js';
import { GovtComponent } from '../core/index.js';
import { makeSystem } from '../make_system.js';
import { FormationComponent, NpcComponent } from '../npc/index.js';
import {
    ControlledByComponent, EscortCommandComponent, MissionShipComponent,
} from '../player/index.js';
import {
    makeShip, OutfitsStateComponent, TargetComponent, WeaponsStateComponent,
} from '../ship/index.js';
import { completeEntity } from '../spawn/index.js';
import { BayFighterComponent } from './bay_plugin.js';

/**
 * ============================================================================
 * NPC carriers on real (synthetic) data: launch, fight, recover
 * ============================================================================
 *
 * Reference "B NPC carrier wave 5": a stock Fed Carrier in ordinary
 * traffic, hostile to the player, launched its Vipers and Anacondas; a
 * ShipBehav 1 carrier protecting the player never launched (Q4). Here
 * the Heron Warden (Skiff Bay, two skiffs aboard) runs the whole chain
 * on hulls with real collision shapes, so the recovery at the end is a
 * real flight home and a real docking, not a hand-emitted contact.
 */

const WARDEN = SYNTHETIC.ships.warden;
const CORSAIR = SYNTHETIC.ships.corsair;
const SKIFF = SYNTHETIC.ships.skiff;
const SKIFF_BAY = SYNTHETIC.weapons.skiffBay;
const MERIDIAN = SYNTHETIC.govts.meridian;
const RAIDERS = SYNTHETIC.govts.raiders;

type GameData = Awaited<ReturnType<typeof getSyntheticGameData>>;

describe('NPC carriers (synthetic data)', () => {
    let gameData: GameData;
    let world: World;

    beforeEach(async () => {
        gameData = await getSyntheticGameData();
        // Thessaly Reach: no asteroids; npcs off, so only these ships.
        world = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            undefined, { npcs: false });
    });

    async function addShip(uuid: string, shipId: string, x: number, y: number,
        setup: (ship: Entity) => void = () => { }) {
        const ship = makeShip(await gameData.data.Ship.get(shipId));
        ship.components.set(MultiplayerData, { owner: 'server' });
        setup(ship);
        await completeEntity(world, ship);
        ship.components.set(MovementStateComponent, {
            position: new Position(x, y),
            velocity: new Vector(0, 0),
            rotation: new Angle(0),
            accelerating: 0,
            turning: 0,
            turnBack: false,
        });
        world.entities.set(uuid, ship);
        return ship;
    }

    /** A Meridian warship carrier set on `victim`, as a ShipBehav 0
     * mission ship or a provoked warship would be. */
    function addCarrier(victim: string,
        setup: (ship: Entity) => void = () => { }) {
        return addShip('carrier', WARDEN, 0, 0, ship => {
            ship.components.set(NpcComponent,
                { aiType: 3, aggressor: victim });
            ship.components.set(GovtComponent, { id: MERIDIAN });
            ship.components.set(TargetComponent, { target: victim });
            setup(ship);
        });
    }

    function step(ticks: number) {
        for (let i = 0; i < ticks; i++) {
            world.step();
        }
    }

    function wings(): [string, Entity][] {
        return [...world.entities].filter(([, entity]) =>
            entity.components.has(BayFighterComponent));
    }

    /** Skiffs left in the carrier's magazine. */
    function magazine(carrier: Entity): number {
        let total = 0;
        for (const [id, outfit] of carrier.components
            .get(OutfitsStateComponent) ?? []) {
            if (gameData.data.Outfit.getCached(id)?.ammoFor === SKIFF_BAY) {
                total += outfit.count;
            }
        }
        return total;
    }

    it('launches its skiffs one per reload at the ship it attacks, then '
        + 'recovers them when the fight ends', async () => {
            await addShip('raider', CORSAIR, 600, 0, ship => {
                // A parked raider: a target that does not fly off.
                ship.components.set(GovtComponent, { id: RAIDERS });
            });
            const carrier = await addCarrier('raider');
            const full = magazine(carrier);
            expect(full).withContext('skiffs aboard').toBe(2);

            // Launch ticks, one per new wing.
            const launches: number[] = [];
            for (let tick = 0; tick < 60 * 10 && launches.length < 2;
                tick++) {
                step(1);
                if (wings().length > launches.length) {
                    launches.push(tick);
                }
            }
            expect(carrier.components.get(NpcComponent)!.mode).toBe('attack');
            expect(launches.length).withContext('both skiffs out').toBe(2);
            // One per reload, not both at once: the Skiff Bay's Reload
            // is 60 frames of the original's 30 fps, two seconds.
            expect(launches[1] - launches[0]).toBeGreaterThanOrEqual(110);
            expect(magazine(carrier)).toBe(0);
            for (const [, wing] of wings()) {
                expect(wing.components.get(EscortCommandComponent))
                    .toEqual({ command: 'attack', target: 'raider' });
                expect(wing.components.get(GovtComponent))
                    .toEqual({ id: MERIDIAN });
            }

            // The raider leaves (or dies): the carrier stops fighting and
            // its wings fly home and dock, restocking the bay.
            world.entities.delete('raider');
            let docked = false;
            for (let i = 0; i < 60 * 30 && !docked; i++) {
                step(1);
                docked = wings().length === 0;
            }
            expect(carrier.components.get(NpcComponent)!.mode)
                .not.toBe('attack');
            expect(docked).withContext('both skiffs docked').toBeTrue();
            expect(magazine(carrier)).toBe(full);
        });

    it('holds its skiffs while protecting the player (reference Q4)',
        async () => {
            await addShip('player', SKIFF, 0, 300, ship => {
                ship.components.set(ControlledByComponent, { peerId: 'p' });
            });
            await addShip('raider', CORSAIR, 600, 0, ship => {
                ship.components.set(GovtComponent, { id: RAIDERS });
            });
            const carrier = await addCarrier('raider', ship => {
                // What mission_ship_spawn gives a ShipBehav 1 ship.
                ship.components.set(FormationComponent,
                    { leader: 'player', slot: 0 });
                ship.components.set(MissionShipComponent,
                    { mission: 'test:mission', owner: 'player' });
            });
            step(180);

            expect(carrier.components.get(NpcComponent)!.mode).toBe('attack');
            // Its guns are in the fight...
            const weapons = carrier.components.get(WeaponsStateComponent)!;
            expect([...weapons].some(([id, weapon]) =>
                id !== SKIFF_BAY && weapon.firing)).toBeTrue();
            // ...its hangar is not.
            expect(weapons.get(SKIFF_BAY)!.firing).toBeFalse();
            expect(wings().length).toBe(0);
            expect(magazine(carrier)).toBe(2);
        });
});
