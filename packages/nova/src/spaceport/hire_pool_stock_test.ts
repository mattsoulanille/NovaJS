import 'jasmine';
import { GameDataAggregator } from '../server/parsing/game_data_aggregator.js';
import { PlanetData } from 'novadatainterface/planet_data';
import { ShipData } from 'novadatainterface/ship_data';
import {
    getIntegrationGameData, getPluginGameData,
} from '../communication/simulation_test_fixture.js';
import { meetsTechLevel } from './outfitter_rules.js';
import { shipHireable, ShipyardContext } from './shipyard_stock_rules.js';

/**
 * The bar's hire pool against REAL data.
 *
 * Matthew, 2026-08-18: "I can't hire TAM drones (or any escorts) at
 * Tektaara Station." Tektaara Station is Extra Outfits' spöb 800 in Obatta
 * — canLand + hasBar + hasOutfitter + isStation, no shipyard — and its
 * spöb TechLevel is -1 with SpecialTech 10000. Its whole stock, ships
 * included, therefore hangs off the exact SpecialTech match; the hire pool
 * used to test `ship.techLevel <= planet.techLevel` alone, which at
 * TechLevel -1 is empty for every ship in the game.
 *
 * Verbatim parsed data these specs pin:
 *   spöb extra-outfits:800  Tektaara Station  TechLevel -1  SpecialTech [10000]
 *   shïp extra-outfits:800  Anti-Missile Drone
 *                           TechLevel 10000  HireRandom 100  BuyRandom 0
 *                           Availability ""  Cost 500000  Require 0x0
 *   shïp extra-outfits:816  Offensive Drone
 *                           TechLevel 10000  HireRandom 0  (never hireable)
 */
describe('hire pool against real data', () => {
    const TEKTAARA = 'extra-outfits:800';
    /** The Anti-Missile Drone — same resource NUMBER, shïp not spöb. */
    const AM_DRONE = 'extra-outfits:800';
    const OFFENSIVE_DRONE = 'extra-outfits:816';

    async function pool(gameData: GameDataAggregator, planetId: string,
        over: Partial<ShipyardContext> = {}): Promise<Set<string>> {
        const planet: PlanetData =
            await gameData.data.Planet.get(planetId);
        const ids = (await gameData.ids).Ship;
        const ships: ShipData[] = await Promise.all(
            ids.map(id => gameData.data.Ship.get(id)));
        const ctx: ShipyardContext = {
            planet: {
                techLevel: planet.techLevel,
                specialTech: planet.specialTech,
            },
            bits: new Set(),
            contribute: 0n,
            day: 0,
            stellarId: 800,
            ...over,
        };
        return new Set(ships.filter(ship => shipHireable(ship, ctx))
            .map(ship => ship.id));
    }

    describe('Extra Outfits: Tektaara Station', () => {
        it('parses the stellar as TechLevel -1 with SpecialTech 10000',
            async () => {
                const gameData = await getPluginGameData(['extra-outfits']);
                if (!gameData) {
                    pending('Extra Outfits plug-in not installed');
                    return;
                }
                const planet = await gameData.data.Planet.get(TEKTAARA);
                expect(planet.name).toBe('Tektaara Station');
                expect(planet.techLevel).toBe(-1);
                expect(planet.specialTech).toEqual([10000]);
                // Hiring is a BAR function (EVN Bible, shïp HireRandom),
                // and Tektaara has a bar but deliberately no shipyard —
                // so the hire pool must not be gated on hasShipyard.
                expect(planet.flags.hasBar).toBeTrue();
                expect(planet.flags.hasShipyard).toBeFalse();
                expect(planet.flags.canLand).toBeTrue();
                expect(planet.flags.isStation).toBeTrue();
            });

        it('parses the Anti-Missile Drone as a hire-only tech-10000 ship',
            async () => {
                const gameData = await getPluginGameData(['extra-outfits']);
                if (!gameData) {
                    pending('Extra Outfits plug-in not installed');
                    return;
                }
                const drone = await gameData.data.Ship.get(AM_DRONE);
                expect(drone.name).toBe('Anti-Missile Drone');
                expect(drone.techLevel).toBe(10000);
                expect(drone.hireRandom).toBe(100);
                // Never SOLD, only hired: gating the pool on BuyRandom
                // would drop it again.
                expect(drone.buyRandom).toBe(0);
                expect(drone.availability).toBe('');
                expect(drone.price).toBe(500000);
                expect(drone.require).toBe('0x0');
            });

        it('puts the drone in the hire pool at Tektaara', async () => {
            const gameData = await getPluginGameData(['extra-outfits']);
            if (!gameData) {
                pending('Extra Outfits plug-in not installed');
                return;
            }
            // HireRandom 100 means the day's roll always hits, so no day
            // needs forcing; the pool is the same on every day.
            const today = await pool(gameData, TEKTAARA, { day: 0 });
            const later = await pool(gameData, TEKTAARA, { day: 4321 });
            expect(today).toEqual(later);
            expect(today.has(AM_DRONE)).toBeTrue();
            // The Offensive Drone shares the tech level but has
            // HireRandom 0: stocked here, never flown by a pilot.
            expect(today.has(OFFENSIVE_DRONE)).toBeFalse();
            // And nothing from the ordinary tech ladder leaks in: at
            // TechLevel -1 the SpecialTech match is the ONLY way in.
            for (const id of today) {
                const ship = await gameData.data.Ship.get(id);
                expect(ship.techLevel).toBe(10000);
            }
        });
    });

    describe('stock data', () => {
        /** Earth (nova:128): TechLevel 7, SpecialTech [14,20,55,57,80,116],
         * bar + shipyard — the busiest stock spöb there is. */
        const EARTH = 'nova:128';
        /** nova:167 Viper; Fighter: TechLevel 4, HireRandom 95,
         * Availability "!b424", Require 0x0, Cost 80000. */
        const VIPER = 'nova:167';

        it('leaves an ordinary stock planet with its pool intact',
            async () => {
                const gameData = await getIntegrationGameData();
                const planet = await gameData.data.Planet.get(EARTH);
                expect(planet.techLevel).toBe(7);
                // Sampled across a long stretch of days rather than one,
                // so the HireRandom roll can't make this flaky.
                let empty = 0;
                let withViper = 0;
                for (let day = 0; day < 100; day++) {
                    const ships = await pool(gameData, EARTH,
                        { stellarId: 128, day });
                    if (ships.size === 0) {
                        empty++;
                    }
                    if (ships.has(VIPER)) {
                        withViper++;
                    }
                }
                expect(empty).toBe(0);
                // A 95%-HireRandom, tech-4, ungated ship at a tech-7
                // world: practically every day.
                expect(withViper).toBeGreaterThan(80);
            });

        it('admits nothing the stellar does not stock', async () => {
            const gameData = await getIntegrationGameData();
            const planet = await gameData.data.Planet.get(EARTH);
            const ships = await pool(gameData, EARTH,
                { stellarId: 128, day: 12345 });
            expect(ships.size).toBeGreaterThan(0);
            for (const id of ships) {
                const ship = await gameData.data.Ship.get(id);
                expect(meetsTechLevel(ship.techLevel, {
                    techLevel: planet.techLevel,
                    specialTech: planet.specialTech,
                })).toBeTrue();
                expect(ship.hireRandom).toBeGreaterThan(0);
                expect(ship.price).toBeGreaterThan(0);
            }
        });

        it('hires the ships a stock world carries by SpecialTech',
            async () => {
                // The whole stock spöb table tops out at TechLevel 7, so
                // EVERY ship above tech 7 — the Fed, pirate, rebel and
                // alien hulls — reaches a bar only through an exact
                // SpecialTech match. The old `techLevel <= planet.techLevel`
                // pool could therefore never offer one anywhere.
                //
                // nova:144 Fed Viper; Fighter: TechLevel 14, HireRandom 35,
                // Availability "b68", Require 0x0. Earth lists 14 in its
                // SpecialTech.
                const gameData = await getIntegrationGameData();
                const earth = await gameData.data.Planet.get(EARTH);
                expect(earth.specialTech).toContain(14);
                const fedViper = await gameData.data.Ship.get('nova:144');
                expect(fedViper.techLevel).toBe(14);
                expect(fedViper.availability).toBe('b68');
                expect(fedViper.techLevel)
                    .toBeGreaterThan(earth.techLevel);
                let offered = 0;
                for (let day = 0; day < 200; day++) {
                    const ships = await pool(gameData, EARTH,
                        { stellarId: 128, day, bits: new Set([68]) });
                    if (ships.has('nova:144')) {
                        offered++;
                    }
                }
                expect(offered).toBeGreaterThan(0);
            });

        it('does not hire ships whose Availability is false', async () => {
            const gameData = await getIntegrationGameData();
            // nova:177 Rebel Viper: TechLevel 15, HireRandom 80,
            // Availability "b130". A tech-20 world hires it only once the
            // player carries b130.
            const rebelViper = await gameData.data.Ship.get('nova:177');
            expect(rebelViper.availability).toBe('b130');
            const ctx = (bits: number[], day: number): ShipyardContext => ({
                planet: { techLevel: 20, specialTech: [] },
                bits: new Set(bits), contribute: 0n,
                day, stellarId: 154,
            });
            // Its HireRandom is 80, so "with the bit" is a per-day roll;
            // "without the bit" must be a flat no on every day.
            let withBit = 0;
            for (let day = 0; day < 100; day++) {
                expect(shipHireable(rebelViper, ctx([], day))).toBeFalse();
                if (shipHireable(rebelViper, ctx([130], day))) {
                    withBit++;
                }
            }
            expect(withBit).toBeGreaterThan(50);
        });

        it('keeps the SpecialTech-only plug-in drones out of stock pools',
            async () => {
                const gameData = await getPluginGameData(['extra-outfits']);
                if (!gameData) {
                    pending('Extra Outfits plug-in not installed');
                    return;
                }
                const earth = await gameData.data.Planet.get(EARTH);
                expect(earth.specialTech).not.toContain(10000);
                const ships = await pool(gameData, EARTH,
                    { stellarId: 128 });
                expect(ships.has(AM_DRONE)).toBeFalse();
            });
    });
});
