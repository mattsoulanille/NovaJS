import 'jasmine';
import { SystemData } from 'novadatainterface/system_data';
import { getPluginGameData } from '../communication/simulation_test_fixture.js';
import { GameDataAggregator } from '../server/parsing/game_data_aggregator.js';
import { evaluateNCBTest } from './ncb.js';

/**
 * A plug-in resource whose id collides with an existing one REPLACES it:
 * "Any resources in an Nova plugin file automatically replace same-numbered
 * resources in Nova's main files. Resources are loaded from the 'Nova Files'
 * folder first and then resources from the 'Nova Plug-Ins' folder are
 * loaded." (EVN Bible, Part II.) Within the Plug-ins folder that rule is
 * positional too — the LAST plug-in loaded wins, and plug-ins load in
 * ascending name order (the original engine's own pilot-log "Plugins
 * loaded:" list comes out that way, and the community naming conventions
 * that patch one plug-in with another, "ARPIATweaks.rez" over "ARPIA2 -
 * Data 1.rez", only work if it does).
 *
 * The regression these specs pin: NovaParse used to load the Plug-ins
 * folder in REVERSE name order, so "arpia" — which overrides stock sÿst 144
 * (Spica) to gate it behind its own control bit — clobbered Extra Outfits'
 * override of the same sÿst, and Extra Outfits' extra stellar silently
 * vanished from Spica whenever both were installed.
 */
describe('plug-in overrides of stock resources', () => {
    const ARPIA = 'arpia';
    const EXTRA = 'extra-outfits';
    /** Stock sÿst 144, Spica: the id both plug-ins redefine. */
    const SPICA = 'nova:144';

    /** A system's Visibility test against a player's control bits. */
    function visible(system: SystemData, bits: ReadonlySet<number> = new Set()) {
        return evaluateNCBTest(system.visibility,
            { getBit: bit => bits.has(bit) });
    }

    /** Every system sharing `system`'s map coordinates, itself included. */
    async function systemsAtSameSpot(gameData: GameDataAggregator,
        system: SystemData): Promise<SystemData[]> {
        const ids = await gameData.ids;
        const all = await Promise.all(
            [...ids.System].sort().map(id => gameData.data.System.get(id)));
        return all.filter(other =>
            other.position[0] === system.position[0]
            && other.position[1] === system.position[1]);
    }

    async function planetNames(gameData: GameDataAggregator,
        system: SystemData): Promise<string[]> {
        return Promise.all(system.planets.map(
            async id => (await gameData.data.Planet.get(id)).name));
    }

    it('keeps a single plug-in\'s override of the stock system, under the '
        + 'stock id', async () => {
            const gameData = await getPluginGameData(EXTRA);
            if (!gameData) {
                pending('Extra Outfits plug-in not installed');
                return;
            }
            // The override lives at the STOCK global id — that is what
            // "replaces the same-numbered resource" means — and carries the
            // plug-in's own extra stellar.
            const spica = await gameData.data.System.get(SPICA);
            expect(spica.name).toBe('Spica');
            expect(await planetNames(gameData, spica))
                .toEqual(['Spica', 'Spica Shipyard', 'Wormhole']);
            expect(spica.planets[1].startsWith(`${EXTRA}:`)).toBeTrue();
        });

    it('gives the LATER-named plug-in the id when two of them override the '
        + 'same stock system', async () => {
            const gameData = await getPluginGameData([ARPIA, EXTRA]);
            if (!gameData) {
                pending('ARPIA and/or Extra Outfits plug-in not installed');
                return;
            }
            // "arpia" < "extra-outfits", so Extra Outfits loads second and
            // its sÿst 144 is the one that survives.
            const spica = await gameData.data.System.get(SPICA);
            expect(await planetNames(gameData, spica))
                .toEqual(['Spica', 'Spica Shipyard', 'Wormhole']);
        });

    it('puts the plug-in stellar in the Spica a default pilot arrives in',
        async () => {
            const gameData = await getPluginGameData([ARPIA, EXTRA]);
            if (!gameData) {
                pending('ARPIA and/or Extra Outfits plug-in not installed');
                return;
            }
            const spica = await gameData.data.System.get(SPICA);
            // Both plug-ins also stack extra copies of Spica on the same
            // map spot, swapped in by their own control bits (Extra
            // Outfits' bought Spica Shipyard system, ARPIA's "Spica;GM").
            // With a fresh pilot's bits — none set — exactly one of the
            // stack exists, and it is the stock-id one.
            const stack = await systemsAtSameSpot(gameData, spica);
            expect(stack.length).toBeGreaterThan(1);
            const shown = stack.filter(system => visible(system));
            expect(shown.map(system => system.id)).toEqual([SPICA]);
            expect(await planetNames(gameData, shown[0]))
                .toContain('Spica Shipyard');
        });
});
