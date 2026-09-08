import 'jasmine';
import { NovaIDNotFoundError } from 'novadatainterface/nova_id_not_found_error';
import { SimulationGameDataInterface } from '../../client/gamedata/simulation_game_data.js';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import {
    getSyntheticGameData, makeSyntheticGameData,
} from '../../communication/simulation_test_fixture.js';
import { loadAsteroidGameData } from '../combat/asteroid_plugin.js';
import {
    completeEntity, loadEntityGameData, loadShipGameData, loadWeaponGameData,
    loadWeaponsGameData,
} from './entity_data_loader.js';
import { WeaponEntries } from '../combat/fire_weapon_plugin.js';
import { HitboxHullComponent } from '../core/collisions_plugin.js';
import { BayFighterComponent } from '../escorts/bay_plugin.js';
import { makeShip } from '../ship/make_ship.js';
import { makeSystem } from '../make_system.js';
import { OutfitsStateComponent } from '../ship/outfit_plugin.js';

function fakeGettable<T>(items: Record<string, T>) {
    return {
        get: async (id: string) => items[id],
        getCached: (id: string) => items[id],
    };
}

const ANIMATION = { images: { baseImage: { id: 'sheet' } } };

function bayShip(bayWeapon: string) {
    return {
        animation: ANIMATION,
        outfits: { [`outfit ${bayWeapon}`]: 1 },
    };
}

/**
 * Three ships whose bays carry each other in a cycle (A carries B,
 * B carries C, C carries A), plus a pair of weapons whose submunitions
 * are mutually recursive. Loading must terminate.
 */
function makeCyclicGameData(): SimulationGameDataInterface {
    return {
        data: {
            Ship: fakeGettable({
                A: {
                    animation: ANIMATION,
                    outfits: { 'outfit bay B': 1, 'outfit subX': 1 },
                },
                B: bayShip('bay C'),
                C: bayShip('bay A'),
            }),
            Outfit: fakeGettable({
                'outfit bay B': { weapons: { 'bay B': 1 } },
                'outfit bay C': { weapons: { 'bay C': 1 } },
                'outfit bay A': { weapons: { 'bay A': 1 } },
                'outfit subX': { weapons: { 'subX': 1 } },
            }),
            Weapon: fakeGettable({
                'bay A': { type: 'BayWeaponData', shipID: 'A' },
                'bay B': { type: 'BayWeaponData', shipID: 'B' },
                'bay C': { type: 'BayWeaponData', shipID: 'C' },
                subX: {
                    type: 'ProjectileWeaponData',
                    animation: ANIMATION,
                    submunitions: [{ id: 'subY' }],
                },
                subY: {
                    type: 'ProjectileWeaponData',
                    animation: ANIMATION,
                    submunitions: [{ id: 'subX' }],
                },
            }),
            SpriteSheet: fakeGettable({ sheet: { hulls: [] } }),
        },
    } as never;
}

/** Like fakeGettable, but an unknown id rejects as the real data does. */
function strictGettable<T>(items: Record<string, T>) {
    return {
        get: async (id: string) => {
            if (!(id in items)) {
                throw new NovaIDNotFoundError(`no ${id}`);
            }
            return items[id];
        },
        getCached: (id: string) => items[id],
    };
}

/**
 * A ship whose stock outfit names a weapon the data set does not define
 * (as the "Advanced Vell-os Beams" plug-in's ships do), plus an outfit
 * that does not exist at all.
 */
function makeDanglingGameData(): SimulationGameDataInterface {
    return {
        data: {
            Ship: strictGettable({
                A: {
                    animation: ANIMATION,
                    outfits: { 'outfit real': 1, 'outfit ghost': 1, 'outfit missing': 1 },
                },
            }),
            Outfit: strictGettable({
                'outfit real': { weapons: { 'real': 1 } },
                'outfit ghost': { weapons: { 'ghost': 1, 'real': 1 } },
            }),
            Weapon: strictGettable({
                real: { type: 'ProjectileWeaponData', animation: ANIMATION, submunitions: [] },
            }),
            SpriteSheet: strictGettable({ sheet: { hulls: [] } }),
        },
    } as never;
}

describe('entity data loader', () => {
    it('skips outfits and weapons the data set does not define, with a warning', async () => {
        // A dangling reference used to resolve to a placeholder default
        // weapon; it now rejects as not-found, and staging must skip it
        // rather than fail the whole ship.
        const warn = spyOn(console, 'warn');
        const weaponIds = await loadShipGameData(makeDanglingGameData(), 'A');
        expect(weaponIds.has('real')).toBeTrue();
        const warned = warn.calls.allArgs().map(args => args.join(' ')).join('\n');
        expect(warned).toContain('ghost');
        expect(warned).toContain('outfit missing');
    });

    it('still rejects when the ship itself does not exist', async () => {
        await expectAsync(loadShipGameData(makeDanglingGameData(), 'nope'))
            .toBeRejectedWithError(NovaIDNotFoundError);
    });

    it('terminates on mutually recursive carried ships', async () => {
        const weaponIds = await loadShipGameData(makeCyclicGameData(), 'A');
        expect([...weaponIds].sort()).toEqual(['bay A', 'bay B', 'bay C', 'subX', 'subY']);
    }, 5_000);

    it('terminates on mutually recursive submunitions', async () => {
        const weaponIds = await loadWeaponGameData(makeCyclicGameData(), 'subX');
        expect([...weaponIds].sort()).toEqual(['subX', 'subY']);
    }, 5_000);

    it('retries transient asteroid data load failures', async () => {
        // One flaky fetch must not leave this world's cache cold: a
        // cold asteroid type spawns different fields than every other
        // world (see Gettable.getCached's determinism warning).
        const base = makeCyclicGameData() as { data: Record<string, unknown> };
        let failures = 2;
        const flaky = {
            data: {
                ...base.data,
                Asteroid: {
                    get: async () => {
                        if (failures > 0) {
                            failures--;
                            throw new Error('synthetic fetch failure');
                        }
                        return { animation: ANIMATION, fragments: [] };
                    },
                },
            },
        } as never;
        await loadAsteroidGameData(flaky, 'rock');
        expect(failures).toBe(0);
    }, 30_000);

    it('throws when asteroid data stays unloadable', async () => {
        const base = makeCyclicGameData() as { data: Record<string, unknown> };
        const dead = {
            data: {
                ...base.data,
                Asteroid: {
                    get: async () => {
                        throw new Error('synthetic outage');
                    },
                },
            },
        } as never;
        await expectAsync(loadAsteroidGameData(dead, 'rock')).toBeRejected();
    }, 30_000);

    it('stages weapons granted by the entity\'s own outfits, not just '
        + 'the ship class\'s stock loadout', async () => {
        // On the synthetic data set: the Wren Skiff's stock loadout is a
        // blaster, and the Harrier Launcher is the purchasable outfit
        // granting a projectile weapon it lacks.
        const gameData = await getSyntheticGameData();
        const ids = await gameData.ids;
        const systemId = [...ids.System].sort()[0]!;
        const shipData = await gameData.data.Ship.get([...ids.Ship].sort()[0]!);

        // The ship class's stock weapons, which staging always covered.
        const stockWeapons = new Set<string>();
        for (const outfitId of Object.keys(shipData.outfits)) {
            const outfit = await gameData.data.Outfit.get(outfitId);
            for (const weaponId of Object.keys(outfit?.weapons ?? {})) {
                stockWeapons.add(weaponId);
            }
        }

        // A purchasable outfit granting a projectile weapon the stock
        // loadout lacks — the shape of every player ship with
        // outfitter purchases (the second real recorded desync: the
        // purchased weapon staged only on the buying peer's world).
        let outfitId: string | undefined;
        let weaponId: string | undefined;
        for (const id of [...ids.Outfit].sort()) {
            const outfit = await gameData.data.Outfit.get(id);
            for (const wid of Object.keys(outfit?.weapons ?? {})) {
                if (stockWeapons.has(wid)) {
                    continue;
                }
                const weapon = await gameData.data.Weapon.get(wid);
                if (weapon?.type === 'ProjectileWeaponData') {
                    outfitId = id;
                    weaponId = wid;
                    break;
                }
            }
            if (outfitId) {
                break;
            }
        }
        expect(outfitId).withContext(
            'game data has no non-stock weapon outfit to test with')
            .toBeDefined();

        // A world that never staged this entity has a cold entry —
        // the control that makes the warm assertion meaningful.
        const coldWorld = await makeSystem(systemId, gameData, 'node', { npcs: false });
        expect(coldWorld.resources.get(WeaponEntries)!.getCached(weaponId!))
            .toBeUndefined();

        const world = await makeSystem(systemId, gameData, 'node', { npcs: false });
        const ship = makeShip(shipData);
        ship.components.set(OutfitsStateComponent,
            new Map([[outfitId!, { count: 1 }]]));
        await loadEntityGameData(world, ship);
        expect(world.resources.get(WeaponEntries)!.getCached(weaponId!))
            .withContext(`weapon ${weaponId} of outfit ${outfitId} must be `
                + 'staged synchronously-fireable on every world applying '
                + 'the insertion')
            .toBeDefined();
    }, 120_000);

    it('loadWeaponsGameData stages a bay no entity carries: its fighter\'s '
        + 'hull attaches on the launch tick (#240)', async () => {
        // A FRESH aggregator: the memoized one is warmed by whatever
        // spec ran before, which is the very thing #240 was about.
        const gameData = makeSyntheticGameData();
        const world = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            'node', { npcs: false });
        const skiff = await gameData.data.Ship.get(SYNTHETIC.ships.skiff);
        const skiffSheet = skiff.animation.images.baseImage.id;
        // The carrier is a Corsair — no bay in its loadout, and a
        // sprite sheet of its own — so staging it stages nothing about
        // the Skiff Bay or the Skiff hull its fighters need.
        const carrier = makeShip(
            await gameData.data.Ship.get(SYNTHETIC.ships.corsair));
        carrier.components.set(MultiplayerData, { owner: 'server' });
        await completeEntity(world, carrier);
        world.entities.set('carrier', carrier);
        const weaponEntries = world.resources.get(WeaponEntries)!;
        expect(weaponEntries.getCached(SYNTHETIC.weapons.skiffBay))
            .withContext('control: the bay entry is cold').toBeUndefined();
        expect(gameData.data.SpriteSheet.getCached(skiffSheet))
            .withContext('control: the fighter\'s sprite sheet is cold')
            .toBeUndefined();

        await loadWeaponsGameData(world, [SYNTHETIC.weapons.skiffBay]);
        expect(weaponEntries.getCached(SYNTHETIC.weapons.skiffBay))
            .withContext('the entry is primed, fireable synchronously')
            .toBeDefined();
        expect(gameData.data.SpriteSheet.getCached(skiffSheet))
            .withContext('the fighter\'s hull sprite sheet is cached')
            .toBeDefined();

        // A tick for the carrier's own providers (a bay fires from its
        // carrier's animation exit points), then launch.
        world.step();
        const before = new Set(world.entities.keys());
        weaponEntries.getCached(SYNTHETIC.weapons.skiffBay)!
            .fireFromEntity('carrier', false);
        const fighter = [...world.entities].find(([uuid, entity]) =>
            !before.has(uuid) && entity.components.has(BayFighterComponent));
        expect(fighter).withContext('a fighter launched').toBeDefined();
        // One synchronous step, no event-loop turn: the hull must come
        // from the cache, never from a background load.
        world.step();
        expect(fighter![1].components.has(HitboxHullComponent))
            .withContext('the fighter is hittable on its first tick')
            .toBeTrue();
    }, 120_000);
});
