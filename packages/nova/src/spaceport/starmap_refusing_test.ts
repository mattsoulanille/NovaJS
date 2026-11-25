import 'jasmine';
import { getDefaultGovtData, GovtData } from 'novadatainterface/govt_data';
import { getDefaultPlanetData, PlanetData } from 'novadatainterface/planet_data';
import { getDefaultSystemData, SystemData } from 'novadatainterface/system_data';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import { novaDataInstalled, requireNovaData } from '../test_support/nova_data_gate.js';
import { systemIsInhabited } from '../nova_plugin/core/index.js';
import { MissionUniverse } from './mission_universe.js';
import { MapClearancePlayer, refusingSystems } from './starmap.js';
import {
    SYSTEM_INHABITED_COLOR, SYSTEM_REFUSING_CLEAN_COLOR, SYSTEM_REFUSING_COLOR,
    SYSTEM_UNEXPLORED_COLOR, SYSTEM_UNINHABITED_COLOR, systemDotColor,
} from './starmap_draw.js';

/**
 * The star map's ORANGE and RED dots (reference "Map dot colours", waves 23
 * and 24): Kit Map Wanted (owner gövt 360, CrimeTol 10), the pilot at -500
 * there, its only stellar a station with MinStatus 0 that answered
 * "Docking request denied." — #ff0000 from the hub next door and as the
 * current system; Kit Map Picky (one port, MinStatus 100) #ff6300 at record
 * 0 and #ff0000 at -500; Kit Map Wanted Planet #ff0000 already at -5 ("No
 * Convictions"). Blue "Criminal" systems elsewhere were ones whose ports
 * still let the player land, and so is Kit Map Mixed (one port open).
 */
describe('the map\'s orange / red dot: every port refuses the player', () => {
    const wantedGovt: GovtData = {
        ...getDefaultGovtData(), id: 'kit:360', crimeTol: 10,
    };
    const hubGovt: GovtData = { ...getDefaultGovtData(), id: 'kit:363' };
    const station = (id: string, minStatus: number, govt: string):
        PlanetData => ({
            ...getDefaultPlanetData(), id, name: id, govt, minStatus,
            flags: { ...getDefaultPlanetData().flags, canLand: true,
                uninhabited: false, isStation: true },
        });
    const wantedStation = station('kit:1480', 0, wantedGovt.id);
    const pickyPort = station('kit:1491', 100, hubGovt.id);
    const openPort = station('kit:open', -32767, wantedGovt.id);
    const hubPort = station('kit:hub', -32767, hubGovt.id);
    const gate: PlanetData = {
        ...station('kit:gate', 32767, 'kit:183'),
        gate: { kind: 'hypergate', destinations: ['x'], emergenceAngle: null },
    };
    const planets = new Map([wantedStation, pickyPort, openPort, hubPort, gate]
        .map(p => [p.id, p]));
    const govts = new Map([wantedGovt, hubGovt].map(g => [g.id, g]));
    const sys = (id: string, govt: string | null, ids: string[]):
        SystemData => ({ ...getDefaultSystemData(), id, name: id, govt,
            planets: ids });
    const systems = [
        sys('kit:1175', hubGovt.id, [hubPort.id]),
        sys('kit:1178', wantedGovt.id, [wantedStation.id]),
        sys('kit:mixed', wantedGovt.id, [wantedStation.id, openPort.id]),
        sys('kit:gated', wantedGovt.id, [wantedStation.id, gate.id]),
        sys('kit:gateonly', null, [gate.id]),
        sys('kit:1188', hubGovt.id, [pickyPort.id]),
    ];
    const universe = {
        getPlanet: (id: string) => planets.get(id),
        getGovt: (id: string) => govts.get(id),
        getSystemInfo: (id: string) => {
            const s = systems.find(system => system.id === id);
            return s ? { id, govt: s.govt, links: [] } : undefined;
        },
        getRank: () => undefined,
        sameStellar: (a: string, b: string) => a === b,
    };
    /** The pilot at `record` everywhere. */
    const at = (record: number, extra: Partial<MapClearancePlayer> = {}) => ({
        records: new Map(systems.map(s => [s.id, record])), now: 0, ...extra,
    });
    const wanted = (extra: Partial<MapClearancePlayer> = {}) =>
        at(-500, extra);
    const all = () => true;
    const contribute = () => undefined;

    it('reddens a system whose only port refuses at a negative record, '
        + 'wherever the pilot is', () => {
            const red = refusingSystems(systems, universe, wanted(), all,
                contribute);
            expect([...red].sort()).toEqual([
                ['kit:1178', 'negative'], ['kit:1188', 'negative'],
                ['kit:gated', 'negative'],
            ]);
            expect(systemDotColor(true, true, red.get('kit:1178')))
                .toBe(SYSTEM_REFUSING_COLOR);
            expect(SYSTEM_REFUSING_COLOR).toBe(0xff0000);
        });

    it('is RED already at -5 ("No Convictions", not hostile): the sign of '
        + 'the record decides, not hostility (Kit Map Wanted Planet)', () => {
            const red = refusingSystems(systems, universe, at(-5), all,
                contribute);
            expect(red.get('kit:1178')).toBe('negative');
            expect(red.has('kit:mixed')).toBeFalse();
        });

    it('is ORANGE when the only port refuses at a clean record (Kit Map '
        + 'Picky, MinStatus 100, record 0)', () => {
            const clean = refusingSystems(systems, universe, at(0), all,
                contribute);
            expect([...clean]).toEqual([['kit:1188', 'clean']]);
            expect(systemDotColor(true, true, clean.get('kit:1188')))
                .toBe(SYSTEM_REFUSING_CLEAN_COLOR);
            expect(SYSTEM_REFUSING_CLEAN_COLOR).toBe(0xff6300);
            // GUESS: a positive record still below MinStatus is orange too.
            expect(refusingSystems(systems, universe, at(50), all,
                contribute).get('kit:1188')).toBe('clean');
            // An absent record reads as the owner's InitialRec (0 here).
            expect(refusingSystems(systems, universe,
                { records: new Map(), now: 0 }, all, contribute)
                .get('kit:1188')).toBe('clean');
        });

    it('keeps a mixed system blue (measured, Kit Map Mixed at -500 and -5) '
        + 'and never colours a gate-only one', () => {
            for (const record of [-500, -5]) {
                const red = refusingSystems(systems, universe, at(record),
                    all, contribute);
                expect(red.has('kit:mixed')).withContext(`${record}`)
                    .toBeFalse();
                expect(red.has('kit:gateonly')).toBeFalse();
            }
            // The gate-only system is grey: grey wins over red.
            expect(systemIsInhabited(['kit:gate'],
                id => universe.getPlanet(id))).toBeFalse();
            expect(systemDotColor(true, false, 'negative'))
                .toBe(SYSTEM_UNINHABITED_COLOR);
        });

    it('is blue again once the record clears MinStatus, or a bribe or a '
        + 'mission opens the port — the landing gate\'s own rule', () => {
            const clean = refusingSystems(systems, universe, {
                records: new Map(), now: 0,
            }, all, contribute);
            // Only Picky (MinStatus 100) still refuses a clean record.
            expect([...clean.keys()]).toEqual(['kit:1188']);
            const bribed = refusingSystems(systems, universe, wanted({
                bribes: new Map([[wantedStation.id, 1000]]), now: 10,
            }), all, contribute);
            expect(bribed.has('kit:1178')).toBeFalse();
            expect(bribed.has('kit:gated')).toBeFalse();
            const expired = refusingSystems(systems, universe, wanted({
                bribes: new Map([[wantedStation.id, 1000]]), now: 2000,
            }), all, contribute);
            expect(expired.has('kit:1178')).toBeTrue();
            const mission = refusingSystems(systems, universe, wanted({
                missions: new Map([['m', {
                    travelPlanet: wantedStation.id, returnPlanet: null,
                }]]) as unknown as MapClearancePlayer['missions'],
            }), all, contribute);
            expect(mission.has('kit:1178')).toBeFalse();
        });

    it('leaves an unexplored system dark grey: knowledge first', () => {
        const red = refusingSystems(systems, universe, wanted(),
            id => id !== 'kit:1178', contribute);
        expect(red.has('kit:1178')).toBeFalse();
        expect(systemDotColor(false, true, 'negative'))
            .toBe(SYSTEM_UNEXPLORED_COLOR);
        expect(systemDotColor(false, true, 'clean'))
            .toBe(SYSTEM_UNEXPLORED_COLOR);
        expect(systemDotColor(true, true, undefined))
            .toBe(SYSTEM_INHABITED_COLOR);
    });
});

/**
 * What the orange / red rule does to a FRESH stock pilot with the whole
 * galaxy explored (no records yet, so each system reads its owner's
 * InitialRec, no ranks, no permits, no missions). Pins the list so a change
 * to the clearance rule or to the data shows up here.
 */
describe('the map\'s orange / red dots on stock data (a fresh pilot)', () => {
    let universe: MissionUniverse;
    let systems: SystemData[];
    beforeEach(requireNovaData);
    beforeAll(async () => {
        if (!novaDataInstalled()) return; // each spec pends instead
        const gameData = await getIntegrationGameData();
        universe = MissionUniverse.shared(gameData);
        await universe.load();
        const ids = (await gameData.ids).System
            .filter(id => id.startsWith('nova:'));
        systems = await Promise.all(ids.map(id => gameData.data.System.get(id)));
    }, 120_000);

    it('colours only systems whose every settled port is closed to a '
        + 'newcomer: ORANGE at a clean record, RED where the owner\'s '
        + 'InitialRec is negative', () => {
            const refusing = refusingSystems(systems, universe,
                { records: new Map(), now: 0 }, () => true, () => undefined);
            const names = [...refusing].sort(([a], [b]) => a < b ? -1 : 1)
                .map(([id, why]) => `${id} ${universe.systemName(id)} `
                    + (why === 'clean' ? 'orange' : 'red'));
            // Sol (Earth MinStatus 0 vs Federation InitialRec 0) is open.
            expect(refusing.has('nova:130')).toBeFalse();
            // Every coloured system really has a settled port, all
            // refusing, and its colour is the sign of the owner's
            // InitialRec (the fresh pilot's record there).
            for (const [id, why] of refusing) {
                const system = systems.find(s => s.id === id)!;
                expect(systemIsInhabited(system.planets,
                    p => universe.getPlanet(p))).withContext(id).toBeTrue();
                const initial = universe.getGovt(system.govt ?? '')
                    ?.initialRecord ?? 0;
                expect(why).withContext(id)
                    .toBe(initial < 0 ? 'negative' : 'clean');
            }
            expect(names).toEqual(STOCK_REFUSING_FOR_A_FRESH_PILOT);
            // MEASURED orange on the original for a fresh Shuttle (reference
            // "Map dot colours, wave 24"): Alphara, Kerella, Gateway,
            // Lesten, Rigel.
            for (const id of ['nova:131', 'nova:134', 'nova:159', 'nova:167',
                'nova:188']) {
                expect(refusing.get(id)).withContext(id).toBe('clean');
            }
        });
});

/**
 * A fresh stock pilot's coloured systems: each one's settled ports all ask
 * for more than the owner's InitialRec — the Federation spacedocks
 * (MinStatus 2: Alphara, Kerella, Gateway), Menin (5, Lesten), Rigel III
 * (4), the Polaris worlds (2-10), the Heraan Landing Points (1-2), Rebel I /
 * II (5), and so on. ORANGE where that InitialRec is 0; RED in the
 * Nil'kemorya systems (gövt nova:147, InitialRec -5: a fresh pilot starts
 * at -5 there, the "No Convictions" record that drew Kit Map Wanted Planet
 * red). MEASURED orange on the original for Alphara, Gateway, Kerella,
 * Lesten and Rigel (reference "Map dot colours, wave 24"); the rest follow
 * the same rule, unmeasured one by one (no Nil'kemorya system was seen).
 */
const STOCK_REFUSING_FOR_A_FRESH_PILOT: string[] = [
    "nova:131 Alphara orange",
    "nova:134 Kerella orange",
    "nova:159 Gateway orange",
    "nova:167 Lesten orange",
    "nova:188 Rigel orange",
    "nova:197 Rimshot orange",
    "nova:206 Mjolnir red",
    "nova:208 Nil'kvee red",
    "nova:209 Nil'kol red",
    "nova:210 Nil'vran red",
    "nova:218 Nil'kemorya red",
    "nova:226 Ver'ashan orange",
    "nova:227 Til'hapin orange",
    "nova:238 Ne'helipar red",
    "nova:239 Nil'nesa red",
    "nova:244 Nil'pesetra red",
    "nova:245 Mu'hari orange",
    "nova:258 Ne'ritai red",
    "nova:259 P'aedt orange",
    "nova:261 Ver'asplast orange",
    "nova:263 Nil'blei red",
    "nova:265 Nil'ikro red",
    "nova:331 Chayos orange",
    "nova:334 Ivia orange",
    "nova:336 Vemap orange",
    "nova:347 Vantra orange",
    "nova:357 Aalolph orange",
    "nova:368 Moash Nek orange",
    "nova:390 Grak orange",
    "nova:468 Evlei orange",
    "nova:483 Koria orange",
    "nova:491 Scheall orange",
    "nova:606 Nil'kvee red",
    "nova:607 Nil'nesa red",
    "nova:610 Nil'blei red",
];
