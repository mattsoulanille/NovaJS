import 'jasmine';
import fs from 'fs';
import path from 'path';
import {
    FIRST_PRIVATE_PHYSICAL_CONTROL_BIT, MAX_CONTROL_BIT,
} from 'novadatainterface/control_bit_namespaces';
import { Entity } from 'nova_ecs/entity';
import {
    getIntegrationGameData, getPluginGameData, makePluginNovaParse,
} from '../communication/simulation_test_fixture.js';
import { ControlBitResolver } from './control_bit_namespaces.js';
import { parseNCBSet } from './ncb.js';
import { ControlBitsComponent } from './ncb_plugin.js';
import {
    decodeSave, encodeSave, extractSaveData, restorePlayerState,
} from './save_game.js';
import { resetDiscovery } from './discovery_store.js';
import { ShipComponent } from './ship_plugin.js';

const P0 = FIRST_PRIVATE_PHYSICAL_CONTROL_BIT;

/**
 * Control bit namespacing (novaparse/src/ncb_namespace.ts) against the
 * real stock data and real plug-ins.
 */
describe('Control bit namespacing over stock data', () => {
    // Every bit the stock scenario sets or tests anywhere: 554 distinct
    // bits (b0..b9999) across the 31 NCB Test/Set fields of 12 resource
    // types plus dësc conditionals, as of the shipped Nova Files. A change
    // here means the scan found something new — check NCB_FIELDS.
    const STOCK_BASE_SET_SIZE = 554;

    it('has a stock base set of ' + STOCK_BASE_SET_SIZE + ' bits, all in b0..b9999',
        async () => {
            const gameData = await getIntegrationGameData();
            const data = await gameData.controlBitNamespaces;
            expect(data.baseSet.length).toBe(STOCK_BASE_SET_SIZE);
            expect(Math.max(...data.baseSet)).toBeLessThanOrEqual(MAX_CONTROL_BIT);
            expect(Math.min(...data.baseSet)).toBeGreaterThanOrEqual(0);
            expect(data.namespaces).toEqual([]);
            expect(data.pluginOrder).toEqual([]);
        });

    it('leaves stock expressions byte-identical', async () => {
        const gameData = await getIntegrationGameData();
        // The famous bare-number AvailBits, verbatim from the resource;
        // its OnFailure; a stock dësc conditional; a system's Visibility.
        const m428 = await gameData.data.Mission.get('nova:428');
        expect(m428.availBits).toBe('!(b511 | b515) & !((b50 | 467) | b6666)');
        expect(m428.onFailure).toBe('b467 !b511');
        const d3235 = await gameData.data.Description.get('nova:3235');
        expect(d3235.text).toContain('{b424 "');
        const s147 = await gameData.data.System.get('nova:147');
        expect(s147.visibility).toBe('!b36');
    });

    it('is identical when the stock data is parsed again', async () => {
        const first = makePluginNovaParse([]);
        const second = makePluginNovaParse([]);
        if (!first || !second) {
            pending('Nova_Data not installed');
            return;
        }
        const a = await first.controlBitMap;
        const b = await second.controlBitMap;
        expect(a.data).toEqual(b.data);
        expect(a.report).toEqual(b.report);
        expect(a.data.baseSet.length).toBe(STOCK_BASE_SET_SIZE);
    });
});

describe('Control bit namespacing across real plug-ins', () => {
    const ARPIA = 'arpia';
    const EXTRA = 'extra-outfits';
    const PLUGINS = [ARPIA, EXTRA];

    it('is a pure function of the loaded data', async () => {
        const first = makePluginNovaParse(PLUGINS);
        const second = makePluginNovaParse(PLUGINS);
        if (!first || !second) {
            pending('ARPIA and/or Extra Outfits plug-in not installed');
            return;
        }
        const a = await first.controlBitMap;
        const b = await second.controlBitMap;
        expect(a.data).toEqual(b.data);
        expect(a.report).toEqual(b.report);
        // Name-sorted load order: 'a' sorts before 'e', so ARPIA loads,
        // and allocates, first.
        expect(a.namespaceOrder).toEqual(['nova', ARPIA, EXTRA]);
        expect(a.data.pluginOrder).toEqual([ARPIA, EXTRA]);
        // Every private bit is in the private range, allocated densely in
        // namespace order then raw-bit order.
        let next = P0;
        for (const { bits } of a.data.namespaces) {
            let lastRaw = -1;
            for (const [raw, physical] of bits) {
                expect(raw).toBeGreaterThan(lastRaw);
                expect(physical).toBe(next++);
                lastRaw = raw;
            }
        }
    });

    it('separates the two plug-ins\' colliding b2050 and keeps stock bits',
        async () => {
            const gameData = await getPluginGameData(PLUGINS);
            if (!gameData) {
                pending('ARPIA and/or Extra Outfits plug-in not installed');
                return;
            }
            const resolver = new ControlBitResolver(
                await gameData.controlBitNamespaces);
            // Both use b2050 privately (Extra Outfits: crön 511; ARPIA:
            // mïsns 1044/1045); neither is stock.
            const extra = resolver.physicalBit([EXTRA, 2050])!;
            const arpia = resolver.physicalBit([ARPIA, 2050])!;
            expect(extra).toBeGreaterThanOrEqual(P0);
            expect(arpia).toBeGreaterThanOrEqual(P0);
            expect(extra).not.toBe(arpia);
            // ...and the parsed data uses exactly those numbers.
            const cron = await gameData.data.Cron.get(`${EXTRA}:511`);
            expect(cron.enableOn).toBe(`!b${extra}`);
            expect(cron.onEnd).toBe(`b${extra}`);
            const misn = await gameData.data.Mission.get(`${ARPIA}:1044`);
            expect(misn.onSuccess).toBe(`s1045 b${arpia}`);
            expect(misn.availBits).toContain(`!b${arpia}`);
            // A stock bit referenced by a plug-in stays stock (b424, the
            // stock "you can never buy this again" bit, is used by both).
            const data = await gameData.controlBitNamespaces;
            expect(data.baseSet).toContain(424);
            expect(resolver.physicalBit([ARPIA, 424])).toBe(424);
            expect(resolver.physicalBit([EXTRA, 424])).toBe(424);
        });

    it('renumbers Extra Outfits\' crafting bits into the private range',
        async () => {
            const gameData = await getPluginGameData(PLUGINS);
            if (!gameData) {
                pending('ARPIA and/or Extra Outfits plug-in not installed');
                return;
            }
            const resolver = new ControlBitResolver(
                await gameData.controlBitNamespaces);
            const hull = await gameData.data.Outfit.get(`${EXTRA}:471`);
            const [b9001, b9002, b9003, b9004] = [9001, 9002, 9003, 9004]
                .map(raw => resolver.physicalBit([EXTRA, raw])!);
            // The bare-number term stays bare, everything else is kept.
            expect(hull.availability)
                .toBe(`b${b9002} & b${b9003} & b${b9004} & !${b9001}`);
            expect(hull.onPurchase).toBe(`!b${b9002} & !b${b9003} & !b${b9004}`
                + ` & b${b9001} G472 D468 D469 D470 D471 `);
            // Outfit ids in the set string are untouched (G472 etc.).
            const ops = parseNCBSet(hull.onPurchase);
            expect(ops.filter(op => op.type === 'grantOutfit'))
                .toEqual([{ type: 'grantOutfit', id: 472 }]);
        });

    it('reports the collisions and the never-set tests', async () => {
        const novaParse = makePluginNovaParse(PLUGINS);
        if (!novaParse) {
            pending('ARPIA and/or Extra Outfits plug-in not installed');
            return;
        }
        const { report } = await novaParse.controlBitMap;
        const colliding = report.collisions.map(c => c.bit);
        expect(colliding).toContain(2050);
        expect(colliding).toContain(2000);
        expect(colliding).toContain(2081);
        // In load (= allocation) order, which is by name.
        for (const { namespaces } of report.collisions) {
            expect(namespaces).toEqual([ARPIA, EXTRA]);
        }
        // Extra Outfits' Opals (oütf 551) test b2081, which only ARPIA
        // sets — a cross-plug-in dependency (or a slip) that the two
        // plug-ins' separate namespaces now surface.
        expect(report.testedNeverSet).toContain(jasmine.objectContaining({
            namespace: EXTRA, bit: 2081,
            testedBy: [`oütf ${EXTRA}:551.availability`],
        }));
    });
});

/**
 * A real pilot file written before namespacing (bare physical numbers),
 * loaded under the plug-in set it was played with. The file is a data-fork
 * JSON pilot (the "novajs-pilot" format), checked in as a fixture like
 * outfitter_officer_quarters_integration_test's.
 */
describe('Legacy pilot file under the namespaced plug-in set', () => {
    // extractSaveData reads the module-global discovery cache and
    // restorePlayerState writes it — see save_game_test's 'save_game
    // schema' note on the seed-dependent leak that causes.
    beforeEach(() => resetDiscovery());
    afterEach(() => resetDiscovery());

    // Jasmine runs with cwd = packages/nova (see nova_data_gate.ts).
    const PILOT = path.join(process.cwd(), 'test_fixtures', 'pilots',
        'Shane_Merrol_misisons_bug.plt');
    const PLUGINS = ['arpia', 'extra-outfits', 'singularity', 'Planet Rico'];

    async function bench() {
        const gameData = await getPluginGameData(PLUGINS);
        if (!gameData) {
            return undefined;
        }
        const pilot = JSON.parse(fs.readFileSync(PILOT, 'utf8'));
        const save = decodeSave(JSON.stringify(pilot.save));
        if (!save) {
            throw new Error('The pilot file\'s save no longer decodes');
        }
        const data = await gameData.controlBitNamespaces;
        return { save, data, resolver: new ControlBitResolver(data) };
    }

    it('keeps every stock bit at its number and moves the rest', async () => {
        const b = await bench();
        if (!b) {
            pending('Plug-ins not installed');
            return;
        }
        // The file predates namespacing: numbers only, no pairs.
        expect(b.save.controlBits).toBeUndefined();
        expect(b.save.novaControlBits).toBeDefined();
        const legacy = b.save.novaControlBits!.map(([bit]) => parseInt(bit, 10));
        expect(legacy.length).toBeGreaterThan(40);
        const baseSet = new Set(b.data.baseSet);

        const entity = new Entity('restored');
        entity.components.set(ShipComponent, { id: b.save.ship });
        const { parkedControlBits } =
            restorePlayerState(entity, b.save, b.resolver);
        const physical = entity.components.get(ControlBitsComponent)!;

        // Every stock-range bit the pilot had that the stock scenario
        // uses is still set under the same number.
        const stock = legacy.filter(bit => baseSet.has(bit));
        expect(stock.length).toBeGreaterThan(40);
        for (const bit of stock) {
            expect(physical.has(bit)).withContext(`stock b${bit}`).toBe(true);
        }
        // Bits some loaded plug-in uses privately moved into that
        // plug-in's namespace (b4601/b4603 are Planet Rico's; b9009 is
        // Extra Outfits'); the physical set holds their new numbers.
        const claimed = legacy.filter(bit => !baseSet.has(bit)
            && b.data.namespaces.some(n => n.bits.some(([raw]) => raw === bit)));
        expect(claimed).toContain(4601);
        expect(claimed).toContain(9009);
        for (const bit of claimed) {
            expect(physical.has(bit)).withContext(`raw b${bit}`).toBe(false);
            const pairs = b.resolver.toPairs(physical)
                .filter(([ns, raw]) => raw === bit && ns !== 'nova');
            expect(pairs.length).withContext(`b${bit} owners`).toBeGreaterThan(0);
        }
        // Nothing parks: every number is a stock bit or a loaded plug-in's.
        expect(parkedControlBits).toEqual([]);
        // The physical set is exactly stock ∪ private: nothing invented.
        expect([...physical].every(bit => bit <= MAX_CONTROL_BIT || bit >= P0))
            .toBe(true);
    });

    it('round-trips save -> load -> save stably', async () => {
        const b = await bench();
        if (!b) {
            pending('Plug-ins not installed');
            return;
        }
        const entity = new Entity('restored');
        entity.components.set(ShipComponent, { id: b.save.ship });
        const first = restorePlayerState(entity, b.save, b.resolver);
        const saved = extractSaveData(entity, b.save.system,
            { resolver: b.resolver, parked: first.parkedControlBits })!;
        expect(saved.controlBits).toBeDefined();
        expect(saved.plugins).toEqual(b.data.pluginOrder);
        // The pairs name the plug-ins the bits belong to.
        const namespaces = new Set(saved.controlBits!.map(([ns]) => ns));
        expect(namespaces).toContain('nova');
        expect(namespaces).toContain('Planet Rico');
        expect(namespaces).toContain('extra-outfits');

        const decoded = decodeSave(encodeSave(saved))!;
        const again = new Entity('again');
        again.components.set(ShipComponent, { id: b.save.ship });
        const second = restorePlayerState(again, decoded, b.resolver);
        expect(again.components.get(ControlBitsComponent))
            .toEqual(entity.components.get(ControlBitsComponent));
        expect(second.parkedControlBits).toEqual(first.parkedControlBits);
        const resaved = extractSaveData(again, b.save.system,
            { resolver: b.resolver, parked: second.parkedControlBits })!;
        expect(resaved.controlBits).toEqual(saved.controlBits);
        expect(resaved.novaControlBits).toEqual(saved.novaControlBits);
        // And the envelope still decodes as a save.
        expect(decodeSave(encodeSave(resaved))).toBeDefined();
    });

    it('parks a plug-in\'s bits when it is not loaded, and restores them '
        + 'when it is', async () => {
            const b = await bench();
            if (!b) {
                pending('Plug-ins not installed');
                return;
            }
            // Written under the full set...
            const entity = new Entity('restored');
            entity.components.set(ShipComponent, { id: b.save.ship });
            restorePlayerState(entity, b.save, b.resolver);
            const saved = extractSaveData(entity, b.save.system,
                { resolver: b.resolver })!;
            // ...loaded with no plug-ins at all: stock bits live, the
            // plug-in pairs park...
            const bare = new ControlBitResolver(undefined);
            const stockOnly = new Entity('stock');
            stockOnly.components.set(ShipComponent, { id: b.save.ship });
            const { parkedControlBits } =
                restorePlayerState(stockOnly, saved, bare);
            const bits = stockOnly.components.get(ControlBitsComponent)!;
            expect([...bits].every(bit => bit <= MAX_CONTROL_BIT)).toBe(true);
            expect(parkedControlBits.length).toBeGreaterThan(0);
            expect(parkedControlBits.every(([ns]) => ns !== 'nova')).toBe(true);
            // ...ride along in the next save...
            const resaved = extractSaveData(stockOnly, b.save.system,
                { resolver: bare, parked: parkedControlBits })!;
            expect(resaved.controlBits).toEqual(saved.controlBits);
            expect(resaved.plugins).toEqual([]);
            // ...and come back once the plug-ins are loaded again.
            const back = new Entity('back');
            back.components.set(ShipComponent, { id: b.save.ship });
            const restored = restorePlayerState(back, resaved, b.resolver);
            expect(back.components.get(ControlBitsComponent))
                .toEqual(entity.components.get(ControlBitsComponent));
            expect(restored.parkedControlBits).toEqual([]);
        });
});
