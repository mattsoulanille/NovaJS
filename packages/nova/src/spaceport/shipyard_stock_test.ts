import 'jasmine';
import { OutfitData } from 'novadatainterface/outfit_data';
import { ShipData } from 'novadatainterface/ship_data';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import {
    getIntegrationGameData, getSyntheticGameData,
} from '../communication/simulation_test_fixture.js';
import {
    CargoComponent, makeShip, OutfitsStateComponent, ShipComponent,
} from '../nova_plugin/ship/index.js';
import { CreditsComponent } from '../nova_plugin/player/index.js';
import {
    buildPurchasedShip,
    canBuyShip,
    ShipPurchaseContext,
    shipPurchasePrice,
    tradeInValue,
} from './shipyard_rules.js';

/**
 * The shipyard's persistence and pricing rules against the REAL Nova
 * game data, so the Bible's oütf 0x0004 flag is pinned to what the
 * shipped game actually contains.
 *
 * Stock facts these lean on (oütf resource ids; the global id's numeric
 * part is the classic resource id):
 *  - The Vell-os plot items are all persistent and all price 0 / mass 0:
 *    the six ";Tn Strength" tiers (205, 206, 207, 209, 336, 337), the
 *    four beams (221 Flower Of Spring and 224 Winter Tempest are FIXED
 *    GUNS; 222 Summer Bloom and 223 Autumn Petal are TURRETS), and the
 *    abilities 225 Create Dart, 249 Distract Sensors, 251 Vell-os Area
 *    Map, 252 Physical Sense, 253 Hostility Sense, 338 Telekinetic
 *    Boost. Sixteen items in total, every one of them cantSell.
 *  - The rest of the stock persistent set is not Vell-os at all: the
 *    nine licenses/permits (257-260, 263-265, 364, 439), the Fed
 *    Cloaking Device (211, the only persistent outfit with real mass and
 *    a real price), and Drop Bear Repellent (319).
 *  - oütf 342 "Area Map - Vell-os" is NOT persistent, despite the name:
 *    it is the separate availability-gated duplicate of the map.
 *
 * STAYS ON THE STOCK DATA: every claim here is a claim about the shipped
 * game's own outfit table. The RULES those facts justify are driven on
 * the synthetic data set, in the describe below.
 */
describe('shipyard rules against real Nova data', () => {
    async function allOutfits(): Promise<OutfitData[]> {
        const gameData = await getIntegrationGameData();
        const ids = (await gameData.ids).Outfit;
        return await Promise.all(ids.map(id => gameData.data.Outfit.get(id)));
    }

    /** The Vell-os plot items, by oütf id. */
    const VELL_OS = [
        'nova:205', 'nova:206', 'nova:207', 'nova:209', // ;T5..;T2 Strength
        'nova:221', 'nova:222', 'nova:223', 'nova:224', // the four beams
        'nova:225', // Create Dart
        'nova:249', // Distract Sensors
        'nova:251', // Vell-os Area Map
        'nova:252', // Physical Sense
        'nova:253', // Hostility Sense
        'nova:336', 'nova:337', // ;T1, ;T0 Strength
        'nova:338', // Telekinetic Boost
    ];

    it('pins every persistent outfit in the stock data', async () => {
        const outfits = await allOutfits();
        const persistent = outfits.filter(o => o.persistent).map(o => o.id)
            .sort((a, b) => Number(a.split(':')[1]) - Number(b.split(':')[1]));
        expect(persistent).toEqual([
            ...VELL_OS.slice(0, 4),          // 205, 206, 207, 209
            'nova:211',                      // Fed Cloaking Device
            ...VELL_OS.slice(4, 13),         // 221-225, 249, 251-253
            'nova:257', 'nova:258', 'nova:259', 'nova:260',
            'nova:263', 'nova:264', 'nova:265',
            'nova:319',                      // Drop Bear Repellent
            ...VELL_OS.slice(13),            // 336, 337, 338
            'nova:364', 'nova:439',
        ].sort((a, b) => Number(a.split(':')[1]) - Number(b.split(':')[1])));
        expect(persistent.length).toBe(27);
    });

    it('carries the persistence flag on all sixteen Vell-os items', async () => {
        const byId = new Map((await allOutfits()).map(o => [o.id, o]));
        for (const id of VELL_OS) {
            expect(byId.get(id)?.persistent)
                .withContext(`${id} ${byId.get(id)?.name}`).toBe(true);
        }
        expect(VELL_OS.length).toBe(16);
    });

    it('has every Vell-os item massless, free and unsellable', async () => {
        // This is what makes "transfer unconditionally" safe: none of
        // them can overflow the new hull's free mass, none of them can
        // be rebought, and none is worth credits at the trade-in.
        const byId = new Map((await allOutfits()).map(o => [o.id, o]));
        for (const id of VELL_OS) {
            const outfit = byId.get(id)!;
            expect(outfit.physics.freeMass).withContext(id).toBe(0);
            expect(outfit.price).withContext(id).toBe(0);
            expect(outfit.cantSell).withContext(id).toBe(true);
        }
    });

    it('has four Vell-os beams occupying real hardpoints', async () => {
        // The concrete reason judgment call 6 matters: these DO consume
        // gun/turret slots the new hull may not have.
        const byId = new Map((await allOutfits()).map(o => [o.id, o]));
        expect(byId.get('nova:221')!.fixedGun).toBe(true);
        expect(byId.get('nova:224')!.fixedGun).toBe(true);
        expect(byId.get('nova:222')!.turret).toBe(true);
        expect(byId.get('nova:223')!.turret).toBe(true);
    });

    it('leaves ordinary outfits non-persistent', async () => {
        const byId = new Map((await allOutfits()).map(o => [o.id, o]));
        // A mundane bought weapon, and the availability-gated duplicate
        // map whose NAME says Vell-os but whose flag does not.
        expect(byId.get('nova:215')!.name).toBe('Storm Chaingun');
        expect(byId.get('nova:215')!.persistent).toBe(false);
        expect(byId.get('nova:342')!.name).toBe('Area Map - Vell-os');
        expect(byId.get('nova:342')!.persistent).toBe(false);
    });

});

/**
 * The same persistence and pricing rules, driven end to end on the
 * synthetic data set. Its stand-ins for the stock shapes above:
 *
 *  - Courier Charter: persistent, cantSell, massless and free — the
 *    Vell-os plot item's shape, the thing that must ride to the new hull.
 *  - Shield Capacitor: an ordinary bought outfit, not persistent, and not
 *    part of the target hull's own loadout — the mundane gear that is lost.
 *  - Bonded Charter: persistent WITH a price (5,000 cr), the Fed Cloaking
 *    Device's shape — if persistence leaked into the valuation it shows
 *    here.
 */
describe('buying a ship on the synthetic data set', () => {
    /** Persistent, cantSell, mass 0, price 0. */
    const CHARTER = SYNTHETIC.outfits.charter;
    /** Persistent, 5,000 cr. */
    const BONDED_CHARTER = SYNTHETIC.outfits.bondedCharter;
    /** A plain bought outfit, absent from every hull's default loadout. */
    const SHIELD_CAPACITOR = SYNTHETIC.outfits.shieldCapacitor;

    async function allOutfits(): Promise<OutfitData[]> {
        const gameData = await getSyntheticGameData();
        const ids = (await gameData.ids).Outfit;
        return await Promise.all(ids.map(id => gameData.data.Outfit.get(id)));
    }

    async function pilot(credits: number, outfits: [string, number][]) {
        const gameData = await getSyntheticGameData();
        const byId = new Map((await allOutfits()).map(o => [o.id, o]));
        const start = await gameData.data.PlayerStart.get(SYNTHETIC.playerStart);
        const currentShip = await gameData.data.Ship.get(start.ship);
        const entity = makeShip(currentShip);
        entity.components.set(CreditsComponent, { credits });
        entity.components.set(MultiplayerData, { owner: 'peer-1' });
        entity.components.set(OutfitsStateComponent, new Map(
            outfits.map(([id, count]) => [id, { count }])));
        entity.components.set(CargoComponent, new Map());
        const context: ShipPurchaseContext = {
            currentShip,
            outfits: new Map(outfits),
            getOutfit: id => byId.get(id),
            credits,
        };
        return { gameData, entity, context, currentShip };
    }

    /** A ship the starting pilot could plausibly trade up to. */
    async function targetShip(): Promise<ShipData> {
        const gameData = await getSyntheticGameData();
        const ids = (await gameData.ids).Ship;
        const ships = await Promise.all(
            ids.map(id => gameData.data.Ship.get(id)));
        const target = ships.find(s => s.price > 0);
        if (!target) {
            throw new Error('No priced ship in the data set');
        }
        return target;
    }

    it('charges price minus 25% of the hull, leaving the rest', async () => {
        const { context, currentShip } = await pilot(10000000, []);
        const target = await targetShip();
        const expected = Math.max(0,
            target.price - Math.floor(currentShip.price * 0.25));
        expect(tradeInValue(context))
            .toBe(Math.floor(currentShip.price * 0.25));
        expect(shipPurchasePrice(target, context)).toBe(expected);
    });

    it('does not zero the player credits on a purchase', async () => {
        // The regression this whole change exists for: buying a ship
        // used to drop the CreditsComponent entirely, so the player
        // read as 0 credits afterwards.
        const { entity, context } = await pilot(10000000, []);
        const target = await targetShip();
        const bought = buildPurchasedShip(entity, target, context);
        const after = bought.components.get(CreditsComponent)!.credits;
        expect(after).toBe(10000000 - shipPurchasePrice(target, context));
        expect(after).toBeGreaterThan(0);
    });

    it('refuses a ship the player cannot afford', async () => {
        const { context } = await pilot(0, []);
        const gameData = await getSyntheticGameData();
        const ids = (await gameData.ids).Ship;
        const ships = await Promise.all(
            ids.map(id => gameData.data.Ship.get(id)));
        // The Bastion Hulk, at 1,500,000 credits.
        const expensive = ships.reduce((a, b) => a.price > b.price ? a : b);
        const check = canBuyShip(expensive, context);
        expect(check.allowed).toBe(false);
        expect(check.allowed ? '' : check.reason).toBe('credits');
    });

    it('carries the persistent set onto the new hull, losing mundane gear',
        async () => {
            // The Courier Charter (persistent) and a Shield Capacitor (not).
            const { entity, context } = await pilot(10000000,
                [[CHARTER, 1], [SHIELD_CAPACITOR, 1]]);
            const target = await targetShip();
            const bought = buildPurchasedShip(entity, target, context);
            const outfits = bought.components.get(OutfitsStateComponent)!;
            expect(outfits.get(CHARTER)).toEqual({ count: 1 });
            expect(outfits.has(SHIELD_CAPACITOR)).toBe(false);
            expect(bought.components.get(ShipComponent))
                .toEqual({ id: target.id });
        });

    it('does not pay the player for a persistent outfit it keeps',
        async () => {
            const target = await targetShip();
            const bare = await pilot(10000000, []);
            // The Bonded Charter is the persistent outfit with a real
            // price (5,000) -- if persistence leaked into the valuation
            // it would be obvious here.
            const bonded = await pilot(10000000, [[BONDED_CHARTER, 1]]);
            expect(shipPurchasePrice(target, bonded.context))
                .toBe(shipPurchasePrice(target, bare.context));
            const bought = buildPurchasedShip(
                bonded.entity, target, bonded.context);
            expect(bought.components.get(OutfitsStateComponent)!
                .get(BONDED_CHARTER)).toEqual({ count: 1 });
        });

    it('gives the new hull its own stock loadout', async () => {
        const { entity, context } = await pilot(10000000, []);
        const target = await targetShip();
        const bought = buildPurchasedShip(entity, target, context);
        const outfits = bought.components.get(OutfitsStateComponent)!;
        for (const [id, count] of Object.entries(target.outfits)) {
            expect(outfits.get(id)).withContext(id).toEqual({ count });
        }
    });
});
