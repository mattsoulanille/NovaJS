import 'jasmine';
import {
    builtInAmmoOutfitId, builtInWeaponOutfitId,
} from 'novaparse/built_in_weapon_outfit';
import {
    describeMissingSaveContent, missingSaveContent, SaveContentIds,
} from './save_content.js';
import { SaveData } from './save_game.js';
import { saveDefaults } from './save_migrations.js';

/**
 * A save owning an IMPLICIT outfit (novaparse's built_in_weapon_outfit.ts:
 * the zero-price item that mounts or feeds a ship's built-in weapon when
 * no oütf does). Those ids are deliberately absent from NovaIDs.Outfit,
 * so checking them there quarantined every pilot flying such a ship
 * ("needs content that is not installed: stock ids the game data does
 * not define (outfit nova:161:builtInAmmo, ...)"). An implicit id exists
 * exactly when its weapon does.
 */
describe('missingSaveContent with implicit built-in outfits', () => {
    function save(outfits: [string, number][]): SaveData {
        return {
            ...saveDefaults(), ship: 'nova:128', system: 'nova:130',
            outfits,
        } as SaveData;
    }

    const stock: SaveContentIds = {
        Ship: ['nova:128'],
        Outfit: ['nova:128'],
        Weapon: ['nova:139', 'nova:161'],
    };

    it('accepts a built-in ammo and weapon outfit whose weapon is defined',
        () => {
            expect(missingSaveContent(save([
                ['nova:128', 1],
                [builtInAmmoOutfitId('nova:161'), 40],
                [builtInWeaponOutfitId('nova:139'), 1],
                [builtInAmmoOutfitId('nova:139'), 12],
            ]), stock)).toEqual([]);
        });

    it('reports one whose weapon is not defined, under its outfit id', () => {
        const missing = missingSaveContent(save([
            [builtInAmmoOutfitId('nova:161'), 40],
            [builtInAmmoOutfitId('nova:999'), 4],
            [builtInWeaponOutfitId('gone:130'), 1],
        ]), stock);
        expect(missing).toEqual([
            { kind: 'outfit', id: 'nova:999:builtInAmmo' },
            { kind: 'outfit', id: 'gone:130:builtInWeapon' },
        ]);
        expect(describeMissingSaveContent(missing)).toBe(
            'needs content that is not installed: stock ids the game data '
            + 'does not define (outfit nova:999:builtInAmmo); the plug-in '
            + '"gone" (outfit gone:130:builtInWeapon)');
    });

    it('keeps the #310 rename hint for a renamed plug-in\'s built-in weapon',
        () => {
            // A plug-in installed as "X 1.0" whose only content the save
            // names is the implicit outfit of one of its weapons.
            expect(missingSaveContent(save([
                [builtInWeaponOutfitId('X 1:150'), 1],
            ]), { ...stock, Weapon: [...stock.Weapon, 'X 1.0:150'] }))
                .toEqual([{
                    kind: 'outfit', id: 'X 1:150:builtInWeapon',
                    renamedAs: ['X 1.0'],
                }]);
        });
});
