import 'jasmine';
import { ShipData } from 'novadatainterface/ship_data';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import { CAPTION_LINE_HEIGHT, CAPTION_TOP, captionSegments } from './item_grid.js';
import { formatMass } from './outfitter.js';
import { infoDialogName } from './ship_info.js';

/**
 * The shipyard/outfitter tile caption, the More Info dialog's name strip
 * and the outfitter's tonnage readout are all STRING rules read off the
 * original's own screenshots (ui_screenshots/original_macos_screenshots/
 * shipyard/ and outfitter/). They are pinned here as pure rules because
 * measuring them needs a DOM (PIXI.Text). (headless_pixi_fixture.ts can
 * stand a whole menu up under node, but only far enough to inspect WHICH
 * objects it puts on screen — its text metrics are invented, so layout
 * facts still have to be pinned against the screenshots, here.)
 */
describe('tile caption (shïp ShortName)', () => {
    it('splits on the literal backslash-n the resource stores', () => {
        // What the parser actually reads out of shïp 363 is the two
        // characters "\" and "n", not a newline byte.
        expect(captionSegments({
            name: 'Heavy Shuttle; Version A',
            shortName: 'Heavy Shuttle\\n- used -',
        })).toEqual([
            { text: 'Heavy Shuttle', grey: false },
            { text: '- used -', grey: true },
        ]);
    });

    it('greys a line that starts with a non-alphanumeric character', () => {
        // EVN Bible ~:2680 -- "lines that start with an alphanumeric
        // character are drawn in white, while lines that start with other
        // symbols are drawn in grey". The "Asteroid Miner" tile in
        // shipyard/earth_spaceport.png shows BOTH its lines in white,
        // which is the same rule with an alphanumeric second line.
        expect(captionSegments({
            name: 'Asteroid Miner', shortName: 'Asteroid\\nMiner',
        })).toEqual([
            { text: 'Asteroid', grey: false },
            { text: 'Miner', grey: false },
        ]);
        expect(captionSegments({
            name: 'Shuttle; Version A', shortName: 'Shuttle \\n- Version A -',
        })).toEqual([
            { text: 'Shuttle', grey: false },
            { text: '- Version A -', grey: true },
        ]);
    });

    it('falls back to the resource name, minus its developer note', () => {
        // Outfits have no ShortName field at all, and some ships leave it
        // blank; both take this path.
        expect(captionSegments({ name: 'Light Blaster' }))
            .toEqual([{ text: 'Light Blaster', grey: false }]);
        expect(captionSegments({ name: 'Viper; Fighter', shortName: '' }))
            .toEqual([{ text: 'Viper', grey: false }]);
        expect(captionSegments({ name: 'Viper; Fighter', shortName: '   ' }))
            .toEqual([{ text: 'Viper', grey: false }]);
    });

    it('drops empty segments rather than draw a blank line', () => {
        expect(captionSegments({ name: 'x', shortName: 'Terrapin\\n' }))
            .toEqual([{ text: 'Terrapin', grey: false }]);
    });

    it('keeps the measured two-layout geometry', () => {
        // One line sits 8px lower than the first of two -- not a whole
        // line (11) lower. Measured on shipyard/earth_spaceport.png; see
        // CAPTION_TOP.
        expect(CAPTION_TOP.single - CAPTION_TOP.multi).toBe(8);
        expect(CAPTION_LINE_HEIGHT).toBe(11);
    });
});

describe('ship info name strip (shïp Long Name)', () => {
    it('prefers the long name the reference captures show', () => {
        expect(infoDialogName({
            name: 'Shuttle; Version A',
            longName: 'Sigma Shipyards Alpha class Shuttle',
        })).toBe('Sigma Shipyards Alpha class Shuttle');
    });

    it('falls back to the resource name when Long Name is blank', () => {
        expect(infoDialogName({ name: 'Shuttle; Version A', longName: '' }))
            .toBe('Shuttle');
        expect(infoDialogName({ name: 'Shuttle; Version A' })).toBe('Shuttle');
    });
});

describe('outfitter tonnage readout', () => {
    it('is singular for exactly one ton', () => {
        // outfitter/earth_outfitter_carbon_fiber_cant_hold_any_more.png
        // reads "Item Mass:  1 ton" over "Available:  0 tons".
        expect(formatMass(1)).toBe('1 ton');
        expect(formatMass(0)).toBe('0 tons');
        expect(formatMass(3)).toBe('3 tons');
    });

    it('groups thousands', () => {
        expect(formatMass(1500)).toBe('1,500 tons');
    });
});

describe('caption strings against the real Nova data', () => {
    async function ship(id: string): Promise<ShipData> {
        const gameData = await getIntegrationGameData();
        return await gameData.data.Ship.get(id);
    }

    it('renders the stock "- used -" hulls the reference shipyard shows',
        async () => {
            // shïp 361-372 are the second-hand hulls; four of them are on
            // screen in shipyard/earth_spaceport.png.
            for (const [id, first] of [
                ['nova:363', 'Heavy Shuttle'],
                ['nova:369', 'Terrapin'],
                ['nova:371', 'Valkyrie'],
                ['nova:367', 'Starbridge'],
            ] as const) {
                expect(captionSegments(await ship(id))).withContext(id)
                    .toEqual([
                        { text: first, grey: false },
                        { text: '- used -', grey: true },
                    ]);
            }
        });

    it('carries the Long Name the info dialog prints', async () => {
        expect(infoDialogName(await ship('nova:128')))
            .toBe('Sigma Shipyards Alpha class Shuttle');
    });
});
