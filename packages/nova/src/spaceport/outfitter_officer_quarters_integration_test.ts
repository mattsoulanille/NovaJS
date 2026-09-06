import 'jasmine';
import fs from 'fs';
import path from 'path';
import { OutfitData } from 'novadatainterface/outfit_data';
import { Entity } from 'nova_ecs/entity';
import {
    getPluginGameData, pluginControlBit,
} from '../communication/simulation_test_fixture.js';
import { ControlBitResolver } from '../nova_plugin/control_bit_namespaces.js';
import { makeShip } from '../nova_plugin/make_ship.js';
import { idPrefix } from '../nova_plugin/mission_logic.js';
import { ControlBitsComponent } from '../nova_plugin/ncb_plugin.js';
import { OutfitsStateComponent } from '../nova_plugin/outfit_plugin.js';
import {
    CreditsComponent, GameDateComponent,
} from '../nova_plugin/player_state_plugin.js';
import {
    decodeSave, encodeSave, extractSaveData, restorePlayerState,
} from '../nova_plugin/save_game.js';
import { ShipComponent } from '../nova_plugin/ship_plugin.js';
import { advanceEntityDate, MissionSession } from './mission_session.js';
import { MissionUniverse } from './mission_universe.js';
import { canBuyOutfit, OutfitterContext } from './outfitter_rules.js';

/**
 * Regression: "I purchased an Extra Outfits Officer Quarters and was
 * allowed to buy officers, but then I left the planet and went somewhere
 * else, and I'm no longer allowed to buy officers."
 *
 *   oütf 533 Officer Quarters   OnPurchase b9010  OnSell !b9010
 *   oütf 504-521 officers       Availability `b9010 & !O<other> & !O<other>`
 *   crön 604 Take Away Officers EnableOn `!O533`  OnStart `!b9010`
 *                               (Random 100, Duration 1, no holdoffs)
 *
 * The bit was set fine and saved fine; it was crön 604 that took it away.
 * Cron EnableOn was evaluated with control bits only, so `!O533` read as
 * always-true and the cron fired on the first day that passed after
 * leaving the planet, clearing b9010 (physical b20035 under Matthew's
 * plug-in set) even though the quarters were aboard. Crons now see the
 * owned outfits (cron_logic.ts).
 *
 * As in the crafting spec, the purchase is driven through the pieces the
 * PIXI-bound Outfitter delegates to: canBuyOutfit for the gate and
 * MissionSession.runMissionSet for the OnPurchase string.
 */
describe('Extra Outfits Officer Quarters against real plug-in data', () => {
    const PLUGIN = 'extra-outfits';
    /** Terrapin. */
    const SHIP = 'nova:136';
    const QUARTERS = `${PLUGIN}:533`;
    const OFFICER = `${PLUGIN}:504`;

    async function bench() {
        const gameData = await getPluginGameData(PLUGIN);
        if (!gameData) {
            return undefined;
        }
        const universe = MissionUniverse.shared(gameData);
        await universe.load();
        const shipData = await gameData.data.Ship.get(SHIP);
        const entity = makeShip(shipData);
        entity.components.set(CreditsComponent, { credits: 100000000 });
        entity.components.set(GameDateComponent,
            { day: 1, month: 1, year: 1177 });
        const session = await MissionSession.create(
            entity, gameData, universe, '<outfitter>');
        const outfits = new Map<string, OutfitData>();
        for (const id of [QUARTERS, OFFICER]) {
            outfits.set(id, await gameData.data.Outfit.get(id));
        }
        const B9010 = await pluginControlBit(gameData, PLUGIN, 9010);
        const resolver = new ControlBitResolver(await gameData.controlBitNamespaces);

        const contextFor = (e: Entity): OutfitterContext => ({
            shipData,
            outfits: new Map([...e.components.get(OutfitsStateComponent) ?? []]
                .map(([id, { count }]) => [id, count])),
            getOutfit: id => outfits.get(id),
            getWeapon: () => undefined,
            bits: new Set(e.components.get(ControlBitsComponent) ?? []),
            credits: 100000000,
        });
        const sessionContext = (): OutfitterContext => ({
            shipData,
            outfits: session.outfits,
            getOutfit: id => outfits.get(id),
            getWeapon: () => undefined,
            bits: session.state.bits,
            credits: session.state.credits.credits,
        });
        const buy = (outfit: OutfitData) => {
            session.state.credits.credits -= outfit.price;
            session.outfits.set(outfit.id,
                (session.outfits.get(outfit.id) ?? 0) + 1);
            session.runMissionSet(outfit.onPurchase, idPrefix(outfit.id));
        };
        return {
            gameData, universe, entity, session, outfits, B9010, resolver,
            contextFor, sessionContext, buy,
        };
    }

    it('unlocks the officers, keeps them unlocked across the days that '
        + 'pass on departure, and across a save/load', async () => {
            const b = await bench();
            if (!b) {
                pending('Extra Outfits plug-in not installed');
                return;
            }
            const officer = b.outfits.get(OFFICER)!;
            expect(canBuyOutfit(officer, b.sessionContext()).allowed).toBe(false);
            b.buy(b.outfits.get(QUARTERS)!);
            // The OnPurchase set string wrote the same physical bit the
            // officers' Availability reads.
            expect(b.session.state.bits.has(b.B9010)).toBe(true);
            expect(canBuyOutfit(officer, b.sessionContext()))
                .toEqual({ allowed: true });
            b.session.commit();
            expect(b.entity.components.get(ControlBitsComponent)!.has(b.B9010))
                .toBe(true);
            expect(canBuyOutfit(officer, b.contextFor(b.entity)))
                .toEqual({ allowed: true });

            // Leaving the planet: days pass, crons run (crön 604 included).
            await advanceEntityDate(b.entity, 3, b.universe, b.gameData);
            expect(b.entity.components.get(ControlBitsComponent)!.has(b.B9010))
                .withContext('b9010 after crön 604 had its chance').toBe(true);
            expect(canBuyOutfit(officer, b.contextFor(b.entity)))
                .toEqual({ allowed: true });

            // Save and load under the same plug-in set.
            const saved = extractSaveData(b.entity, 'nova:130',
                { resolver: b.resolver })!;
            expect(saved.controlBits).toContain([PLUGIN, 9010]);
            expect(saved.novaControlBits).toContain([String(b.B9010), 1]);
            const restored = new Entity('restored');
            restored.components.set(ShipComponent, { id: SHIP });
            restored.components.set(OutfitsStateComponent,
                new Map(saved.outfits.map(([id, count]) => [id, { count }])));
            restorePlayerState(restored, decodeSave(encodeSave(saved))!, b.resolver);
            expect(restored.components.get(ControlBitsComponent)!.has(b.B9010))
                .toBe(true);
            expect(canBuyOutfit(officer, b.contextFor(restored)))
                .toEqual({ allowed: true });
            // ...and more days on the far side don't take them away either.
            await advanceEntityDate(restored, 2, b.universe, b.gameData);
            expect(canBuyOutfit(officer, b.contextFor(restored)))
                .toEqual({ allowed: true });
        });

    it('does let crön 604 take the officers away once the quarters are gone',
        async () => {
            const b = await bench();
            if (!b) {
                pending('Extra Outfits plug-in not installed');
                return;
            }
            b.buy(b.outfits.get(QUARTERS)!);
            b.session.commit();
            // Lose the quarters without running OnSell (as a stripped hull
            // or a plug-in change might): the cron is what cleans up.
            b.entity.components.set(OutfitsStateComponent, new Map());
            await advanceEntityDate(b.entity, 1, b.universe, b.gameData);
            expect(b.entity.components.get(ControlBitsComponent)!.has(b.B9010))
                .toBe(false);
        });
});

/**
 * Matthew's actual pilot file from the report, as a fixture: its save
 * must load and round-trip idempotently under a namespaced build.
 */
describe('Pilot file Shane_Merrol_cant_hire_officers.plt', () => {
    const FIXTURE = path.join(process.cwd(), 'test_fixtures', 'pilots',
        'Shane_Merrol_cant_hire_officers.plt');
    const PLUGINS = ['arpia', 'extra-outfits', 'singularity', 'Planet Rico'];

    it('is save->load->save idempotent, and loses no bit from either field',
        async () => {
            const gameData = await getPluginGameData(PLUGINS);
            if (!gameData) {
                pending('Plug-ins not installed');
                return;
            }
            const pilot = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
            const save = decodeSave(JSON.stringify(pilot.save))!;
            expect(save).toBeDefined();
            expect(save.plugins!.length).toBe(26);
            // Written by a namespaced build: both fields, in agreement.
            expect(save.controlBits!.length).toBe(save.novaControlBits!.length);
            const resolver = new ControlBitResolver(await gameData.controlBitNamespaces);

            const first = new Entity('first');
            first.components.set(ShipComponent, { id: save.ship });
            const r1 = restorePlayerState(first, save, resolver);
            const bits1 = first.components.get(ControlBitsComponent)!;
            // Every stock pair is live; every loaded plug-in's pair is
            // live under this set's numbering; the rest is parked. Nothing
            // is dropped: pairs == live pairs + parked.
            const stockPairs = save.controlBits!.filter(([ns]) => ns === 'nova');
            for (const [, bit] of stockPairs) {
                expect(bits1.has(bit)).withContext(`stock b${bit}`).toBe(true);
            }
            const roundTripped = [...resolver.toPairs(bits1), ...r1.parkedControlBits]
                .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]);
            expect(roundTripped).toEqual(save.controlBits!);
            expect(r1.parkedControlBits.map(([ns]) => ns))
                .toEqual(['HypergatePassv1']);

            const saved1 = extractSaveData(first, save.system,
                { resolver, parked: r1.parkedControlBits })!;
            expect(saved1.controlBits).toEqual(save.controlBits!);

            const second = new Entity('second');
            second.components.set(ShipComponent, { id: save.ship });
            const r2 = restorePlayerState(second,
                decodeSave(encodeSave(saved1))!, resolver);
            expect(second.components.get(ControlBitsComponent)).toEqual(bits1);
            expect(r2.parkedControlBits).toEqual(r1.parkedControlBits);
            const saved2 = extractSaveData(second, save.system,
                { resolver, parked: r2.parkedControlBits })!;
            expect(saved2.controlBits).toEqual(saved1.controlBits);
            expect(saved2.novaControlBits).toEqual(saved1.novaControlBits);
            expect(saved2.plugins).toEqual(saved1.plugins);
        });
});
