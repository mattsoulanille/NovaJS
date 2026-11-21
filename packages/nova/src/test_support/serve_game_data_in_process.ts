import fs from 'fs';
import path from 'path';
import { GameDataInterface } from 'novadatainterface/game_data_interface';
import {
    batchPath, controlBitNamespacesPath, idsPath, settingsPrefix,
} from '../common/game_data_paths.js';
import { SYNTHETIC_DATA_ROOT } from '../communication/simulation_test_fixture.js';
import { BatchRequest, resolveBatch } from '../server/setup_routes.js';

/**
 * A `fetch` that answers the game-data routes a SimulationGameData asks
 * for straight from `gameData`, the way the server's routes would
 * (the round-trip specs of #368 and #369 meter it).
 */
export function serveInProcess(gameData: GameDataInterface): typeof fetch {
    const json = (value: unknown) => new Response(JSON.stringify(value),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    return (async (input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1]) => {
        const url = String(input);
        if (url === batchPath) {
            return json(await resolveBatch(gameData,
                JSON.parse(String(init?.body)) as BatchRequest));
        }
        if (url === idsPath + '.json') {
            return json(await gameData.ids);
        }
        if (url === '/preloadData.json') {
            return json(await gameData.preloadData ?? {});
        }
        if (url.startsWith(settingsPrefix)) {
            // packages/nova/settings, beside test_fixtures/.
            return json(JSON.parse(fs.readFileSync(path.join(SYNTHETIC_DATA_ROOT,
                '..', '..', 'settings', url.slice(settingsPrefix.length)), 'utf8')));
        }
        if (url === controlBitNamespacesPath + '.json'
            && gameData.controlBitNamespaces) {
            return json(await gameData.controlBitNamespaces);
        }
        return new Response('not found', { status: 404 });
    }) as typeof fetch;
}
