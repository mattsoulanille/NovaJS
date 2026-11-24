import 'jasmine';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import { missionCargoAbbrev } from '../nova_plugin/missions/index.js';
import { missionCargoKey } from '../nova_plugin/player/index.js';
import { novaDataInstalled, requireNovaData } from '../test_support/nova_data_gate.js';
import { cargoDisplayOf, specialCargoName } from './status_bar_cargo.js';

/**
 * ============================================================================
 * The status bar's "Special:" readout: STR# 4002 cargo abbreviations
 * ============================================================================
 *
 * The original names a mission's cargo on the status bar by its STR# 4002
 * entry ("Cargo abbreviations for status display", Bible Appendix III):
 * - "Raczak" with stock "Rescue Raczak" (nova:394, cargo type 27, STR#
 *   4000 "*Admiral Raczak") aboard (reference "Boarding a rescue ship",
 *   wave 13);
 * - "Probe" with a "*Space Probe" (type 75) aboard
 *   (p_properties/cargo_with_stuff.png and the Port Kane trade center).
 * With only plain commodities aboard the Special label and value are gone
 * (trade_center/390_medical_supplies.png), and with several mission
 * cargos it reads stock STR# 2002 index 20, "Multiple".
 */

/** A slice of the stock tables: 0 Food, 1 "*Admiral Raczak", 2 "Artwork",
 * 3 "*Space Probe". */
const NAMES = ['Food', '*Admiral Raczak', 'Artwork', '*Space Probe'];
const ABBREVS = ['Food', 'Raczak', 'Artwork', 'Probe'];

const gameData = {
    data: { Junk: { getCached: () => undefined } },
} as unknown as SimulationGameDataInterface;

describe('missionCargoAbbrev', () => {
    it('is the STR# 4002 entry for the cargo type', () => {
        expect(missionCargoAbbrev(1, NAMES, ABBREVS)).toBe('Raczak');
        expect(missionCargoAbbrev(3, NAMES, ABBREVS)).toBe('Probe');
    });

    it("drops a '*' mark from a 4002 entry", () => {
        expect(missionCargoAbbrev(1, NAMES, ['Food', '*Raczak']))
            .toBe('Raczak');
    });

    it('falls back to the STR# 4000 name, unmarked, without a 4002 entry',
        () => {
            expect(missionCargoAbbrev(1, NAMES, ['Food'])).toBe(
                'Admiral Raczak');
        });

    it('falls back to the stock abbreviations only for the stock names',
        () => {
            // No tables at all: the built-in six.
            expect(missionCargoAbbrev(1, [], [])).toBe('IndGds');
            // A plug-in's renamed commodity keeps its own name.
            expect(missionCargoAbbrev(1, ['Food', 'Widgets'], []))
                .toBe('Widgets');
        });
});

describe('the Special readout', () => {
    const missions = new Map([
        ['nova:394', { cargoType: 1 }],
        ['nova:500', { cargoType: 3 }],
        ['nova:600', { cargoType: -1 }],
    ]);
    const source = { missions, names: NAMES, abbrevs: ABBREVS };

    it("names one mission's cargo by its abbreviation", () => {
        const cargo = new Map([['cargo:0', 9],
            [missionCargoKey('nova:394'), 1]]);
        expect(cargoDisplayOf(cargo, 200, gameData, source).special)
            .toBe('Raczak');
        expect(specialCargoName(missionCargoKey('nova:500'), source))
            .toBe('Probe');
    });

    it('reads "Multiple" with several mission cargos aboard', () => {
        const cargo = new Map([[missionCargoKey('nova:394'), 1],
            [missionCargoKey('nova:500'), 5]]);
        expect(cargoDisplayOf(cargo, 200, gameData, source).special)
            .toBe('Multiple');
    });

    it('is absent with only plain commodities aboard', () => {
        const cargo = new Map([['cargo:2', 390]]);
        const display = cargoDisplayOf(cargo, 390, gameData, source);
        expect(display.special).toBeNull();
        expect(display.lines).toEqual([{ name: 'Med', quantity: 390 }]);
    });

    it('reads "Cargo" for a mission it cannot name', () => {
        // Not among the active missions (a stale key), and one whose
        // cargo type is unset.
        expect(specialCargoName(missionCargoKey('nova:999'), source))
            .toBe('Cargo');
        expect(specialCargoName(missionCargoKey('nova:600'), source))
            .toBe('Cargo');
        // No source at all (the pre-4002 call shape).
        expect(cargoDisplayOf(new Map([[missionCargoKey('nova:394'), 1]]),
            200, gameData).special).toBe('Cargo');
    });

    it('uses the stock abbreviations when the tables are empty', () => {
        expect(specialCargoName(missionCargoKey('nova:394'),
            { missions, names: [], abbrevs: [] })).toBe('IndGds');
    });

    describe('against the stock strings', () => {
        beforeEach(requireNovaData);

        it('parses STR# 4002 and names Raczak and the probe', async () => {
            if (!novaDataInstalled()) {
                return;
            }
            const data = await getIntegrationGameData();
            const start = await data.data.PlayerStart.get(
                (await data.ids).PlayerStart[0]!);
            expect(start.cargoAbbrevs.slice(0, 6)).toEqual(['Food', 'IndGds',
                'MedGds', 'LuxGds', 'Metal', 'Equpt']);
            expect(start.cargoAbbrevs[27]).toBe('Raczak');
            expect(start.cargoAbbrevs[75]).toBe('Probe');
            // No stock entry carries the '*' mark.
            expect(start.cargoAbbrevs.filter(a => a.startsWith('*')))
                .toEqual([]);

            const raczak = (await data.data.Mission.get('nova:394'))
                .cargoType;
            expect(raczak).toBe(27);
            const tables = {
                names: start.cargoNames, abbrevs: start.cargoAbbrevs,
            };
            const cargo = new Map([[missionCargoKey('nova:394'), 1]]);
            expect(cargoDisplayOf(cargo, 200, gameData, {
                missions: new Map([['nova:394', { cargoType: raczak }]]),
                ...tables,
            }).special).toBe('Raczak');
            expect(missionCargoAbbrev(75, start.cargoNames,
                start.cargoAbbrevs)).toBe('Probe');
        });
    });
});
