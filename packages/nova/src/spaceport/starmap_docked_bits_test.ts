import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultGovtData } from 'novadatainterface/govt_data';
import { getDefaultSystemData } from 'novadatainterface/system_data';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { ControlEvent } from '../nova_plugin/controls_plugin.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { MenuControls } from './menu_controls.js';
import { Starmap } from './starmap.js';

/**
 * Review finding #29: the starmap opened WHILE DOCKED filtered NCB system
 * visibility (and the Legal Status line) against an empty control-bit
 * set. The Starmap asks the plugin's `getPlayerBits` for the bits, and
 * that scans the display world for the player's ship — which landing has
 * removed. The marks and the date already rode along in
 * OpenStarmapOptions "because the docked entity is out of the display
 * world"; the bits and legal records now do too, and win over the
 * plugin's lookup for that open.
 *
 * The map is built headlessly against a two-system galaxy: Kania
 * (nova:130, always visible) and S7evyn (nova:472, stock Visibility
 * "b9995" — one of the 147 stock sÿsts hidden under empty bits).
 */
describe('the docked starmap\'s control bits', () => {
    beforeAll(() => installHeadlessPixi());

    const KANIA = 'nova:130';
    const S7EVYN = 'nova:472';

    function displayAssets(): DisplayAssetDataInterface {
        return {
            spriteFromPict: () => new PIXI.Sprite(),
            spriteFromPictAsync: async () => new PIXI.Sprite(),
            textureFromPict: () => PIXI.Texture.EMPTY,
            textureFromPictAsync: async () => PIXI.Texture.EMPTY,
            textureFromCicn: async () => PIXI.Texture.EMPTY,
            textureFromPpat: async () => PIXI.Texture.EMPTY,
            data: {},
        } as unknown as DisplayAssetDataInterface;
    }

    function gameData(): MockGameData {
        const data = new MockGameData();
        data.data.Govt.map.set('nova:128', {
            ...getDefaultGovtData(), id: 'nova:128', name: 'Federation',
            crimeTol: 6,
        });
        data.data.System.map.set(KANIA, {
            ...getDefaultSystemData(), id: KANIA, name: 'Kania',
            position: [0, 0], links: [S7EVYN], govt: 'nova:128',
        });
        data.data.System.map.set(S7EVYN, {
            ...getDefaultSystemData(), id: S7EVYN, name: 'S7evyn',
            position: [100, 0], links: [KANIA], visibility: 'b9995',
            govt: 'nova:128',
        });
        return data;
    }

    /** A map whose plugin-side bit lookup comes up EMPTY, exactly as it
     * does while docked (the player's ship is out of the display world).
     * The plugin-side legal-record lookup is the in-flight one. */
    async function dockedMap(
        getLegalRecords: () => Map<string, number> | undefined =
            () => undefined) {
        const controlEvents = new Subject<ControlEvent>();
        const starmap = new Starmap(displayAssets(),
            gameData() as unknown as SimulationGameDataInterface, KANIA,
            controlEvents, () => new Set(), undefined, undefined, undefined,
            undefined, getLegalRecords);
        await starmap.buildPromise;
        return starmap;
    }

    /** The text of the properties column's lines, in draw order. */
    function propertyLines(starmap: Starmap): string[] {
        const container = (starmap as unknown as {
            propContainer: PIXI.Container,
        }).propContainer;
        return container.children
            .filter((c): c is PIXI.Text => c instanceof PIXI.Text)
            .map(t => t.text);
    }

    /** Whether the built graph has the system at all (hidden systems are
     * dropped from it — not drawn, linked, or routed through). */
    function shows(starmap: Starmap, systemId: string): boolean {
        const graph = (starmap as unknown as {
            systemGraph?: { hasSystem(id: string): boolean },
        }).systemGraph;
        return graph?.hasSystem(systemId) ?? false;
    }

    afterEach(() => {
        expect(MenuControls.focused).toBeUndefined();
    });

    it('filters against the bits the landed caller passes, not the '
        + 'plugin\'s empty fallback', async () => {
            const starmap = await dockedMap();
            starmap.openOptions = { playerBits: new Set([9995]) };
            const shown = starmap.show([]);
            await starmap.buildPromise;
            // Let show() reach its await on the player's Done.
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(shows(starmap, S7EVYN)).toBeTrue();
            expect(shows(starmap, KANIA)).toBeTrue();
            starmap.dismiss();
            await shown;
        });

    it('still uses the plugin\'s lookup when no bits are passed (in flight)',
        async () => {
            const starmap = await dockedMap();
            const shown = starmap.show([]);
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(shows(starmap, S7EVYN)).toBeFalse();
            starmap.dismiss();
            await shown;
        });

    // The Legal Status line reads the records the same way: the landed
    // caller's win over the plugin's lookup, judged through
    // legalStatusInSystem (record -30 is 5 Federation tolerances:
    // "Offender"; +30 is "Good Citizen").
    it('judges Legal Status by the records the landed caller passes',
        async () => {
            const starmap = await dockedMap(
                () => new Map([['nova:128', 30]]));
            starmap.openOptions = {
                legalRecords: new Map([['nova:128', -30]]),
            };
            const shown = starmap.show([]);
            await new Promise(resolve => setTimeout(resolve, 0));
            const lines = propertyLines(starmap);
            expect(lines[lines.indexOf('Legal Status:') + 1])
                .toBe('Offender');
            starmap.dismiss();
            await shown;
        });

    it('judges Legal Status by the plugin\'s records when none are passed',
        async () => {
            const starmap = await dockedMap(
                () => new Map([['nova:128', 30]]));
            const shown = starmap.show([]);
            await new Promise(resolve => setTimeout(resolve, 0));
            const lines = propertyLines(starmap);
            expect(lines[lines.indexOf('Legal Status:') + 1])
                .toBe('Good Citizen');
            starmap.dismiss();
            await shown;
        });
});
