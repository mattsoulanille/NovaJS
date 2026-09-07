import 'jasmine';
import { OutfitData } from 'novadatainterface/outfit_data';
import { Entity } from 'nova_ecs/entity';
import { getPluginGameData, pluginControlBit } from '../communication/simulation_test_fixture.js';
import { makeShip, OutfitsStateComponent } from '../nova_plugin/ship/index.js';
import { idPrefix } from '../nova_plugin/missions/index.js';
import { ControlBitsComponent } from '../nova_plugin/ncb/index.js';
import { CreditsComponent } from '../nova_plugin/player/index.js';
import { MissionSession } from './mission_session.js';
import { MissionUniverse } from './mission_universe.js';
import { canBuyOutfit, OutfitterContext } from './outfitter_rules.js';

/**
 * The Extra Outfits plug-in's "Self-Made Energon Cannon" crafting chain,
 * run end to end against the plug-in's real data. It is the sharpest test
 * of nova_plugin/ncb/ncb.ts's two plug-in-compatibility rules, because the
 * chain needs BOTH of them and produces nothing at all without either:
 *
 *   oütf 468 Control Computer         Avail !b9001   OnPurchase b9002
 *   oütf 469 Weapon Control Software  Avail !b9001   OnPurchase b9003
 *   oütf 470 IDA Frigate Energy Cell  Avail !b9001   OnPurchase b9004
 *   oütf 471 Empty Weapon Hull
 *       Avail      `b9002 & b9003 & b9004 & !9001`      <- bare number
 *       OnPurchase `!b9002 & !b9003 & !b9004 & b9001 G472 D468 D469 D470 D471 `
 *                                                       <- stray `&`s
 *   oütf 472 Self-Made Energon Cannon Avail b9001
 *
 * Buying the hull is the crafting step: it clears the three part bits,
 * sets the built bit, GRANTS the cannon, and DELETES all four parts
 * (the hull included — it is consumed by the thing it becomes).
 *
 * The Outfitter class is PIXI-bound, so, as elsewhere in this package,
 * the purchase is driven through the exact pieces the menu delegates to:
 * canBuyOutfit for the gate, and MissionSession.runMissionSet for the
 * OnPurchase string, scoped to the outfit's own plug-in prefix. That is
 * Outfitter.applyBuy / runSetString with the drawing left out.
 */
describe('Extra Outfits crafting chain against real plug-in data', () => {
    const PLUGIN = 'extra-outfits';
    /** Terrapin: 23t of outfit space, and Contribute exactly 0x1 — so the
     * chain's Require bits 16-19 can only come from the parts themselves. */
    const SHIP = 'nova:136';
    const [COMPUTER, SOFTWARE, CELL, HULL, CANNON] =
        [468, 469, 470, 471, 472].map(id => `${PLUGIN}:${id}`);

    /** Undefined when the plug-in isn't installed; every spec then skips. */
    async function craftingBench() {
        const gameData = await getPluginGameData(PLUGIN);
        if (!gameData) {
            return undefined;
        }
        const universe = MissionUniverse.shared(gameData);
        await universe.load();
        const shipData = await gameData.data.Ship.get(SHIP);
        const entity = makeShip(shipData);
        entity.components.set(CreditsComponent, { credits: 1000000 });
        const session = await MissionSession.create(
            entity, gameData, universe, '<outfitter>');
        const outfits = new Map<string, OutfitData>();
        for (const id of [COMPUTER, SOFTWARE, CELL, HULL, CANNON]) {
            outfits.set(id, await gameData.data.Outfit.get(id));
        }

        // Outfitter.makeContext, minus the parts that only the menu has.
        // No `planet`: with no stellar the rules stock everything, keeping
        // the spec about the crafting chain rather than about tech levels.
        const context = (): OutfitterContext => ({
            shipData,
            outfits: session.outfits,
            getOutfit: id => outfits.get(id),
            getWeapon: () => undefined,
            bits: session.state.bits,
            credits: session.state.credits.credits,
        });

        /** Outfitter.applyBuy: charge, count the unit, run OnPurchase. */
        const buy = (outfit: OutfitData) => {
            session.state.credits.credits -= outfit.price;
            session.outfits.set(outfit.id,
                (session.outfits.get(outfit.id) ?? 0) + 1);
            session.runMissionSet(outfit.onPurchase, idPrefix(outfit.id));
        };

        // The plug-in's own bit numbers, as NovaParse renumbered them
        // (plug-in-private control bits live in their own namespace; see
        // nova_plugin/ncb/control_bit_namespaces.ts).
        const bit = (raw: number) => pluginControlBit(gameData, PLUGIN, raw);
        const [B9001, B9002, B9003, B9004] = await Promise.all(
            [9001, 9002, 9003, 9004].map(bit));

        return {
            gameData, entity, session, outfits, context, buy,
            B9001, B9002, B9003, B9004,
        };
    }

    /** The three parts, bought in order; returns the bench. */
    async function withParts() {
        const bench = await craftingBench();
        if (!bench) {
            return undefined;
        }
        for (const id of [COMPUTER, SOFTWARE, CELL]) {
            const part = bench.outfits.get(id)!;
            expect(canBuyOutfit(part, bench.context()).allowed)
                .withContext(`buying ${part.name}`).toBe(true);
            bench.buy(part);
        }
        return bench;
    }

    it('gates the hull on the three part bits (the bare-number term)',
        async () => {
            const bench = await craftingBench();
            if (!bench) {
                pending('Extra Outfits plug-in not installed');
                return;
            }
            const hull = bench.outfits.get(HULL)!;
            // `!9001` is a control bit, so with no parts bought the
            // Availability is false and the hull cannot be built yet.
            // A strict parser instead throws, and availabilityTest's
            // fall-open policy would sell the hull to anyone.
            expect(canBuyOutfit(hull, bench.context())).toEqual({
                allowed: false, reason: 'availability', message: 'Not available.',
            });
        });

    it('sets one bit per part bought', async () => {
        const bench = await withParts();
        if (!bench) {
            pending('Extra Outfits plug-in not installed');
            return;
        }
        expect([...bench.session.state.bits].sort((a, b) => a - b))
            .toEqual([bench.B9002, bench.B9003, bench.B9004].sort((a, b) => a - b));
    });

    it('builds the cannon when the hull is bought', async () => {
        const bench = await withParts();
        if (!bench) {
            pending('Extra Outfits plug-in not installed');
            return;
        }
        const hull = bench.outfits.get(HULL)!;
        expect(canBuyOutfit(hull, bench.context()).allowed).toBe(true);
        bench.buy(hull);

        // G472 granted the cannon; D468-D471 consumed all four parts,
        // including the hull that was counted a moment ago.
        expect(bench.session.outfits.get(CANNON)).toBe(1);
        for (const id of [COMPUTER, SOFTWARE, CELL, HULL]) {
            expect(bench.session.outfits.get(id) ?? 0)
                .withContext(`${id} should be consumed`).toBe(0);
        }
        // ...and the bits flipped from "parts on hand" to "cannon built".
        expect([...bench.session.state.bits]).toEqual([bench.B9001]);
    });

    it('grants the cannon even though its Require bits died with the parts',
        async () => {
            const bench = await withParts();
            if (!bench) {
                pending('Extra Outfits plug-in not installed');
                return;
            }
            bench.buy(bench.outfits.get(HULL)!);
            const cannon = bench.outfits.get(CANNON)!;

            // Require 0xf0001 is bit 0 (the ship) plus bits 16-19, which
            // are exactly the four parts' Contribute flags. Consuming the
            // parts therefore makes the cannon unbuyable the instant it is
            // built — which is fine, and is the whole point of Gxxx: a
            // grant bypasses Require, Availability, Max, mass and money.
            const check = canBuyOutfit(cannon, bench.context());
            expect(check.allowed).toBe(false);
            expect(check.allowed || check.reason).toBe('require');
            expect(bench.session.outfits.get(CANNON)).toBe(1);
        });

    it('persists the built cannon and its bit across the depart commit',
        async () => {
            const bench = await withParts();
            if (!bench) {
                pending('Extra Outfits plug-in not installed');
                return;
            }
            bench.buy(bench.outfits.get(HULL)!);
            bench.session.commit();

            const entity: Entity = bench.entity;
            const owned = entity.components.get(OutfitsStateComponent)!;
            expect(owned.get(CANNON)).toEqual({ count: 1 });
            for (const id of [COMPUTER, SOFTWARE, CELL, HULL]) {
                expect(owned.has(id)).withContext(id).toBe(false);
            }
            expect(entity.components.get(ControlBitsComponent)!.has(bench.B9001))
                .toBe(true);
        });

    it('charges for the parts and the hull but never for the cannon',
        async () => {
            const bench = await craftingBench();
            if (!bench) {
                pending('Extra Outfits plug-in not installed');
                return;
            }
            const before = bench.session.state.credits.credits;
            const parts = [COMPUTER, SOFTWARE, CELL, HULL]
                .map(id => bench.outfits.get(id)!);
            for (const part of parts) {
                bench.buy(part);
            }
            const spent = parts.reduce((total, part) => total + part.price, 0);
            expect(bench.session.state.credits.credits).toBe(before - spent);
            // The cannon costs 200000 and is never charged: it is granted.
            expect(bench.outfits.get(CANNON)!.price).toBeGreaterThan(0);
        });
});
