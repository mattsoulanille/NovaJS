import { Entity } from "nova_ecs/entity";
import { decodeWireEntity, WireWorldSnapshot } from "nova_ecs/plugins/snapshot_plugin";
import { isNovaIDNotFoundError } from "novadatainterface/nova_id_not_found_error";
import { deriveEntityComponents } from "./entity_factory.js";
import { World } from "nova_ecs/world";
import { SimulationGameDataInterface } from "../client/gamedata/simulation_game_data.js";
import { AsteroidComponent, loadAsteroidGameData } from "./asteroid_plugin.js";
import { WeaponEntries } from "./fire_weapon_plugin.js";
import { SimulationGameDataResource } from "./game_data_resource.js";
import { GovtComponent } from "./govt_component.js";
import { loadWithRetries } from "./load_retry.js";
import { OutfitsStateComponent } from "./outfit_plugin.js";
import { PlanetComponent } from "./planet_plugin.js";
import { ShipComponent } from "./ship_plugin.js";

/**
 * Loads the transitive closure of game data an entity needs to be
 * simulated *synchronously*: the simulation must never wait for data
 * mid-step, because the tick at which data arrives would vary between
 * runs and peers, breaking determinism and rollback resimulation.
 *
 * A ship's closure includes everything its future spawns need the same
 * tick they are created: its outfits' weapons, those weapons'
 * projectiles/submunition chains and their hurtbox sprite sheets, and
 * bay fighter ship classes (recursively).
 *
 * Entities enter the simulation only after their closure is loaded
 * ("stage, load, then insert"); the insertion tick is an input, so it
 * is allowed to vary.
 */
/**
 * `load()`, or undefined when the id does not exist in the data set.
 *
 * Dangling references are real in installed plug-ins — ships and outfits
 * naming wëaps the plug-in never shipped (seven of them in "Advanced
 * Vell-os Beams", four in "Starbridge Bay"). GameDataAggregator used to
 * resolve those to a placeholder default weapon; it now rejects with
 * NovaIDNotFoundError. A missing OUTFIT, WEAPON or GOVT is skipped here,
 * with a warning: the entity simply does not have it, which is what a
 * reference to nothing amounts to in the original. The entity's own
 * ship / planet / asteroid data is required and still propagates.
 *
 * Deterministic: "does not exist" is a property of the data set, the
 * same on every peer, and Gettable caches the miss so the answer never
 * changes with load timing.
 */
async function loadIfDefined<T>(load: () => Promise<T>,
    label: string): Promise<T | undefined> {
    try {
        return await load();
    } catch (e) {
        if (isNovaIDNotFoundError(e)) {
            console.warn(`Skipping ${label}: ${e.message}`);
            return undefined;
        }
        throw e;
    }
}

export async function loadShipGameData(gameData: SimulationGameDataInterface,
    shipId: string, weaponIds = new Set<string>(),
    seenShips = new Set<string>()): Promise<Set<string>> {
    if (seenShips.has(shipId)) {
        return weaponIds;
    }
    seenShips.add(shipId);

    const ship = await gameData.data.Ship.get(shipId);
    await loadAnimationGameData(gameData, ship.animation);
    for (const outfitId of Object.keys(ship.outfits)) {
        const outfit = await loadIfDefined(
            () => gameData.data.Outfit.get(outfitId), `outfit ${outfitId} of ship ${shipId}`);
        if (!outfit?.weapons) {
            continue;
        }
        for (const weaponId of Object.keys(outfit.weapons)) {
            await loadWeaponGameData(gameData, weaponId, weaponIds, seenShips);
        }
    }
    return weaponIds;
}

export async function loadWeaponGameData(gameData: SimulationGameDataInterface,
    weaponId: string, weaponIds = new Set<string>(),
    seenShips = new Set<string>()): Promise<Set<string>> {
    if (weaponIds.has(weaponId)) {
        return weaponIds;
    }
    weaponIds.add(weaponId);

    const weapon = await loadIfDefined(
        () => gameData.data.Weapon.get(weaponId), `weapon ${weaponId}`);
    if (!weapon) {
        return weaponIds;
    }
    if ('animation' in weapon && weapon.animation) {
        // Projectile hurtboxes are built from the sprite sheet.
        await loadAnimationGameData(gameData, weapon.animation);
    }
    if ('submunitions' in weapon) {
        for (const sub of weapon.submunitions) {
            await loadWeaponGameData(gameData, sub.id, weaponIds, seenShips);
        }
    }
    if (weapon.type === 'BayWeaponData') {
        await loadShipGameData(gameData, weapon.shipID, weaponIds, seenShips);
    }
    return weaponIds;
}

async function loadAnimationGameData(gameData: SimulationGameDataInterface,
    animation: { images: { baseImage: { id: string } } }) {
    // Hull geometry (simulation state) derives from the sprite sheet:
    // retry so a transient fetch failure cannot leave this world's
    // hulls quietly different from everyone else's.
    try {
        await loadWithRetries(() => gameData.data.SpriteSheet.get(
            animation.images.baseImage.id),
            `sprite sheet ${animation.images.baseImage.id}`, 2);
    } catch (e) {
        console.warn(String(e));
    }
}

/**
 * Loads everything an entity needs before it is inserted into a
 * simulation world, and primes the world's WeaponEntries so weapons can
 * fire synchronously.
 */
export async function loadEntityGameData(world: World, entity: Entity) {
    const ship = entity.components.get(ShipComponent);
    const planet = entity.components.get(PlanetComponent);
    const asteroid = entity.components.get(AsteroidComponent);
    if (!ship && !planet && !asteroid) {
        return;
    }
    const gameData = world.resources.get(SimulationGameDataResource);
    if (!gameData) {
        throw new Error('Expected SimulationGameDataResource to exist');
    }

    const weaponIds = new Set<string>();
    if (ship) {
        await loadShipGameData(gameData, ship.id, weaponIds);
    }
    // The ship class's stock loadout is not the entity's loadout: a
    // player ship carries purchased outfits, and their weapons (and
    // the outfit data itself — ammo checks read it from the cache)
    // must stage like everything else. Skipping them left every
    // replaying world's cache cold: weapon state then materialized at
    // a load-timing-dependent tick, differently on every peer — the
    // second real recorded desync.
    const outfits = entity.components.get(OutfitsStateComponent);
    if (outfits) {
        for (const outfitId of outfits.keys()) {
            const outfit = await loadIfDefined(
                () => gameData.data.Outfit.get(outfitId), `owned outfit ${outfitId}`);
            for (const weaponId of Object.keys(outfit?.weapons ?? {})) {
                await loadWeaponGameData(gameData, weaponId, weaponIds);
            }
        }
    }
    if (planet) {
        await gameData.data.Planet.get(planet.id);
    }
    if (asteroid) {
        // Includes the fragment closure, so breakup stays synchronous.
        await loadAsteroidGameData(gameData, asteroid.id);
    }

    // A ship's government (if any) contributes inherent jamming to the
    // JammingDeriver, which reads it from the cache synchronously. Load it
    // here so the derivation never has to wait mid-simulation.
    const govt = entity.components.get(GovtComponent);
    if (govt) {
        // Undefined in the cache reads as "no inherent jamming".
        await loadIfDefined(() => gameData.data.Govt.get(govt.id), `govt ${govt.id}`);
    }

    // Prime the lazily-constructed weapon entries so the first shot of
    // each weapon does not depend on when its entry finished building.
    const weaponEntries = world.resources.get(WeaponEntries);
    if (weaponEntries) {
        await Promise.all([...weaponIds].map(id => weaponEntries.get(id)));
    }
}

/**
 * Stage, load, then complete: loads the transitive closure of game data
 * the entity (and anything it can spawn) needs, then attaches derived
 * components so the entity enters the simulation fully formed.
 */
export async function completeEntity(world: World, entity: Entity) {
    await loadEntityGameData(world, entity);
    deriveEntityComponents(world, entity);
}

/**
 * Loads the game data every entity in a wire snapshot needs, so
 * restoring it (and deriving the omitted components) is synchronous.
 */
export async function loadWireSnapshotGameData(
    world: World, snapshot: WireWorldSnapshot) {
    for (const wireEntity of snapshot.entities) {
        await loadEntityGameData(world, decodeWireEntity(world, wireEntity));
    }
}
