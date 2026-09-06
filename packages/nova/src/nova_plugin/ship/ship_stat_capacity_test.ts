import 'jasmine';
import { isLeft } from 'fp-ts/lib/Either.js';
import { Entity } from 'nova_ecs/entity';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { MovementPhysicsComponent } from 'nova_ecs/plugins/movement_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { World } from 'nova_ecs/world';
import { v4 } from 'uuid';
import { applySimulationInputs } from '../../communication/simulation_input.js';
import { getPluginGameData } from '../../communication/simulation_test_fixture.js';
import { completeEntity, loadEntityGameData } from '../spawn/entity_data_loader.js';
import { ArmorComponent, FuelComponent, ShieldComponent } from './health_plugin.js';
import { makeShip } from './make_ship.js';
import { makeSystem } from '../make_system.js';
import { OutfitsStateComponent } from './outfit_plugin.js';
import { PlayerShipSelector } from '../player/player_ship_plugin.js';
import { ShipPhysicsComponent } from './ship_plugin.js';
import { WeaponsStateComponent } from './weapons_state.js';

/**
 * A ship's capacities (fuel/energy, shields, armor) and its movement
 * physics are DERIVED from ShipPhysicsComponent, which is itself derived
 * from the hull plus the outfits the ship owns. This pins that they
 * follow an outfit change made at the spaceport — the real bug report
 * behind the reconciling systems in ship_plugin.ts.
 *
 * The reported symptom: an Abomination (shïp nova:239, "energy" 400)
 * carrying two Organic Armors (-200 energy each) and three Battery Packs
 * (+100 each) has a 300-unit tank — three hyperspace jumps — but the
 * status bar and the jump check saw 100, then 200, on two occasions, and
 * a page reload cleared it.
 *
 * The cause was the derivation's trigger, not its arithmetic:
 * `Provide` re-derives on a ChangeEvent, ChangeEvents fire only for
 * components set on an entity already IN a world, and every rebuild of a
 * ship's physics happens off-world on a detached entity — the outfitter
 * deletes ShipPhysicsComponent from the docked (removed) ship, and the
 * relaunch re-derives it in deriveEntityComponents before the entity
 * goes back into the world. The stats are serializer-registered, so they
 * came back carrying the capacity of the outfit set from BEFORE the
 * purchase, and Stat.step then clamped `current` down into that stale
 * tank every tick.
 *
 * Real plug-in data: the energy-modifying outfits of the reported pilot
 * are stock plus Extra Outfits, so the spec skips itself when that
 * plug-in is not installed.
 */
describe('ship capacities after an outfit change', () => {
    const EXTRA = 'extra-outfits';
    /** Abomination; Dechanik. shïp "energy" 400. */
    const SHIP = 'nova:239';
    /** Battery Pack: +100 energy (one jump) each. */
    const BATTERY = 'nova:256';
    /** Organic Armor: +armor, -200 energy each. */
    const ORGANIC_ARMOR = `${EXTRA}:502`;
    /** Energy Distributor: +40 energy. */
    const ENERGY_DISTRIBUTOR = `${EXTRA}:634`;
    /** Shield Enhancer: +shield, -10 energy each. */
    const SHIELD_ENHANCER = `${EXTRA}:635`;
    /** Matrix Steel: +armor, -0.6 speed each. */
    const MATRIX_STEEL = 'nova:181';

    /** The pilot's energy-relevant loadout, with the counts as given. */
    function loadout(counts: {
        batteries?: number,
        organicArmor?: number,
        energyDistributor?: number,
        shieldEnhancers?: number,
        matrixSteel?: number,
    }) {
        const outfits = new Map<string, { count: number }>();
        const add = (id: string, count = 0) => {
            if (count > 0) {
                outfits.set(id, { count });
            }
        };
        add(ENERGY_DISTRIBUTOR, counts.energyDistributor);
        add(SHIELD_ENHANCER, counts.shieldEnhancers);
        add(ORGANIC_ARMOR, counts.organicArmor);
        add(BATTERY, counts.batteries);
        add(MATRIX_STEEL, counts.matrixSteel);
        return outfits;
    }

    interface Bench {
        world: World;
        uuid: string;
        ship: Entity;
        /**
         * Lands, changes the ship's outfits the way the outfitter does,
         * and takes off again — through the real paths: the outfitter
         * mutates the DETACHED docked entity and deletes the components
         * that must be rebuilt (spaceport.ts showOutfitter), and the
         * relaunch stages the entity and inserts it as an 'addEntity'
         * simulation input (browser.ts -> simulation_bridge ->
         * simulation_input.ts).
         */
        revisitOutfitter(outfits: Map<string, { count: number }>):
            Promise<Entity>;
    }

    async function bench(outfits: Map<string, { count: number }>):
        Promise<Bench | undefined> {
        const gameData = await getPluginGameData(EXTRA);
        if (!gameData) {
            return undefined;
        }
        // Any real system will do; nova:344 is the one the reported
        // pilot was saved in. No ambient traffic: the spec is about one
        // ship's stats.
        const world = await makeSystem('nova:344', gameData, undefined,
            { npcs: false });
        const shipData = await gameData.data.Ship.get(SHIP);
        const ship = makeShip(shipData);
        const uuid = v4();
        ship.components.set(MultiplayerData, { owner: 'server' });
        ship.components.set(PlayerShipSelector, undefined);
        ship.components.set(OutfitsStateComponent, outfits);
        await completeEntity(world, ship);
        world.entities.set(uuid, ship);
        for (let i = 0; i < 3; i++) {
            world.step();
        }

        const serializer = world.resources.get(SerializerResource);
        if (!serializer) {
            throw new Error('Expected the simulation serializer');
        }

        return {
            world, uuid, ship,
            async revisitOutfitter(newOutfits) {
                // Landing: the sim drops the ship; the display's mirror
                // of it (an encode/decode round trip away) is what docks.
                const docked = serializer.decode(serializer.encode(
                    world.entities.get(uuid)!));
                if (isLeft(docked)) {
                    throw new Error('Failed to decode the docked ship');
                }
                world.entities.delete(uuid);
                world.step();

                // The outfitter, on the detached entity.
                docked.right.components.set(OutfitsStateComponent, newOutfits);
                docked.right.components.delete(WeaponsStateComponent);
                docked.right.components.delete(ShipPhysicsComponent);

                // Departure: staged, then inserted as an input.
                const encoded = serializer.encode(docked.right);
                const staged = serializer.decode(encoded);
                if (isLeft(staged)) {
                    throw new Error('Failed to decode the launching ship');
                }
                await loadEntityGameData(world, staged.right);
                applySimulationInputs(world,
                    [{ kind: 'addEntity', uuid, entity: encoded }]);
                for (let i = 0; i < 3; i++) {
                    world.step();
                }
                return world.entities.get(uuid)!;
            },
        };
    }

    it('derives the reported pilot\'s 300-unit tank', async () => {
        // 400 (hull) + 40 (distributor) - 40 (4 enhancers)
        //   - 400 (2 organic armors) + 300 (3 batteries) = 300.
        const started = await bench(loadout({
            batteries: 3, organicArmor: 2,
            energyDistributor: 1, shieldEnhancers: 4,
        }));
        if (!started) {
            pending('Extra Outfits plug-in not installed');
            return;
        }
        expect(started.ship.components.get(ShipPhysicsComponent)?.energy)
            .toBe(300);
        expect(started.ship.components.get(FuelComponent)?.max).toBe(300);
    });

    it('raises the fuel capacity when battery packs are bought',
        async () => {
            // The reported session: one battery pack when the pilot was
            // loaded (a 100-unit tank), two more bought at the outfitter.
            const started = await bench(loadout({
                batteries: 1, organicArmor: 2,
                energyDistributor: 1, shieldEnhancers: 4,
            }));
            if (!started) {
                pending('Extra Outfits plug-in not installed');
                return;
            }
            expect(started.ship.components.get(FuelComponent)?.max).toBe(100);

            const launched = await started.revisitOutfitter(loadout({
                batteries: 3, organicArmor: 2,
                energyDistributor: 1, shieldEnhancers: 4,
            }));
            expect(launched.components.get(ShipPhysicsComponent)?.energy)
                .toBe(300);
            // The bug: 100, the capacity of the pre-purchase loadout.
            expect(launched.components.get(FuelComponent)?.max).toBe(300);
        });

    it('does not fill the tank it just enlarged', async () => {
        const started = await bench(loadout({
            batteries: 1, organicArmor: 2,
            energyDistributor: 1, shieldEnhancers: 4,
        }));
        if (!started) {
            pending('Extra Outfits plug-in not installed');
            return;
        }
        // Spend most of a jump's worth of fuel.
        started.ship.components.get(FuelComponent)!.current = 40;

        const launched = await started.revisitOutfitter(loadout({
            batteries: 3, organicArmor: 2,
            energyDistributor: 1, shieldEnhancers: 4,
        }));
        const fuel = launched.components.get(FuelComponent)!;
        expect(fuel.max).toBe(300);
        // Capacity is not fuel: buying a Battery Pack does not refuel.
        // (A fuel scoop's recharge adds a little back over the ticks the
        // relaunch takes, so this is bounded rather than exact.)
        expect(fuel.current).toBeLessThan(100);
    });

    it('spills the fuel that no longer fits when a tank is sold',
        async () => {
            const started = await bench(loadout({
                batteries: 3, organicArmor: 2,
                energyDistributor: 1, shieldEnhancers: 4,
            }));
            if (!started) {
                pending('Extra Outfits plug-in not installed');
                return;
            }
            expect(started.ship.components.get(FuelComponent)?.current)
                .toBe(300);

            const launched = await started.revisitOutfitter(loadout({
                batteries: 1, organicArmor: 2,
                energyDistributor: 1, shieldEnhancers: 4,
            }));
            const fuel = launched.components.get(FuelComponent)!;
            expect(fuel.max).toBe(100);
            expect(fuel.current).toBeLessThanOrEqual(100);
        });

    it('raises the shield and armor capacity the same way', async () => {
        const started = await bench(loadout({ batteries: 3 }));
        if (!started) {
            pending('Extra Outfits plug-in not installed');
            return;
        }
        const bareShield = started.ship.components.get(ShieldComponent)!.max;
        const bareArmor = started.ship.components.get(ArmorComponent)!.max;

        const launched = await started.revisitOutfitter(
            loadout({ batteries: 3, shieldEnhancers: 4, organicArmor: 2 }));
        const physics = launched.components.get(ShipPhysicsComponent)!;
        expect(physics.shield).toBeGreaterThan(bareShield);
        expect(physics.armor).toBeGreaterThan(bareArmor);
        expect(launched.components.get(ShieldComponent)?.max)
            .toBe(physics.shield);
        expect(launched.components.get(ArmorComponent)?.max)
            .toBe(physics.armor);
    });

    // MovementPhysicsComponent crosses the landing the same way the stats
    // do, and ShipMovementPhysicsProvider does NOT re-derive it either —
    // EffectiveMovementPhysicsSystem (afterburner_plugin.ts) rewrites its
    // fields from ShipPhysicsComponent every tick, which is what keeps
    // speed following the outfits. This pins that arrangement: if that
    // per-tick rewrite ever goes away, speed and turn rate acquire the
    // staleness the stats had.
    it('follows an outfit that changes speed', async () => {
        const started = await bench(loadout({ batteries: 3 }));
        if (!started) {
            pending('Extra Outfits plug-in not installed');
            return;
        }
        const bareSpeed =
            started.ship.components.get(MovementPhysicsComponent)!.maxVelocity;

        // Four Matrix Steel plates: -0.6 speed each.
        const launched = await started.revisitOutfitter(
            loadout({ batteries: 3, matrixSteel: 4 }));
        const physics = launched.components.get(ShipPhysicsComponent)!;
        expect(physics.speed).toBeLessThan(bareSpeed);
        expect(launched.components.get(MovementPhysicsComponent)?.maxVelocity)
            .toBe(physics.speed);
    });
});
