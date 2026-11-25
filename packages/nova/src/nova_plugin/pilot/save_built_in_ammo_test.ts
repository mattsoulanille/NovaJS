import 'jasmine';
import { getDefaultOutfitData, OutfitData } from 'novadatainterface/outfit_data';
import {
    getDefaultShipData, getDefaultShipPhysics, ShipData,
} from 'novadatainterface/ship_data';
import {
    getDefaultProjectileWeaponData, WeaponData,
} from 'novadatainterface/weapon_data';
import {
    BuiltInAmmoLookups, normaliseBuiltInAmmo,
} from './save_built_in_ammo.js';
import { SaveData } from './save_game.js';
import { saveDefaults } from './save_migrations.js';

/**
 * Saves written while novaparse keyed a built-in weapon's stock ammo by
 * the weapon itself rather than by its AmmoType supply: stock's Raven
 * Turret (wëap 139, drawing on the Raven Rocket 138's supply) came with
 * `nova:139:builtInAmmo` instead of oütf 143 "Raven Rocket". On load the
 * magazine becomes the real oütf, capped like a purchase.
 */
describe('normaliseBuiltInAmmo', () => {
    function weapon(id: string, over: Partial<WeaponData> = {}): WeaponData {
        return {
            ...getDefaultProjectileWeaponData(), id, ...over,
        } as WeaponData;
    }
    function outfit(id: string, over: Partial<OutfitData> = {}): OutfitData {
        return { ...getDefaultOutfitData(), id, ...over };
    }

    const weapons = new Map<string, WeaponData>([
        // Raven Turret draws on the Raven Rocket's supply.
        ['nova:139', weapon('nova:139', { ammoType: ['weapon', 'nova:138'] })],
        ['nova:138', weapon('nova:138', { ammoType: ['weapon', 'nova:138'] })],
        // Radar Missile (234) draws on 135, fed by three oütfs.
        ['nova:234', weapon('nova:234', { ammoType: ['weapon', 'nova:135'] })],
        ['nova:135', weapon('nova:135', { ammoType: ['weapon', 'nova:135'] })],
        // A plug-in's NPC weapon whose supply no oütf feeds.
        ['p:300', weapon('p:300', { ammoType: ['weapon', 'p:300'] })],
        // A supply that caps by launcher (MaxAmmo 10 per launcher).
        ['p:310', weapon('p:310', { ammoType: ['weapon', 'p:311'] })],
        ['p:311', weapon('p:311', {
            ammoType: ['weapon', 'p:311'], maxAmmo: 10,
        })],
    ]);
    const outfits = new Map<string, OutfitData>([
        ['nova:143', outfit('nova:143', { ammoFor: 'nova:138', max: 300 })],
        ['nova:144', outfit('nova:144', { weapons: { 'nova:139': 1 } })],
        ['nova:137', outfit('nova:137', { ammoFor: 'nova:135', max: 150 })],
        ['nova:327', outfit('nova:327', { ammoFor: 'nova:135', max: 150 })],
        ['nova:330', outfit('nova:330', { ammoFor: 'nova:135', max: 150 })],
        ['p:312', outfit('p:312', { ammoFor: 'p:311', max: 0 })],
        ['p:313', outfit('p:313', { weapons: { 'p:311': 1 } })],
        ['nova:128', outfit('nova:128')],
        // A one-ton round for a launcher-less supply (p:320).
        ['p:322', outfit('p:322', { ammoFor: 'p:320', max: 32000,
            physics: { freeMass: 1 } })],
    ]);
    weapons.set('p:320', weapon('p:320', { ammoType: ['weapon', 'p:320'] }));
    weapons.set('p:321', weapon('p:321', { ammoType: ['weapon', 'p:320'] }));
    // 'p:500' has 10 tons free. The saves below fly nova:249, which is not
    // in this table, so they are not mass-gated.
    const ships = new Map<string, ShipData>([
        ['p:500', {
            ...getDefaultShipData(), id: 'p:500',
            physics: { ...getDefaultShipPhysics(), mass: 50, freeMass: 10 },
        }],
    ]);
    const lookups: BuiltInAmmoLookups = {
        outfitIds: ['nova:128', 'nova:137', 'nova:143', 'nova:144',
            'nova:327', 'nova:330', 'p:312', 'p:313', 'p:322'],
        async getOutfit(id) {
            return outfits.get(id) ?? (id.endsWith(':builtInAmmo')
                ? outfit(id, { ammoFor: 'x' }) : undefined);
        },
        async getWeapon(id) { return weapons.get(id); },
        async getShip(id) { return ships.get(id); },
    };

    function save(owned: [string, number][],
        storedShips: SaveData['storedShips'] = []): SaveData {
        return {
            ...saveDefaults(), ship: 'nova:249', system: 'nova:130',
            outfits: owned, storedShips,
        } as SaveData;
    }

    it('turns the Raven Turret\'s magazine into Raven Rockets, in place',
        async () => {
            const result = await normaliseBuiltInAmmo(save([
                ['nova:144', 6], ['nova:139:builtInAmmo', 60], ['nova:128', 1],
            ]), lookups);
            expect(result.outfits).toEqual([
                ['nova:144', 6], ['nova:143', 60], ['nova:128', 1],
            ]);
        });

    it('adds to rockets already owned, up to the oütf\'s Max', async () => {
        const result = await normaliseBuiltInAmmo(save([
            ['nova:143', 280], ['nova:139:builtInAmmo', 60],
        ]), lookups);
        expect(result.outfits).toEqual([['nova:143', 300]]);
    });

    it('never takes away rounds already owned over the Max', async () => {
        const result = await normaliseBuiltInAmmo(save([
            ['nova:143', 320], ['nova:139:builtInAmmo', 60],
        ]), lookups);
        expect(result.outfits).toEqual([['nova:143', 320]]);
    });

    it('picks the oütf the parser loads when several feed the supply',
        async () => {
            const result = await normaliseBuiltInAmmo(save([
                ['nova:234:builtInAmmo', 30],
            ]), lookups);
            expect(result.outfits).toEqual([['nova:137', 30]]);
        });

    it('caps by the launchers when the supply sets MaxAmmo', async () => {
        const result = await normaliseBuiltInAmmo(save([
            ['p:313', 2], ['p:310:builtInAmmo', 50],
        ]), lookups);
        expect(result.outfits).toEqual([['p:313', 2], ['p:312', 20]]);
    });

    it('caps by the hull\'s free mass, as a purchase does', async () => {
        // The implicit magazine weighed nothing; 30 one-ton rounds do not
        // fit a hull with 10 tons free (Max 32000 would allow them).
        const result = await normaliseBuiltInAmmo({
            ...save([['p:321:builtInAmmo', 30]]), ship: 'p:500',
        } as SaveData, lookups);
        expect(result.outfits).toEqual([['p:322', 10]]);
    });

    it('keeps a magazine whose supply no oütf feeds', async () => {
        const original = save([['p:300:builtInAmmo', 10]]);
        expect(await normaliseBuiltInAmmo(original, lookups))
            .toBe(original);
    });

    it('keeps a magazine whose weapon is not installed', async () => {
        const original = save([['gone:200:builtInAmmo', 10]]);
        expect(await normaliseBuiltInAmmo(original, lookups))
            .toBe(original);
    });

    it('returns a save without magazines untouched', async () => {
        const original = save([['nova:143', 10]]);
        expect(await normaliseBuiltInAmmo(original, lookups))
            .toBe(original);
    });

    it('repairs the stored ships too', async () => {
        const stored = {
            ship: 'nova:140', name: 'IDA Frigate', cargo: [], fuel: 300,
            storedAt: 'nova:128',
            outfits: [['nova:139:builtInAmmo', 30], ['nova:144', 2]] as
                [string, number][],
        };
        const untouched = { ...stored, outfits: [['nova:128', 1]] as
            [string, number][] };
        const result = await normaliseBuiltInAmmo(
            save([['nova:128', 1]], [stored, untouched]), lookups);
        expect(result.outfits).toEqual([['nova:128', 1]]);
        expect(result.storedShips[0].outfits)
            .toEqual([['nova:143', 30], ['nova:144', 2]]);
        expect(result.storedShips[0].name).toBe('IDA Frigate');
        expect(result.storedShips[1]).toBe(untouched);
    });
});
