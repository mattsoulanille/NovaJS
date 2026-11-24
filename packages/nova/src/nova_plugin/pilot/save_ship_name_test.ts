import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { startingPlayerNames } from '../../client/player_start.js';
import { PlayerNamesComponent } from '../player/index.js';
import { ShipComponent } from '../ship/index.js';
import {
    decodeSave, encodeSave, extractSaveData, restorePlayerState, SaveData,
} from './save_game.js';

/**
 * The ship's name in the save (SaveData `shipName`, player_names.ts): it
 * survives a save and a load, an old save without one reads as the
 * derived "<type> <number>", and a save file's name is cleaned like a
 * typed one.
 */
describe('the ship name in the save', () => {
    function pilot(names?: { pilot?: string, ship?: string }): Entity {
        const entity = new Entity()
            .addComponent(ShipComponent, { id: 'nova:128' });
        if (names) {
            entity.components.set(PlayerNamesComponent, names);
        }
        return entity;
    }

    function reload(save: SaveData): Entity {
        const decoded = decodeSave(encodeSave(save));
        expect(decoded).toBeDefined();
        const entity = new Entity()
            .addComponent(ShipComponent, { id: decoded!.ship });
        restorePlayerState(entity, decoded!);
        return entity;
    }

    it('writes the stored name and restores it on load', () => {
        const save = extractSaveData(
            pilot({ pilot: 'Matt', ship: 'Rocinante' }), 'nova:130')!;
        expect(save.shipName).toBe('Rocinante');
        const restored = reload(save);
        expect(restored.components.get(PlayerNamesComponent)?.ship)
            .toBe('Rocinante');
        // The session start keeps the saved name over the derived one, and
        // takes the pilot's name from the profile.
        expect(startingPlayerNames(
            restored.components.get(PlayerNamesComponent), 'Matt',
            'Shuttle', 552))
            .toEqual({ ship: 'Rocinante', pilot: 'Matt' });
    });

    it('reads a save without a name (written before ship names) as the '
        + 'derived "<type> <number>"', () => {
        const save = extractSaveData(pilot(), 'nova:130')!;
        expect(save.shipName).toBeUndefined();
        expect('shipName' in JSON.parse(encodeSave(save)).data).toBeFalse();
        const restored = reload(save);
        expect(restored.components.get(PlayerNamesComponent)?.ship)
            .toBeUndefined();
        expect(startingPlayerNames(
            restored.components.get(PlayerNamesComponent), 'Matt',
            'Shuttle', 552))
            .toEqual({ ship: 'Shuttle 552', pilot: 'Matt' });
    });

    it('leaves the pilot name out when the profile has none', () => {
        expect(startingPlayerNames(undefined, undefined, 'Shuttle', undefined))
            .toEqual({ ship: 'Shuttle 1' });
        expect(startingPlayerNames(undefined, '  ', 'Shuttle', 7))
            .toEqual({ ship: 'Shuttle 7' });
    });

    it('cleans a name a save file carries (controls, length)', () => {
        const save = extractSaveData(pilot(), 'nova:130')!;
        save.shipName = `Long\n${'z'.repeat(60)}`;
        const restored = reload(save);
        const name = restored.components.get(PlayerNamesComponent)?.ship;
        expect(name).toBe(`Long${'z'.repeat(27)}`);
        // A name that cleans to nothing is no name at all.
        save.shipName = '\t\n';
        expect(reload(save).components.get(PlayerNamesComponent)?.ship)
            .toBeUndefined();
    });

    it('does not write a name that cleans to nothing', () => {
        expect(extractSaveData(pilot({ ship: '\u0007' }), 'nova:130')!
            .shipName).toBeUndefined();
    });
});
