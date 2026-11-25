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
    SYSTEM_INHABITED_COLOR, SYSTEM_REFUSING_COLOR, SYSTEM_UNEXPLORED_COLOR,
    SYSTEM_UNINHABITED_COLOR, systemDotColor,
} from './starmap_draw.js';

/**
 * The star map's RED dot (reference "Map dot colours, wave 23"): Kit Map
 * Wanted (owner gövt 360, CrimeTol 10), the pilot at -500 there, its only
 * stellar a station with MinStatus 0 that answered "Docking request
 * denied." — #ff0000 from the hub next door and as the current system.
 * Blue "Criminal" systems elsewhere were ones whose ports still let the
 * player land.
 */
describe('the map\'s red dot: every port refuses the player', () => {
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
    const openPort = station('kit:open', -32767, wantedGovt.id);
    const hubPort = station('kit:hub', -32767, hubGovt.id);
    const gate: PlanetData = {
        ...station('kit:gate', 32767, 'kit:183'),
        gate: { kind: 'hypergate', destinations: ['x'], emergenceAngle: null },
    };
    const planets = new Map([wantedStation, openPort, hubPort, gate]
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
    const wanted = (extra: Partial<MapClearancePlayer> = {}) => ({
        records: new Map(systems.map(s => [s.id, -500])), now: 0, ...extra,
    });
    const all = () => true;
    const contribute = () => undefined;

    it('reddens a system whose only port refuses, wherever the pilot is', () => {
        const red = refusingSystems(systems, universe, wanted(), all,
            contribute);
        expect([...red].sort()).toEqual(['kit:1178', 'kit:gated']);
        expect(systemDotColor(true, true, red.has('kit:1178')))
            .toBe(SYSTEM_REFUSING_COLOR);
        expect(SYSTEM_REFUSING_COLOR).toBe(0xff0000);
    });

    it('keeps a mixed system blue (GUESS) and never reddens a gate-only one',
        () => {
            const red = refusingSystems(systems, universe, wanted(), all,
                contribute);
            expect(red.has('kit:mixed')).toBeFalse();
            expect(red.has('kit:gateonly')).toBeFalse();
            // The gate-only system is grey: grey wins over red.
            expect(systemIsInhabited(['kit:gate'],
                id => universe.getPlanet(id))).toBeFalse();
            expect(systemDotColor(true, false, true))
                .toBe(SYSTEM_UNINHABITED_COLOR);
        });

    it('is blue again once the record clears MinStatus, or a bribe or a '
        + 'mission opens the port — the landing gate\'s own rule', () => {
            const clean = refusingSystems(systems, universe, {
                records: new Map(), now: 0,
            }, all, contribute);
            expect(clean.size).toBe(0);
            const bribed = refusingSystems(systems, universe, wanted({
                bribes: new Map([[wantedStation.id, 1000]]), now: 10,
            }), all, contribute);
            expect(bribed.size).toBe(0);
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
        expect(systemDotColor(false, true, true))
            .toBe(SYSTEM_UNEXPLORED_COLOR);
        expect(systemDotColor(true, true, false))
            .toBe(SYSTEM_INHABITED_COLOR);
    });
});

/**
 * What the red rule does to a FRESH stock pilot with the whole galaxy
 * explored (no records yet, so each system reads its owner's InitialRec,
 * no ranks, no permits, no missions). Pins the list so a change to the
 * clearance rule or to the data shows up here.
 */
describe('the map\'s red dot on stock data (a fresh pilot)', () => {
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

    it('reddens only systems whose every settled port is closed to a '
        + 'newcomer', () => {
            const red = refusingSystems(systems, universe,
                { records: new Map(), now: 0 }, () => true, () => undefined);
            const names = [...red].sort().map(id =>
                `${id} ${universe.systemName(id)}`);
            // Sol (Earth MinStatus 0 vs Federation InitialRec 0) is open.
            expect(red.has('nova:130')).toBeFalse();
            // Every red system really has a settled port, all refusing.
            for (const id of red) {
                const system = systems.find(s => s.id === id)!;
                expect(systemIsInhabited(system.planets,
                    p => universe.getPlanet(p))).withContext(id).toBeTrue();
            }
            expect(names).toEqual(STOCK_RED_FOR_A_FRESH_PILOT);
        });
});

/**
 * A fresh stock pilot's red systems: each one's settled ports all ask for
 * more than the owner's InitialRec (0 for every owner here) — the Federation
 * spacedocks (MinStatus 2: Alphara, Kerella, Gateway), Menin (5, Lesten),
 * Rigel III (4), the Polaris worlds (2-10), the Heraan Landing Points (1-2),
 * Rebel I / II (5), and so on. UNMEASURED as a set: only Kit Map Wanted
 * (record -500 below MinStatus 0) was seen red; a fresh pilot's map of
 * Federation space (Kerella, Gateway) on the original would confirm or
 * refute "red = refused, whatever the record's sign".
 */
const STOCK_RED_FOR_A_FRESH_PILOT: string[] = [
    "nova:131 Alphara",
    "nova:134 Kerella",
    "nova:159 Gateway",
    "nova:167 Lesten",
    "nova:188 Rigel",
    "nova:197 Rimshot",
    "nova:206 Mjolnir",
    "nova:208 Nil'kvee",
    "nova:209 Nil'kol",
    "nova:210 Nil'vran",
    "nova:218 Nil'kemorya",
    "nova:226 Ver'ashan",
    "nova:227 Til'hapin",
    "nova:238 Ne'helipar",
    "nova:239 Nil'nesa",
    "nova:244 Nil'pesetra",
    "nova:245 Mu'hari",
    "nova:258 Ne'ritai",
    "nova:259 P'aedt",
    "nova:261 Ver'asplast",
    "nova:263 Nil'blei",
    "nova:265 Nil'ikro",
    "nova:331 Chayos",
    "nova:334 Ivia",
    "nova:336 Vemap",
    "nova:347 Vantra",
    "nova:357 Aalolph",
    "nova:368 Moash Nek",
    "nova:390 Grak",
    "nova:468 Evlei",
    "nova:483 Koria",
    "nova:491 Scheall",
    "nova:606 Nil'kvee",
    "nova:607 Nil'nesa",
    "nova:610 Nil'blei",
];
