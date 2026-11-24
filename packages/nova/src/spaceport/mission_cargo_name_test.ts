import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultMissionData } from 'novadatainterface/mission_data';
import { getDefaultPlayerStartData } from 'novadatainterface/player_start_data';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import {
    expandMissionText, missionCargoKey, missionCargoName, MissionOffer,
    parseCargoName, playerInfoMissionCargoLine,
} from '../nova_plugin/missions/index.js';
import { novaDataInstalled, requireNovaData } from '../test_support/nova_data_gate.js';
import { offerSubstitutions } from './mission_offers.js';
import { MissionUniverse } from './mission_universe.js';
import { cargoListing } from './player_info.js';

/**
 * ============================================================================
 * Mission cargo names on screen: the Bible's '*' rule everywhere
 * ============================================================================
 *
 * "Mission cargo names that start with the asterisk character ('*') are
 * treated as \"quantityless\" - i.e. their quantity is never shown in the
 * player-info dialog and the word \"the\" is omitted in the message that
 * appears when the player retrieves that type of cargo from a ship"
 * (EVN Bible). The '*' is a marker: no screen shows it. Running text
 * (<CT>, the player-info list, the retrieval line) uses the lowercase
 * STR# 4001 names: the stock "Un. Shipping Delivery" briefing reads "1 ton
 * of artwork" (missions/missions_info.png; STR# 4000 is "Artwork"), and
 * the player info shows "Space probe." for STR# 4001 "*space probe"
 * (p_properties/cargo_with_stuff.png).
 *
 * The retrieval line has its own specs in rescue_board_test.ts.
 */

/** A slice of the stock tables: 0 Food, 1 "*Admiral Raczak", 2 "Artwork",
 * 3 "*Space Probe". */
const NAMES = ['Food', '*Admiral Raczak', 'Artwork', '*Space Probe'];
const LOWER = ['food', '*Admiral Raczak', 'artwork', '*space probe'];

describe('mission cargo names', () => {
    describe('parseCargoName', () => {
        it('drops the asterisk and marks the name quantityless', () => {
            expect(parseCargoName('*Admiral Raczak'))
                .toEqual({ text: 'Admiral Raczak', quantityless: true });
        });

        it('leaves any other name alone', () => {
            expect(parseCargoName('Artwork'))
                .toEqual({ text: 'Artwork', quantityless: false });
            // Only a LEADING asterisk is the marker.
            expect(parseCargoName('Grade *A* Ore'))
                .toEqual({ text: 'Grade *A* Ore', quantityless: false });
        });
    });

    describe('missionCargoName', () => {
        it('resolves both tables without the asterisk', () => {
            expect(missionCargoName(1, NAMES, LOWER)).toEqual({
                name: 'Admiral Raczak', lower: 'Admiral Raczak',
                quantityless: true,
            });
            expect(missionCargoName(3, NAMES, LOWER)).toEqual({
                name: 'Space Probe', lower: 'space probe',
                quantityless: true,
            });
            expect(missionCargoName(2, NAMES, LOWER)).toEqual({
                name: 'Artwork', lower: 'artwork', quantityless: false,
            });
        });

        it('falls back to the STR# 4000 name when STR# 4001 has no entry',
            () => {
                expect(missionCargoName(3, NAMES, [])).toEqual({
                    name: 'Space Probe', lower: 'Space Probe',
                    quantityless: true,
                });
                // A plug-in's renamed commodity is not read as stock "food".
                expect(missionCargoName(0, ['Grain'], []).lower)
                    .toBe('Grain');
            });

        it('falls back to the stock six with no tables at all', () => {
            expect(missionCargoName(1, [], [])).toEqual({
                name: 'Industrial', lower: 'industrial goods',
                quantityless: false,
            });
        });

        it('honours an asterisk in either table', () => {
            expect(missionCargoName(0, ['Raczak'], ['*Raczak']).quantityless)
                .toBeTrue();
            expect(missionCargoName(0, ['*Raczak'], ['Raczak']).quantityless)
                .toBeTrue();
        });
    });

    describe('the player-info cargo list', () => {
        it('shows a quantityless name alone, sentence-cased, no asterisk',
            () => {
                expect(playerInfoMissionCargoLine(
                    missionCargoName(1, NAMES, LOWER), 1))
                    .toBe('Admiral Raczak.');
                // The reference's "Space probe." (5 tons aboard).
                expect(playerInfoMissionCargoLine(
                    missionCargoName(3, NAMES, LOWER), 5))
                    .toBe('Space probe.');
            });

        it('shows the quantity of any other mission cargo', () => {
            expect(playerInfoMissionCargoLine(
                missionCargoName(2, NAMES, LOWER), 5))
                .toBe('5 tons of artwork.');
            expect(playerInfoMissionCargoLine(
                missionCargoName(2, NAMES, LOWER), 1))
                .toBe('1 ton of artwork.');
        });

        it('lists the hold, naming mission cargo from its mission', () => {
            const cargo = new Map([
                ['cargo:0', 10],
                [missionCargoKey('nova:394'), 1],
                [missionCargoKey('nova:500'), 3],
                [missionCargoKey('nova:600'), 2],
            ]);
            const missions = new Map([
                ['nova:394', { cargoType: 1 }],
                ['nova:500', { cargoType: 2 }],
                // A mission whose cargo type is unknown.
                ['nova:600', { cargoType: -1 }],
            ]);
            expect(cargoListing(cargo, missions, NAMES, LOWER)).toEqual({
                items: ['10 tons of Food.', 'Admiral Raczak.',
                    '3 tons of artwork.', '2 tons of mission cargo.'],
                held: 16,
            });
        });

        it('says "Nothing." for an empty hold', () => {
            expect(cargoListing(new Map(), undefined, NAMES, LOWER))
                .toEqual({ items: ['Nothing.'], held: 0 });
        });
    });

    describe('<CT>', () => {
        async function universe() {
            const gameData = new MockGameData();
            gameData.data.PlayerStart.map.set('nova:128', {
                ...getDefaultPlayerStartData(), id: 'nova:128',
                cargoNames: NAMES, cargoNamesLower: LOWER,
            });
            const u = new MissionUniverse(gameData);
            await u.load();
            return u;
        }

        function offer(cargoType: number, cargoQty: number): MissionOffer {
            return {
                data: getDefaultMissionData(), travelPlanet: null,
                returnPlanet: null, cargoType, cargoQty, acceptable: true,
            };
        }

        it('expands to the lowercase name without the asterisk', async () => {
            const u = await universe();
            const text = 'Bring <CT> to <RST>.';
            expect(expandMissionText(text,
                offerSubstitutions(u, 0, offer(1, 1), new Set())))
                .toContain('Bring Admiral Raczak to');
            expect(expandMissionText('Pick up <CQ> ton of <CT>.',
                offerSubstitutions(u, 0, offer(2, 1), new Set())))
                .toBe('Pick up 1 ton of artwork.');
            expect(expandMissionText('Launch the <CT>.',
                offerSubstitutions(u, 0, offer(3, 1), new Set())))
                .toBe('Launch the space probe.');
        });
    });

    describe('against the stock strings', () => {
        beforeEach(requireNovaData);

        it('reads STR# 4000 / 4001 and applies the rule', async () => {
            if (!novaDataInstalled()) {
                return;
            }
            const gameData = await getIntegrationGameData();
            const start = await gameData.data.PlayerStart.get(
                (await gameData.ids).PlayerStart[0]!);
            // STR# 4000 index 27, the Bible's case in the stock data, and
            // mïsn nova:394 "Rescue Raczak" carries it.
            expect(start.cargoNames[27]).toBe('*Admiral Raczak');
            expect(start.cargoNamesLower[27]).toBe('*Admiral Raczak');
            expect((await gameData.data.Mission.get('nova:394')).cargoType)
                .toBe(27);
            const raczak = missionCargoName(27, start.cargoNames,
                start.cargoNamesLower);
            expect(raczak).toEqual({
                name: 'Admiral Raczak', lower: 'Admiral Raczak',
                quantityless: true,
            });
            expect(playerInfoMissionCargoLine(raczak, 1))
                .toBe('Admiral Raczak.');

            // The two reference screenshots' names.
            expect(playerInfoMissionCargoLine(missionCargoName(75,
                start.cargoNames, start.cargoNamesLower), 5))
                .toBe('Space probe.');
            expect(missionCargoName(40, start.cargoNames,
                start.cargoNamesLower).lower).toBe('artwork');
        });
    });
});
