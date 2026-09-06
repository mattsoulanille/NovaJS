import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { PlanetData } from 'novadatainterface/planet_data';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import { novaDataInstalled, requireNovaData } from '../test_support/nova_data_gate.js';
import { makeShip } from '../nova_plugin/make_ship.js';
import {
    ActiveRanksComponent, ControlBitsComponent,
} from '../nova_plugin/ncb_plugin.js';
import {
    CreditsComponent, GameDateComponent, MissionsComponent,
} from '../nova_plugin/player_state_plugin.js';
import { hirePrice } from './hire_escort.js';
import { MissionUniverse } from './mission_universe.js';
import { outfitPrice, outfitResaleValue, stellarOf } from './outfitter_rules.js';
import { shipGateContext } from './ship_gate_context.js';
import { shipListPrice, ShipPurchaseContext } from './shipyard_rules.js';

/**
 * ============================================================================
 * ränk PriceMod against the real stock data
 * ============================================================================
 *
 * The stock rank that exercises it hardest is ränk nova:138 "Knight of Red
 * Branch; Wild Geese 1": AffilGovt nova:144 (the Wild Geese), Weight 20,
 * Salary 750, PriceMod 50 — the richest rank the shipped game contains, and
 * one of the steepest stock discounts. Twelve stock ränks carry a real
 * PriceMod in all (pinned below); the rest sit at 100 or at 0 ("unused", see
 * rank_logic.ts).
 *
 * The Bible scopes it to "planets OWNED BY the affiliated government", so the
 * spec's whole point is the two-stellar comparison: the Wild Geese's own New
 * Ireland (spöb nova:139, gövt nova:144, shipyard + outfitter) halves, and a
 * Federation world does not, for the same player on the same day.
 *
 * And it halves the SHIPYARD only. Per Matthew's ruling — "while ships should
 * be free, building materials and outfits should NOT be" — the outfitter
 * charges the oütf Cost as written no matter which ranks are active. No stock
 * text contradicts that: the in-game lines granting these ranks say only "a
 * slight discount at all Rebel ports" (dësc nova:4210), "a bigger discount at
 * Federation ports" (nova:5066) and "a discount when purchasing our goods"
 * (nova:9011), none of them naming ships or items, and the Knight's own
 * knighting scene (nova:9817) never mentions money. price_mod.ts writes up the
 * plug-in data that does distinguish the two readings.
 */
describe('ränk PriceMod at real stock stellars', () => {
    /** ränk nova:138, PriceMod 50, AffilGovt nova:144 (Wild Geese). */
    const KNIGHT = 'nova:138';
    /** spöb nova:139 "New Ireland" — gövt nova:144, the Geese's own world. */
    const NEW_IRELAND = 'nova:139';
    /** shïp nova:133 "Starbridge", to price in the shipyard. */
    const STARBRIDGE = 'nova:133';
    /** oütf nova:132 "Shield Capacitor", to price in the outfitter. */
    const OUTFIT = 'nova:132';

    let newIreland: PlanetData;
    /** A Federation-owned world with an outfitter, for the contrast. */
    let federationWorld: PlanetData;
    let universe: MissionUniverse;

    beforeEach(requireNovaData);
    beforeAll(async () => {
        if (!novaDataInstalled()) return; // each spec pends instead
        const gameData = await getIntegrationGameData();
        universe = MissionUniverse.shared(gameData);
        await universe.load();
        newIreland = await gameData.data.Planet.get(NEW_IRELAND);
        const ids = await gameData.ids;
        for (const id of ids.Planet) {
            const planet = await gameData.data.Planet.get(id);
            if (planet.govt === 'nova:128' && planet.flags.hasOutfitter
                && planet.flags.hasShipyard) {
                federationWorld = planet;
                break;
            }
        }
    }, 240_000);

    async function player(ranks: string[]): Promise<Entity> {
        const gameData = await getIntegrationGameData();
        const start = await gameData.data.PlayerStart.get('nova:128');
        const entity = makeShip(await gameData.data.Ship.get(start.ship));
        entity.components.set(GameDateComponent, { ...start.date });
        entity.components.set(CreditsComponent, { credits: 100_000_000 });
        entity.components.set(ControlBitsComponent, new Set());
        entity.components.set(ActiveRanksComponent, new Set(ranks));
        entity.components.set(MissionsComponent, new Map());
        return entity;
    }

    /** The PriceMod the shipyard/bar context resolves at `planet`. */
    async function priceModAt(planet: PlanetData, ranks: string[]) {
        const entity = await player(ranks);
        return shipGateContext(entity, {
            planet: {
                techLevel: planet.techLevel,
                specialTech: planet.specialTech,
                govt: planet.govt,
            },
            stellarId: planet.id,
            getOutfit: () => undefined,
            getRank: id => universe.getRank(id),
        }).priceMod;
    }

    it('pins the stock knighthood that drives this', () => {
        const knight = universe.getRank(KNIGHT)!;
        expect(knight.name).toBe('Knight of Red Branch; Wild Geese 1');
        expect(knight.priceMod).toBe(50);
        expect(knight.affilGovt).toBe('nova:144');
        expect(newIreland.name).toBe('New Ireland');
        expect(newIreland.govt).toBe('nova:144');
        expect(newIreland.flags.hasShipyard).toBeTrue();
        expect(newIreland.flags.hasOutfitter).toBeTrue();
        expect(federationWorld).toBeDefined();
        expect(federationWorld.govt).toBe('nova:128');
    });

    it('pins every stock ränk that carries a real PriceMod', async () => {
        const gameData = await getIntegrationGameData();
        const real: [string, number][] = [];
        for (const id of (await gameData.ids).Rank) {
            const rank = universe.getRank(id)!;
            if (rank.priceMod !== 0 && rank.priceMod !== 100) {
                real.push([id, rank.priceMod]);
            }
        }
        // Twelve of them, spread across five governments -- so PriceMod is
        // not an obscure corner of the data, and applying it to outfitters
        // as well would reprice a large part of the shipped galaxy.
        expect(real).toEqual([
            ['nova:128', 85],   // Fed 1, Commander
            ['nova:129', 60],   // Fed 2, Ambassador
            ['nova:130', 80],   // Polaris 1
            ['nova:137', 80],   // Rebel 1, Ory-Hara
            ['nova:138', 50],   // Wild Geese 1, Knight of Red Branch
            ['nova:139', 95],   // Auroran 1
            ['nova:140', 80],   // Auroran 2
            ['nova:141', 50],   // Auroran 3
            ['nova:142', 50],   // Auroran 4
            ['nova:143', 50],   // Pirate 1
            ['nova:144', 75],   // Pirate 1b
            ['nova:149', 10],   // Director of the Bureau
        ]);
    });

    it('halves prices at the affiliated govt\'s stellar only', async () => {
        expect(await priceModAt(newIreland, [KNIGHT])).toBe(50);
        expect(await priceModAt(newIreland, [])).toBe(100);
        // Same rank, someone else's world: no discount.
        expect(await priceModAt(federationWorld, [KNIGHT])).toBe(100);
    });

    it('halves the Starbridge in New Ireland\'s shipyard and its hire fee '
        + 'in the bar', async () => {
            const gameData = await getIntegrationGameData();
            const starbridge = await gameData.data.Ship.get(STARBRIDGE);
            expect(starbridge.name).toBe('Starbridge');
            const context = (priceMod?: number): ShipPurchaseContext => ({
                currentShip: starbridge,
                outfits: new Map(),
                getOutfit: () => undefined,
                credits: 100_000_000,
                priceMod,
            });

            const knighted = await priceModAt(newIreland, [KNIGHT]);
            const plain = await priceModAt(newIreland, []);
            expect(shipListPrice(starbridge, context(plain)))
                .toBe(starbridge.price);
            expect(shipListPrice(starbridge, context(knighted)))
                .toBe(Math.floor(starbridge.price / 2));
            // The bar's fee is 10% of the SAME modified price.
            expect(hirePrice(starbridge, plain))
                .toBe(Math.round(starbridge.price / 10));
            expect(hirePrice(starbridge, knighted))
                .toBe(Math.round(Math.floor(starbridge.price / 2) / 10));
            // ... and not at a Federation shipyard.
            const fed = await priceModAt(federationWorld, [KNIGHT]);
            expect(shipListPrice(starbridge, context(fed)))
                .toBe(starbridge.price);
        });

    it('leaves New Ireland\'s OUTFITTER at full price for the same knight',
        async () => {
            const gameData = await getIntegrationGameData();
            const outfit = await gameData.data.Outfit.get(OUTFIT);
            expect(outfit.price).toBeGreaterThan(0);

            // The rank is in force here — the shipyard next door halves.
            expect(await priceModAt(newIreland, [KNIGHT])).toBe(50);
            // ... and the outfitter charges the oütf Cost regardless. Per
            // Matthew's ruling PriceMod is a SHIP discount; price_mod.ts has
            // the Spica Shipyard data behind it.
            expect(outfitPrice(outfit)).toBe(outfit.price);
            expect(outfitResaleValue(outfit))
                .toBe(Math.floor(outfit.price / 2));
            expect(outfitResaleValue(outfit))
                .toBeLessThanOrEqual(outfitPrice(outfit));

            // The outfitter's view of a stellar carries the owning govt for
            // ONE purpose — the oütf RequireGovt scoping (which stellars a
            // Require is enforced at, outfitter_rules' requireApplies) —
            // and no price rule reads it: there is nothing in the shop for
            // a rank to match against.
            expect(newIreland.govt).toBe('nova:144');
            expect(stellarOf(newIreland))
                .toEqual({
                    techLevel: newIreland.techLevel,
                    specialTech: newIreland.specialTech,
                    buysAnyOutfit: newIreland.flags.buysAnyOutfit,
                    govt: 'nova:144',
                });
        });
});
