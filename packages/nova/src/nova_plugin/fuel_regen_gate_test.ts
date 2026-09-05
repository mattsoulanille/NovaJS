import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultOutfitData } from 'novadatainterface/outfit_data';
import { getDefaultShipData, getDefaultShipPhysics, ShipData } from 'novadatainterface/ship_data';
import { World } from 'nova_ecs/world';
import { getPluginGameData } from '../communication/simulation_test_fixture.js';
import { completeEntity } from './entity_data_loader.js';
import { FuelComponent } from './health_plugin.js';
import { makeShip } from './make_ship.js';
import { makeSystem, SIMULATION_STEP_MS } from './make_system.js';
import { ControlledByComponent } from './ship_control.js';
import { shipFuelBounds, ShipPhysicsComponent } from './ship_plugin.js';

/**
 * shïp Flags 0x0008, "Player ship takes advantage of FuelRegen property"
 * (EVN Bible ~:2517): a class's built-in FuelRegen (~:2554) is for its AI
 * pilots unless the flag is set — "this allows you to give enemy ships
 * built-in fuel scoops but still make the player have to buy his own".
 *
 * Every stock regenerating class sets the flag, so this is about plug-in
 * hulls: thirteen regenerate without it (the Purveyor, arpia's JTH
 * Thunderforge, the Star Wars Mod's X-wing) and arpia's Frandall/Uhngys
 * carry FuelRegen -1, which the unconditional conversion turned into a
 * 30-unit-per-second DRAIN for a player flying one.
 */
describe('shïp FuelRegen and the player gate (Flags 0x0008)', () => {
    const SHIP_ID = 'test:ship';
    const SCOOP_ID = 'test:scoop';

    async function bench(regenPerSecond: number, playerFuelRegen: boolean,
        { playerFlown = true, scoop = 0 } = {}) {
        const gameData = new MockGameData();
        // A fuel scoop outfit (ModType 18), which the gate must leave alone.
        gameData.data.Outfit.map.set(SCOOP_ID, {
            ...getDefaultOutfitData(), id: SCOOP_ID,
            physics: { freeMass: 0, energyRecharge: scoop },
        });
        const shipData: ShipData = {
            ...getDefaultShipData(), id: SHIP_ID, playerFuelRegen,
            outfits: scoop > 0 ? { [SCOOP_ID]: 1 } : {},
            physics: {
                ...getDefaultShipPhysics(), energy: 300,
                energyRecharge: regenPerSecond,
            },
        };
        gameData.data.Ship.map.set(SHIP_ID, shipData);
        const world = await makeSystem('test:system', gameData);
        const ship = makeShip(shipData);
        if (playerFlown) {
            ship.components.set(ControlledByComponent, { peerId: 'peer-1' });
        }
        await completeEntity(world, ship);
        world.entities.set('ship uuid', ship);
        await stepWorld(world, 2);
        return { world, ship, shipData };
    }

    async function stepWorld(world: World, steps: number) {
        for (let i = 0; i < steps; i++) {
            world.step();
            await new Promise(resolve => setImmediate(resolve));
        }
    }

    describe('shipFuelBounds', () => {
        const hull = (energyRecharge: number, playerFuelRegen: boolean) => ({
            ...getDefaultShipData(), playerFuelRegen,
            physics: { ...getDefaultShipPhysics(), energy: 300, energyRecharge },
        });

        it('keeps the hull regen for an AI-flown ship either way', () => {
            const physics = { ...getDefaultShipPhysics(), energy: 300, energyRecharge: 7 };
            expect(shipFuelBounds(physics, hull(7, false), false).recharge).toBe(7);
            expect(shipFuelBounds(physics, hull(7, true), false).recharge).toBe(7);
        });

        it('keeps it for the player only when the flag is set', () => {
            const physics = { ...getDefaultShipPhysics(), energy: 300, energyRecharge: 7 };
            expect(shipFuelBounds(physics, hull(7, true), true).recharge).toBe(7);
            expect(shipFuelBounds(physics, hull(7, false), true).recharge).toBe(0);
        });

        it('subtracts only the HULL share, leaving outfit scoops', () => {
            // Hull 7 + scoop 3, as applyOutfitPhysics sums them.
            const physics = { ...getDefaultShipPhysics(), energy: 300, energyRecharge: 10 };
            expect(shipFuelBounds(physics, hull(7, false), true).recharge).toBe(3);
        });

        it('gates a NEGATIVE ("fuel sucking") hull regen too', () => {
            const physics = { ...getDefaultShipPhysics(), energy: 300, energyRecharge: -30 };
            expect(shipFuelBounds(physics, hull(-30, false), true).recharge).toBe(0);
            expect(shipFuelBounds(physics, hull(-30, true), true).recharge).toBe(-30);
        });
    });

    it('does not regenerate a player-flown hull whose class lacks the flag',
        async () => {
            const { world, ship } = await bench(10, false);
            const fuel = ship.components.get(FuelComponent)!;
            fuel.current = 100;
            await stepWorld(world, 60);
            expect(fuel.current).toBe(100);
        });

    it('regenerates it when the class sets the flag', async () => {
        const { world, ship } = await bench(10, true);
        const fuel = ship.components.get(FuelComponent)!;
        fuel.current = 100;
        await stepWorld(world, 60);
        expect(fuel.current).toBeCloseTo(
            100 + 10 * 60 * SIMULATION_STEP_MS / 1000, 0);
    });

    it('regenerates an AI-flown hull regardless of the flag', async () => {
        const { world, ship } = await bench(10, false, { playerFlown: false });
        const fuel = ship.components.get(FuelComponent)!;
        fuel.current = 100;
        await stepWorld(world, 60);
        expect(fuel.current).toBeCloseTo(
            100 + 10 * 60 * SIMULATION_STEP_MS / 1000, 0);
    });

    it('does NOT drain a player flying a FuelRegen -1 hull (arpia:421)',
        async () => {
            // Before the gate: FPS / -1 = -30 units per second, a whole
            // 300-unit tank gone in ten seconds.
            const { world, ship } = await bench(-30, false);
            const fuel = ship.components.get(FuelComponent)!;
            fuel.current = 300;
            await stepWorld(world, 60);
            expect(fuel.current).toBe(300);
        });

    it('leaves a bought fuel scoop working on an unflagged hull', async () => {
        const { world, ship } = await bench(10, false, { scoop: 4 });
        const physics = ship.components.get(ShipPhysicsComponent)!;
        expect(physics.energyRecharge).toBe(14);
        const fuel = ship.components.get(FuelComponent)!;
        fuel.current = 100;
        await stepWorld(world, 60);
        expect(fuel.current).toBeCloseTo(
            100 + 4 * 60 * SIMULATION_STEP_MS / 1000, 0);
    });

    it('pins the arpia data the gate exists for', async () => {
        const gameData = await getPluginGameData('arpia');
        if (!gameData) {
            pending('arpia plug-in not installed');
            return;
        }
        // Frandall: FuelRegen -1, Flags 0x114 (0x0008 clear).
        const frandall = await gameData.data.Ship.get('arpia:421');
        expect(frandall.physics.energyRecharge).toBe(-30);
        expect(frandall.playerFuelRegen).toBe(false);
        // JTH Thunderforge: FuelRegen 25, flag clear.
        const thunderforge = await gameData.data.Ship.get('arpia:600');
        expect(thunderforge.physics.energyRecharge).toBeCloseTo(30 / 25, 6);
        expect(thunderforge.playerFuelRegen).toBe(false);
        // ...and a stock regenerating class does set it (the Scarab, shïp
        // 162: FuelRegen 10 -> 3 units/s, Flags 0x0008 set).
        const scarab = await gameData.data.Ship.get('nova:162');
        expect(scarab.physics.energyRecharge).toBe(3);
        expect(scarab.playerFuelRegen).toBe(true);
    });
});
