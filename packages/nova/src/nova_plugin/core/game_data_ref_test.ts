import 'jasmine';
import { Gettable } from 'novadatainterface/gettable';
import { NovaIDNotFoundError } from 'novadatainterface/nova_id_not_found_error';
import { ShipData } from 'novadatainterface/ship_data';
import { SimulationGameDataInterface } from '../../client/gamedata/simulation_game_data.js';
import { stageSimulationFrameGameData } from '../../communication/apply_simulation_frame.js';
import { SimulationFrame } from '../../communication/simulation_frame.js';
import { collectGameDataRefs, GAME_DATA_REF_COMPONENTS, stageGameDataRefs } from './game_data_ref.js';

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
    let gameData: SimulationGameDataInterface;
    let warn: jasmine.Spy;

    beforeEach(() => {
        ships = table(['nova:128'], id => ({ id } as ShipData));
        gameData = { data: { Ship: ships } } as unknown as SimulationGameDataInterface;
        warn = spyOn(console, 'warn');
    });

    it('stages a frame\'s references in the simulation\'s game data, without a warning', async () => {
        const frame: SimulationFrame = {
            added: [['npc', { components: [['ShipData', { id: 'nova:128' }]] }]],
            changed: [['ship', { changed: [['ShipData', { id: 'nova:128' }]], removed: [] }]],
            removed: [], events: [],
        };
        expect(ships.getCached('nova:128')).toBeUndefined();
        await stageSimulationFrameGameData(gameData, frame);
        expect(ships.getCached('nova:128')?.id).toBe('nova:128');
        expect(warn).not.toHaveBeenCalled();
    });

    it('ExplosionData is not a game-data reference: explosions are display-only (ruling #272)', () => {
        // Explosions are sound and graphics, made in the display world
        // (display/explosion_plugin.ts), which has no serializer; no
        // simulation entity carries ExplosionData, so nothing on the
        // wire refers to the display's Explosion table and staging has
        // no such table to load into. A component of that name, or an
        // Animation claiming an explosion owner, collects nothing.
        expect(GAME_DATA_REF_COMPONENTS.has('ExplosionData')).toBeFalse();
        expect([...GAME_DATA_REF_COMPONENTS.values()]).not.toContain('Explosion' as never);
        const refs = collectGameDataRefs([
            ['ExplosionData', { id: 'nova:128' }],
            ['AnimationComponent', { owner: 'explosion', id: 'nova:128' }],
            ['ShipData', { id: 'nova:128' }],
        ]);
        expect([...refs.keys()]).toEqual(['Ship']);
    });

    it('reports and skips an id the table does not have', async () => {
        await stageGameDataRefs(gameData, new Map([
            ['Ship', new Set(['nova:999'])],
        ]));
        expect(ships.isMissing('nova:999')).toBeTrue();
        expect(warn).toHaveBeenCalledWith(jasmine.stringMatching(/Skipping Ship nova:999/));
    });
});
