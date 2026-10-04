import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { GameDataAggregator } from '../../server/parsing/game_data_aggregator.js';
import { getPluginGameData } from '../../communication/simulation_test_fixture.js';
import { novaDataInstalled, requireNovaData } from '../../test_support/nova_data_gate.js';
import { ActiveRanksComponent, ControlBitResolver } from '../ncb/index.js';
import { CronStatesComponent } from '../player/index.js';
import {
    assertSaveContentInstalled, decodeSaveDetailed, restorePlayerState,
    saveDefaults,
} from './index.js';
import { PLUGIN_PREFIX_RENAMES } from './save_migrations.js';

/**
 * ============================================================================
 * The #310 prefix transition against the REAL Plug-ins directory
 * ============================================================================
 *
 * The one installed plug-in whose prefix #310 changed is the extensionless
 * file `HypergatePassv1.0`: keyed `HypergatePassv1` by the old first-dot
 * rule, `HypergatePassv1.0` now. Its own ids are oütf 447, crön 386-388
 * and ränk 159-162, and it has one private control bit, b918. A v4 save
 * written before #310 names all of them under the old prefix; the v4 -> v5
 * migration (save_migrations.ts) must bring it to what the server serves.
 * Pends without the data, or without that plug-in.
 */
describe('the #310 prefix transition against the installed plug-in', () => {
    const DIR = 'HypergatePassv1.0';
    const OLD = 'HypergatePassv1';
    let gameData: GameDataAggregator | undefined;

    beforeEach(requireNovaData);
    beforeAll(async () => {
        if (!novaDataInstalled()) return; // each spec pends instead
        gameData = await getPluginGameData(DIR);
    });

    it('serves the plug-in under its full-base-name prefix, which the '
        + 'transition table maps the old one to', async () => {
            if (!gameData) {
                pending(`Plug-in ${DIR} not installed`);
                return;
            }
            const namespaces = await gameData.controlBitNamespaces;
            expect(namespaces.pluginOrder).toContain(DIR);
            expect(namespaces.pluginOrder).not.toContain(OLD);
            const ids = await gameData.ids;
            expect(ids.Outfit).toContain(`${DIR}:447`);
            expect(PLUGIN_PREFIX_RENAMES.get(OLD)).toBe(DIR);
        });

    it('migrates and loads a v4 save naming the old prefix', async () => {
        if (!gameData) {
            pending(`Plug-in ${DIR} not installed`);
            return;
        }
        const ids = await gameData.ids;
        const resolver = new ControlBitResolver(
            await gameData.controlBitNamespaces);
        const cron = { phase: 'idle', phaseStart: 0, nextEligible: 0 };
        const v4 = {
            version: 4,
            data: {
                ...saveDefaults(),
                ship: 'nova:128', system: 'nova:130',
                outfits: [[`${OLD}:447`, 1]],
                ranks: [`${OLD}:159`, `${OLD}:160`, `${OLD}:161`, `${OLD}:162`],
                cronStates: [[`${OLD}:386`, cron], [`${OLD}:387`, cron],
                    [`${OLD}:388`, cron]],
                controlBits: [[OLD, 918]],
                plugins: [OLD],
            },
        };
        const result = decodeSaveDetailed(JSON.stringify(v4));
        expect(result.ok).toBeTrue();
        if (!result.ok) {
            return;
        }
        const save = result.data;
        // Not quarantined by the #131 check.
        expect(() => assertSaveContentInstalled(save, ids)).not.toThrow();
        for (const rank of save.ranks) {
            expect(ids.Rank).toContain(rank);
        }
        for (const [cronId] of save.cronStates) {
            expect(ids.Cron).toContain(cronId);
        }
        expect(save.plugins).toEqual([...resolver.pluginOrder]);

        // The control bit lands on the plug-in's physical bit, not parked.
        const entity = new Entity('restored');
        const { parkedControlBits } = restorePlayerState(entity, save, resolver);
        expect(parkedControlBits).toEqual([]);
        expect(resolver.physicalBit([DIR, 918])).toBeDefined();
        expect(entity.components.get(CronStatesComponent)?.size).toBe(3);
        expect([...entity.components.get(ActiveRanksComponent) ?? []])
            .toEqual(save.ranks);
    });
});
