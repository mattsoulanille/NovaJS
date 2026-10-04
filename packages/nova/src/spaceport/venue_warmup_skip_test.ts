import 'jasmine';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { Entity } from 'nova_ecs/entity';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import {
    SimulationGameDataInterface, SimulationGameDataResources,
} from '../client/gamedata/simulation_game_data.js';
import { getSyntheticGameData } from '../communication/simulation_test_fixture.js';
import { ControlEvent } from '../nova_plugin/core/index.js';
import { makeShip, OutfitsStateComponent } from '../nova_plugin/ship/index.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { HireEscortDialog } from './hire_escort.js';
import { LandedTransaction } from './landed_transaction.js';
import { computeCargoCapacity, computePlayerContribute } from './mission_session.js';
import { MissionUniverse } from './mission_universe.js';
import { Outfitter } from './outfitter.js';
import { Shipyard } from './shipyard.js';
import { Starmap } from './starmap.js';
import { TradeCenter } from './trade_center.js';

/**
 * Issue #130: every spaceport venue warms up by loading a whole resource
 * family (every oütf, every shïp, every mïsn...) with one Promise.all.
 * Since #47 the aggregator rejects an id it cannot produce instead of
 * handing back a placeholder, so ONE plug-in resource whose parse fails
 * rejected the whole warm-up and blanked the shop — or, for the mission
 * universe, shut the mission computer, the bar and the landing itself.
 *
 * Each spec runs a venue over the synthetic data set with exactly one id
 * made to reject, and checks that the venue still builds with every other
 * id and that the console warning names both the venue and the id.
 */
describe('spaceport venue warm-ups with one failing id (#130)', () => {
    beforeAll(() => installHeadlessPixi());

    let warn: jasmine.Spy;
    beforeEach(() => {
        warn = spyOn(console, 'warn');
    });

    function displayAssets(): DisplayAssetDataInterface {
        return {
            spriteFromPict: () => new PIXI.Sprite(),
            spriteFromPictAsync: async () => new PIXI.Sprite(),
            textureFromPict: () => PIXI.Texture.EMPTY,
            textureFromPictAsync: async () => PIXI.Texture.EMPTY,
            textureFromCicn: async () => PIXI.Texture.EMPTY,
            textureFromPpat: async () => PIXI.Texture.EMPTY,
            data: {},
        } as unknown as DisplayAssetDataInterface;
    }

    type Kind = keyof SimulationGameDataResources;

    /**
     * The synthetic set with `badId` of `kind` failing its load, the way
     * a plug-in resource that fails its second-stage parse does: `get`
     * rejects and `getCached` never has it. Everything else is the real
     * parse. `failing.on = false` lets the id load again (a transient
     * failure that clears).
     */
    async function withFailing(kind: Kind, badId: string) {
        const real = await getSyntheticGameData();
        const failing = { on: true };
        const gettable = new Proxy(real.data[kind], {
            get(target, prop) {
                if (prop === 'get') {
                    return (id: string, ...rest: unknown[]) =>
                        failing.on && id === badId
                            ? Promise.reject(new Error(
                                `second-stage parse failed for ${id}`))
                            : (target.get as (...args: unknown[]) => unknown)
                                .call(target, id, ...rest);
                }
                if (prop === 'getCached') {
                    return (id: string) => failing.on && id === badId
                        ? undefined : target.getCached(id);
                }
                const value = Reflect.get(target, prop, target);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        });
        const data = new Proxy(real.data, {
            get: (target, prop) => prop === kind
                ? gettable : Reflect.get(target, prop, target),
        }) as unknown as SimulationGameDataResources;
        const gameData: SimulationGameDataInterface = {
            data,
            ids: real.ids,
            preloadData: real.preloadData,
            controlBitNamespaces: real.controlBitNamespaces,
            getSettings: real.getSettings?.bind(real),
        };
        return { gameData, failing };
    }

    /** Whether a console.warn line names both the venue and the id. */
    function warnedAbout(venue: string, id: string): boolean {
        return warn.calls.allArgs().some(args => {
            const line = String(args[0]);
            return line.includes(venue) && line.includes(id);
        });
    }

    /** The ids of the items an ItemGrid holds (its private `items`). */
    function gridIds(grid: unknown): string[] {
        const items = (grid as { items?: { id: string }[] } | undefined)?.items;
        return (items ?? []).map(item => item.id).sort();
    }

    async function allIds(kind: 'Outfit' | 'Ship' | 'Junk' | 'System') {
        return [...(await (await getSyntheticGameData()).ids)[kind]].sort();
    }

    it('builds the outfitter grid without an outfit that fails to load',
        async () => {
            const bad = SYNTHETIC.outfits.cargoPod;
            const { gameData } = await withFailing('Outfit', bad);
            const outfitter = new Outfitter(displayAssets(), gameData,
                new Subject<ControlEvent>());
            await outfitter.buildPromise;

            expect(gridIds(outfitter['itemGrid']))
                .toEqual((await allIds('Outfit')).filter(id => id !== bad));
            expect(warnedAbout('Outfitter', bad)).toBe(true);
        });

    it('builds the outfitter grid when a weapon an outfit names fails',
        async () => {
            const bad = SYNTHETIC.weapons.missile;
            const { gameData } = await withFailing('Weapon', bad);
            const outfitter = new Outfitter(displayAssets(), gameData,
                new Subject<ControlEvent>());
            await outfitter.buildPromise;

            expect(gridIds(outfitter['itemGrid'])).toEqual(await allIds('Outfit'));
            expect(warnedAbout('Outfitter', bad)).toBe(true);
        });

    it('builds the shipyard grid without a ship that fails to load',
        async () => {
            const bad = SYNTHETIC.ships.corsair;
            const { gameData } = await withFailing('Ship', bad);
            const shipyard = new Shipyard(displayAssets(), gameData,
                new Subject<ControlEvent>());
            await shipyard.buildPromise;

            expect(shipyard['allShips'].map(ship => ship.id).sort())
                .toEqual((await allIds('Ship')).filter(id => id !== bad));
            expect(shipyard.itemGrid).toBeDefined();
            expect(warnedAbout('Shipyard', bad)).toBe(true);
        });

    it('prices trade-ins off every outfit but the one that fails',
        async () => {
            const bad = SYNTHETIC.outfits.cargoPod;
            const { gameData } = await withFailing('Outfit', bad);
            const shipyard = new Shipyard(displayAssets(), gameData,
                new Subject<ControlEvent>());
            await shipyard.buildPromise;
            await shipyard['loadOutfits']();

            expect([...shipyard['allOutfits'].keys()].sort())
                .toEqual((await allIds('Outfit')).filter(id => id !== bad));
            expect(warnedAbout('Shipyard', bad)).toBe(true);
        });

    it('fills the bar\'s hire pool without a ship that fails to load',
        async () => {
            const bad = SYNTHETIC.ships.warden;
            const { gameData } = await withFailing('Ship', bad);
            const hire = new HireEscortDialog(displayAssets(), gameData,
                new Subject<ControlEvent>(), SYNTHETIC.planets.port);
            await hire['load']();

            expect(hire['ships'].map(ship => ship.id).sort())
                .toEqual((await allIds('Ship')).filter(id => id !== bad));
            expect(warnedAbout('Bar', bad)).toBe(true);
        });

    it('stocks the trade center without a commodity that fails to load',
        async () => {
            const bad = SYNTHETIC.junk.resin;
            const { gameData } = await withFailing('Junk', bad);
            const exchange = new TradeCenter(displayAssets(), gameData,
                new Subject<ControlEvent>(), SYNTHETIC.planets.port);
            await exchange['load']();

            expect(exchange['junks'].map(junk => junk.id).sort())
                .toEqual((await allIds('Junk')).filter(id => id !== bad));
            expect(warnedAbout('Trade center', bad)).toBe(true);
        });

    it('draws the starmap without a system that fails to load', async () => {
        const bad = SYNTHETIC.systems.vael;
        const { gameData } = await withFailing('System', bad);
        const starmap = new Starmap(displayAssets(), gameData,
            SYNTHETIC.systems.thessaly, new Subject<ControlEvent>());
        await starmap.buildPromise;

        expect(starmap['allSystems']!.map(system => system.id).sort())
            .toEqual((await allIds('System')).filter(id => id !== bad));
        expect(warnedAbout('Starmap', bad)).toBe(true);
    });

    describe('the mission universe', () => {
        it('loads every other mission when one fails', async () => {
            const bad = SYNTHETIC.missions.gateSurvey;
            const { gameData } = await withFailing('Mission', bad);
            const universe = new MissionUniverse(gameData);
            await universe.load();

            expect(universe.getMission(bad)).toBeUndefined();
            expect(universe.getMission(SYNTHETIC.missions.courier))
                .toBeDefined();
            expect(universe.missions.length).toBe(
                (await (await getSyntheticGameData()).ids).Mission.length - 1);
            expect(warnedAbout('Mission universe', bad)).toBe(true);
        });

        it('still places the stellars when one planet fails', async () => {
            const bad = SYNTHETIC.planets.giant;
            const { gameData } = await withFailing('Planet', bad);
            const universe = new MissionUniverse(gameData);
            await universe.load();

            const candidates = universe.stellarCandidates.map(s => s.id);
            expect(candidates).toContain(SYNTHETIC.planets.port);
            expect(candidates).not.toContain(bad);
            expect(warnedAbout('Mission universe', bad)).toBe(true);
        });

        it('picks a skipped id up on a later load once it loads again',
            async () => {
                const bad = SYNTHETIC.missions.gateSurvey;
                const { gameData, failing } =
                    await withFailing('Mission', bad);
                const universe = new MissionUniverse(gameData);
                universe.retryBackoffMs = 0;
                await universe.load();
                expect(universe.getMission(bad)).toBeUndefined();

                // A transient failure (#66's retry): the partial load is
                // kept only for its backoff, then re-run.
                failing.on = false;
                await new Promise(resolve => setTimeout(resolve, 5));
                await universe.load();
                expect(universe.getMission(bad)).toBeDefined();
            });
    });

    describe('the landed transaction', () => {
        /** A Wren Skiff owning `owned`, in that (Map iteration) order. */
        async function docked(owned: [string, number][]) {
            const real = await getSyntheticGameData();
            const ship = makeShip(
                await real.data.Ship.get(SYNTHETIC.ships.skiff));
            ship.components.set(OutfitsStateComponent, new Map(
                owned.map(([id, count]) => [id, { count }])));
            return ship;
        }

        it('opens when a mission fails to load', async () => {
            const bad = SYNTHETIC.missions.bounty;
            const { gameData } = await withFailing('Mission', bad);
            const entity: Entity = await docked([]);
            const transaction = await LandedTransaction.open(entity, gameData,
                new MissionUniverse(gameData), SYNTHETIC.planets.port);

            expect(transaction.ship).toBe(entity);
            expect(warnedAbout('Mission universe', bad)).toBe(true);
        });

        // The failing outfit comes FIRST in each hold below, so a loop
        // that stops at it would miss everything after it.

        it('counts every other outfit\'s cargo space', async () => {
            const bad = SYNTHETIC.outfits.fuelTank;
            const real = await getSyntheticGameData();
            const hull = await real.data.Ship.get(SYNTHETIC.ships.skiff);
            const pod = await real.data.Outfit.get(SYNTHETIC.outfits.cargoPod);
            const podCargo = pod.physics.freeCargo ?? 0;
            expect(podCargo).toBeGreaterThan(0);
            const entity = await docked(
                [[bad, 1], [SYNTHETIC.outfits.cargoPod, 2]]);
            const { gameData } = await withFailing('Outfit', bad);

            expect(await computeCargoCapacity(entity, gameData))
                .toBe(hull.physics.freeCargo + 2 * podCargo);
            expect(warnedAbout('Cargo capacity', bad)).toBe(true);
        });

        it('counts every other outfit\'s Contribute', async () => {
            const bad = SYNTHETIC.outfits.cargoPod;
            const seal = SYNTHETIC.outfits.warrantSeal;
            const real = await getSyntheticGameData();
            const entity = await docked([[bad, 1], [seal, 1]]);
            const everything = await computePlayerContribute(entity, real);
            const sealBits = BigInt(
                (await real.data.Outfit.get(seal)).contribute);
            expect(sealBits).not.toBe(0n);
            expect(everything & sealBits).toBe(sealBits);
            const { gameData } = await withFailing('Outfit', bad);

            expect(await computePlayerContribute(entity, gameData))
                .toBe(everything);
            expect(warnedAbout('Player contribute', bad)).toBe(true);
        });
    });
});
