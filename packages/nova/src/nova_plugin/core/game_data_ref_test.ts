import 'jasmine';
import { ExplosionData } from 'novadatainterface/explosion_data';
import { Gettable } from 'novadatainterface/gettable';
import { NovaIDNotFoundError } from 'novadatainterface/nova_id_not_found_error';
import { ShipData } from 'novadatainterface/ship_data';
import { DisplayAssetDataInterface } from '../../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../../client/gamedata/simulation_game_data.js';
import { stageSimulationFrameGameData } from '../../communication/apply_simulation_frame.js';
import { SimulationFrame } from '../../communication/simulation_frame.js';
import { stageGameDataRefs } from './game_data_ref.js';

/** A table holding exactly `ids`, each loaded on demand. */
function table<T>(ids: string[], make: (id: string) => T): Gettable<T> {
    return new Gettable<T>(async id => {
        if (!ids.includes(id)) {
            throw new NovaIDNotFoundError(`no ${id}`);
        }
        return make(id);
    });
}

describe('game data ref staging', () => {
    let ships: Gettable<ShipData>;
    let explosions: Gettable<ExplosionData>;
    let gameData: SimulationGameDataInterface;
    let displayAssets: DisplayAssetDataInterface;
    let warn: jasmine.Spy;

    beforeEach(() => {
        ships = table(['nova:128'], id => ({ id } as ShipData));
        explosions = table(['nova:128'], id => ({ id } as ExplosionData));
        gameData = { data: { Ship: ships } } as unknown as SimulationGameDataInterface;
        displayAssets = { data: { Explosion: explosions } } as unknown as DisplayAssetDataInterface;
        warn = spyOn(console, 'warn');
    });

    it('stages a frame\'s ExplosionData ref in the display\'s asset data, without a warning', async () => {
        const frame: SimulationFrame = {
            added: [['boom', { components: [['ExplosionData', { id: 'nova:128' }]] }]],
            changed: [['ship', { changed: [['ShipData', { id: 'nova:128' }]], removed: [] }]],
            removed: [], events: [],
        };
        expect(explosions.getCached('nova:128')).toBeUndefined();
        await stageSimulationFrameGameData(gameData, frame, displayAssets);
        // Staged where the display's decode resolves it (game_data_ref.ts
        // tableOf: DisplayAssetDataResource.data.Explosion).
        expect(explosions.getCached('nova:128')?.id).toBe('nova:128');
        expect(ships.getCached('nova:128')?.id).toBe('nova:128');
        expect(warn).not.toHaveBeenCalled();
    });

    it('leaves an ExplosionData ref to the decode on a receiver without the display\'s asset data, without a warning', async () => {
        // The simulation's game data has no Explosion table, and a
        // simulation world has no DisplayAssetDataResource to resolve
        // the ref in either: the decode reports it, staging does not.
        await stageGameDataRefs(gameData, new Map([
            ['Explosion', new Set(['nova:128'])],
            ['Ship', new Set(['nova:128'])],
        ]));
        expect(ships.getCached('nova:128')?.id).toBe('nova:128');
        expect(warn).not.toHaveBeenCalled();
    });

    it('reports and skips an id the table does not have', async () => {
        await stageGameDataRefs(gameData, new Map([
            ['Explosion', new Set(['nova:999'])],
        ]), displayAssets);
        expect(explosions.isMissing('nova:999')).toBeTrue();
        expect(warn).toHaveBeenCalledWith(jasmine.stringMatching(/Skipping Explosion nova:999/));
    });
});
