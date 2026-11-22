/**
 * ============================================================================
 * Per-system resource lists (#370), derived on the server
 * ============================================================================
 *
 * What a client entering a system will need: the DATA its genesis stages
 * and the ASSETS the display draws and plays there (the shape is
 * common/system_resources.ts). The client warms a system's list one jump
 * ahead of the player (client/next_hop_prefetch.ts), so the jump's
 * system entry finds its caches warm.
 *
 * THE DATA IS WHAT GENESIS STAGES, BY CONSTRUCTION. Rather than a second,
 * hand-written closure walk that could drift from the one entry really
 * runs, the list is recorded: makeSystem builds the system once, here,
 * over a cold game-data view that notes every (type, id) it asks for.
 * That is the system's sÿst, its stellars, every gövt and ränk, the
 * linked systems, the asteroid types and their fragments, the düdes,
 * flëts (direct and roaming) and përs with EVERY ship class they can
 * spawn whatever the control bits say (the spawn tables keep bit-gated
 * entries and stage them; the maintainer's ruling: "small cost. that's
 * fine."), those ships' outfits, weapons, submunitions and bay fighters,
 * the sprite sheets their hulls and shots are built from, and the
 * missions the përs link to — exactly what a cold sim worker fetches on
 * entry. Player-dependent things (the player's own ship, escorts,
 * mission ships, other players) are not in it: they stay dynamic.
 *
 * THE ASSETS follow from the data: every sprite sheet a stellar, ship,
 * shot, rock or explosion of it draws; the bööms those can set off and
 * the snds of the weapons and explosions; and, for the stellars one can
 * land on, the landscape and bar PICTs. Only ids the data set actually
 * has are listed.
 *
 * Derived lazily, on the first request for a system, from whatever Nova
 * Files and plug-ins the server loaded (no offline conversion and no
 * hand-maintained manifest: standing ruling), then cached for the
 * server's lifetime — the data does not change under a running server.
 */
import { AnimationImages } from 'novadatainterface/animation';
import { AsteroidData } from 'novadatainterface/asteroid_data';
import { ExplosionData } from 'novadatainterface/explosion_data';
import { GameDataInterface } from 'novadatainterface/game_data_interface';
import { Gettable } from 'novadatainterface/gettable';
import { PlanetData } from 'novadatainterface/planet_data';
import { ShipData } from 'novadatainterface/ship_data';
import { WeaponData } from 'novadatainterface/weapon_data';
import type {
    SimulationGameDataInterface, SimulationGameDataResources,
} from '../client/gamedata/simulation_game_data.js';
import {
    SYSTEM_DATA_TYPES, SystemDataType, SystemResourceList,
} from '../common/system_resources.js';
import { makeSystem } from '../nova_plugin/make_system.js';

/**
 * A cold SimulationGameData-shaped view of `source` that records every
 * (type, id) it is asked for — success or not-found alike, since a
 * client asks for both.
 */
class RecordingGameData implements SimulationGameDataInterface {
    readonly requested = new Map<SystemDataType, Set<string>>();
    readonly data: SimulationGameDataResources;
    readonly ids: GameDataInterface['ids'];
    readonly controlBitNamespaces: GameDataInterface['controlBitNamespaces'];

    constructor(private readonly source: GameDataInterface) {
        this.ids = source.ids;
        this.controlBitNamespaces = source.controlBitNamespaces;
        const data: Partial<Record<SystemDataType, Gettable<unknown>>> = {};
        for (const type of SYSTEM_DATA_TYPES) {
            const ids = new Set<string>();
            this.requested.set(type, ids);
            data[type] = new Gettable<unknown>(async id => {
                ids.add(id);
                const value = await (source.data[type] as Gettable<unknown>)
                    .get(id);
                if (type === 'Weapon') {
                    // As the client's WeaponGettable does: a shot's
                    // submunitions load with it.
                    await this.withSubmunitions(value as WeaponData);
                }
                return value;
            }, () => { /* A miss is the data's; makeSystem warns. */ });
        }
        this.data = data as unknown as SimulationGameDataResources;
    }

    private async withSubmunitions(weapon: WeaponData) {
        if (weapon.type !== 'ProjectileWeaponData') {
            return;
        }
        await Promise.all(weapon.submunitions.map(sub =>
            this.data.Weapon.get(sub.id).catch(() => undefined)));
    }

    /** The values recorded for `type` (the ids that resolved). */
    resolved<T>(type: SystemDataType): T[] {
        const gettable = this.data[type] as Gettable<unknown>;
        return [...this.requested.get(type) ?? []].sort()
            .filter(id => id in gettable.gotten)
            .map(id => gettable.gotten[id] as T);
    }
}

function animationIds(images: AnimationImages | undefined): string[] {
    return Object.values(images ?? {})
        .filter((image): image is NonNullable<typeof image> => !!image)
        .map(image => image.id);
}

/** Computes `systemId`'s resource list from `gameData`. */
export async function computeSystemResources(gameData: GameDataInterface,
    systemId: string): Promise<SystemResourceList> {
    const recorder = new RecordingGameData(gameData);
    // The genesis every simulating world builds — the sim worker, the
    // main thread's serializer world, the server's own room archive. On
    // the server's platform, as the archive builds it: the platform only
    // decides keyboard capture and where the control bindings come from,
    // never what is staged. The world is thrown away; only what it asked
    // for is kept.
    await makeSystem(systemId, recorder);

    const data: SystemResourceList['data'] = {};
    for (const [type, ids] of recorder.requested) {
        if (ids.size > 0) {
            data[type] = [...ids].sort();
        }
    }

    const allIds = await gameData.ids;
    const planets = recorder.resolved<PlanetData>('Planet');
    const ships = recorder.resolved<ShipData>('Ship');
    const weapons = recorder.resolved<WeaponData>('Weapon');
    const asteroids = recorder.resolved<AsteroidData>('Asteroid');

    const explosionIds = new Set<string>();
    const sounds = new Set<string>();
    const sheets = new Set<string>();
    const addExplosion = (id: string | null | undefined) => {
        if (id) {
            explosionIds.add(id);
        }
    };
    for (const ship of ships) {
        animationIds(ship.animation.images).forEach(id => sheets.add(id));
        addExplosion(ship.initialExplosion);
        addExplosion(ship.finalExplosion);
        addExplosion(ship.finalExplosionSparks);
    }
    for (const weapon of weapons) {
        if ('animation' in weapon && weapon.animation) {
            animationIds(weapon.animation.images).forEach(id => sheets.add(id));
        }
        if (weapon.sound) {
            sounds.add(weapon.sound);
        }
        if ('primaryExplosion' in weapon) {
            addExplosion(weapon.primaryExplosion);
            addExplosion(weapon.secondaryExplosion);
        }
    }
    for (const asteroid of asteroids) {
        animationIds(asteroid.animation.images).forEach(id => sheets.add(id));
        addExplosion(asteroid.explosion);
    }
    const knownExplosions = new Set(allIds.Explosion);
    const explosions = (await Promise.all([...explosionIds].sort()
        .filter(id => knownExplosions.has(id))
        .map(id => gameData.data.Explosion.get(id).catch(() => undefined))))
        .filter((explosion): explosion is ExplosionData => !!explosion);
    for (const explosion of explosions) {
        animationIds(explosion.animation.images).forEach(id => sheets.add(id));
        if (explosion.sound) {
            sounds.add(explosion.sound);
        }
    }

    // The stellars are on screen from the first frame: their sheets lead.
    const knownSheets = new Set(allIds.SpriteSheetFrames);
    const planetSheets = [...new Set(planets.flatMap(planet =>
        animationIds(planet.animation.images)))];
    const spriteSheets = [...new Set([...planetSheets,
        ...[...sheets].sort()])].filter(id => knownSheets.has(id));

    const knownPicts = new Set(allIds.PictImage);
    const picts = new Set<string>();
    for (const planet of planets) {
        if (!planet.flags.canLand || planet.gate !== null) {
            continue;
        }
        picts.add(planet.landingPict);
        if (planet.flags.hasBar && planet.barPict) {
            picts.add(planet.barPict);
        }
    }

    const knownSounds = new Set(allIds.SoundFile);
    return {
        systemId,
        data,
        assets: {
            SpriteSheet: spriteSheets,
            Explosion: explosions.map(explosion => explosion.id),
            Sound: [...sounds].sort().filter(id => knownSounds.has(id)),
            Pict: [...picts].sort().filter(id => knownPicts.has(id)),
        },
    };
}

/**
 * Each system's list, computed on first request and kept. A failed
 * computation is not kept (the next request retries).
 */
export class SystemResourceCache {
    private readonly lists = new Map<string, Promise<SystemResourceList>>();

    constructor(private readonly gameData: GameDataInterface,
        private readonly compute = computeSystemResources) { }

    /** Whether `systemId` names a system of the data set. */
    async has(systemId: string): Promise<boolean> {
        return (await this.gameData.ids).System.includes(systemId);
    }

    get(systemId: string): Promise<SystemResourceList> {
        let list = this.lists.get(systemId);
        if (!list) {
            list = this.compute(this.gameData, systemId);
            this.lists.set(systemId, list);
            list.catch(() => {
                if (this.lists.get(systemId) === list) {
                    this.lists.delete(systemId);
                }
            });
        }
        return list;
    }
}
