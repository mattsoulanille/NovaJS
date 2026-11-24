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

const JUNKS: Record<string, { name: string, abbrev: string }> = {
    // The reference's kit jünk 203.
    'kit:203': { name: 'Kit Contraband', abbrev: 'Contraband' },
    'kit:204': { name: 'Kit Bees', abbrev: 'Bees' },
    'kit:205': { name: 'Kit Unabbreviated', abbrev: '' },
};
const gameData = {
    data: { Junk: { getCached: (id: string) => JUNKS[id] } },
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

    it('reads "Multiple" for two missions with the SAME cargo type '
        + '(reference w15_special)', () => {
            // mïsn 1085 and 1086, 3 t of one cargo type each.
            const same = new Map([['kit:1085', { cargoType: 3 }],
                ['kit:1086', { cargoType: 3 }]]);
            const one = new Map([[missionCargoKey('kit:1085'), 3]]);
            expect(cargoDisplayOf(one, 200, gameData,
                { ...source, missions: same }).special).toBe('Probe');
            const both = new Map([[missionCargoKey('kit:1085'), 3],
                [missionCargoKey('kit:1086'), 3]]);
            expect(cargoDisplayOf(both, 200, gameData,
                { ...source, missions: same }).special).toBe('Multiple');
        });

    it('packs the commodity rows in commodity order, with no gaps '
        + '(reference w15_special, #381)', () => {
            // Equipment 9, Luxury 7, Industrial 5, filled out of order.
            const cargo = new Map([['cargo:5', 9], ['cargo:3', 7],
                ['cargo:1', 5]]);
            const display = cargoDisplayOf(cargo, 200, gameData, source);
            expect(display.lines).toEqual([
                { name: 'Ind', quantity: 5 },
                { name: 'LuxG', quantity: 7 },
                { name: 'Equ', quantity: 9 },
            ]);
            expect(display.free).toBe(179);
            expect(display.special).toBeNull();
        });

    it('names jünk on the Special line by its Abbrev, never as a row '
        + '(reference w15_several, 11-gate.png)', () => {
            const cargo = new Map([['junk:kit:203', 10]]);
            const display = cargoDisplayOf(cargo, 200, gameData, source);
            expect(display.lines).toEqual([]);
            expect(display.special).toBe('Contraband');
            expect(display.free).toBe(190);
            // An empty Abbrev falls back to the name; uncached, "Cargo".
            expect(cargoDisplayOf(new Map([['junk:kit:205', 1]]), 200,
                gameData).special).toBe('Kit Unabbreviated');
            expect(cargoDisplayOf(new Map([['junk:kit:999', 1]]), 200,
                gameData).special).toBe('Cargo');
        });

    it('names the mission cargo, not the jünk, when both are aboard '
        + '(reference w15_several, 08-bought.png / 09-left.png)', () => {
            // 10 t of Kit Contraband and the 0x0020 mission's 1 t of Food.
            const cargo = new Map([['junk:kit:203', 10],
                [missionCargoKey('kit:1084'), 1]]);
            const display = cargoDisplayOf(cargo, 200, gameData, {
                ...source, missions: new Map([['kit:1084', { cargoType: 0 }]]),
            });
            expect(display.special).toBe('Food');
            expect(display.lines).toEqual([]);
            expect(display.free).toBe(189);
        });

    it('reads "Multiple" for two jünk types and no mission cargo (guess)',
        () => {
            const cargo = new Map([['junk:kit:203', 10], ['junk:kit:204', 2],
                ['cargo:0', 4]]);
            const display = cargoDisplayOf(cargo, 200, gameData, source);
            expect(display.special).toBe('Multiple');
            expect(display.lines).toEqual([{ name: 'Food', quantity: 4 }]);
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
