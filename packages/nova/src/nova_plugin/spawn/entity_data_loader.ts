import { Entity } from "nova_ecs/entity";
import { decodeWireEntity, WireWorldSnapshot } from "nova_ecs/plugins/snapshot_plugin";
import { isNovaIDNotFoundError } from "novadatainterface/nova_id_not_found_error";
import { deriveEntityComponents } from "../core/index.js";
import { World } from "nova_ecs/world";
import { SimulationGameDataInterface } from "../../client/gamedata/simulation_game_data.js";
import { AsteroidComponent, loadAsteroidGameData } from "../combat/index.js";
import { WeaponEntries } from "../combat/index.js";
import { SimulationGameDataResource } from "../core/index.js";
import { GovtComponent } from "../core/index.js";
import { stageEncodedComponentsGameData } from "../core/index.js";
import { loadWithRetries } from "../core/index.js";
import { OutfitsStateComponent } from "../ship/index.js";
import { PlanetComponent } from "../travel/index.js";
import { ShipComponent } from "../ship/index.js";

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
    // hulls quietly different from everyone else's. A failure that
    // outlives the retries rejects like every other staged load (#60):
    // swallowing it here left the hull to attach at a load-dependent
    // tick via HitboxProvider's per-step getCached retry, on this
    // world alone — the ship un-hittable meanwhile, and its hull is
    // hashed simulation input. Genesis fails construction; insertion
    // staging retries the whole load or resyncs.
    await loadWithRetries(() => gameData.data.SpriteSheet.get(
        animation.images.baseImage.id),
        `sprite sheet ${animation.images.baseImage.id}`, 2);
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
        await loadOutfitWeaponsGameData(gameData, outfits.keys(), weaponIds);
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

    await primeWeaponEntries(world, weaponIds);
}

/**
 * Loads outfits (into the cache the derivers read with `getCached`) and
 * the transitive closure of their weapons. An outfit that fails to load
 * is reported and skipped rather than failing the whole staging: an id
 * this game data does not have — which a hostile record can name — is
 * a not-found (loadIfDefined), and any other rejection (a fetch failure
 * on a browser worker) is reported the same way, because the providers
 * then miss it identically on every world, which is deterministic,
 * whereas a rejected staging wedges the archive on that record forever.
 */
async function loadOutfitWeaponsGameData(gameData: SimulationGameDataInterface,
    outfitIds: Iterable<string>, weaponIds: Set<string>) {
    for (const outfitId of outfitIds) {
        let outfit;
        try {
            outfit = await loadIfDefined(
                () => gameData.data.Outfit.get(outfitId), `owned outfit ${outfitId}`);
        } catch (e) {
            console.warn(`Outfit ${outfitId} could not be staged: ${String(e)}`);
            continue;
        }
        for (const weaponId of Object.keys(outfit?.weapons ?? {})) {
            await loadWeaponGameData(gameData, weaponId, weaponIds);
        }
    }
}

/**
 * Primes the lazily-constructed weapon entries so the first shot of
 * each weapon does not depend on when its entry finished building.
 */
async function primeWeaponEntries(world: World, weaponIds: Set<string>) {
    const weaponEntries = world.resources.get(WeaponEntries);
    if (weaponEntries) {
        await Promise.all([...weaponIds].map(id => weaponEntries.get(id)));
    }
}

/**
 * Stages outfits that enter a ship's loadout IN FLIGHT — an accepted
 * mission's OnAccept Gxxx grants — exactly as loadEntityGameData stages
 * the outfits an inserted entity already carries: the outfit data
 * itself (deriveShipPhysics reads it from the cache), its weapons'
 * closure, and this world's WeaponEntries. Applying the grant drops
 * WeaponsState/ShipPhysics for the providers to rebuild, and a provider
 * that misses the cache retries on a later tick — a different tick on
 * every world whose cache warmed differently, i.e. a desync.
 */
export async function loadOutfitsGameData(world: World,
    outfitIds: Iterable<string>) {
    const gameData = world.resources.get(SimulationGameDataResource);
    if (!gameData) {
        throw new Error('Expected SimulationGameDataResource to exist');
    }
    const weaponIds = new Set<string>();
    await loadOutfitWeaponsGameData(gameData, outfitIds, weaponIds);
    await primeWeaponEntries(world, weaponIds);
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
 * The game-data REFERENCES the entities carry (core/game_data_ref.ts)
 * are staged first, since decoding an entity resolves them; then each
 * decoded entity's closure, as genesis stages it.
 */
export async function loadWireSnapshotGameData(
    world: World, snapshot: WireWorldSnapshot) {
    const gameData = world.resources.get(SimulationGameDataResource);
    if (!gameData) {
        throw new Error('Expected SimulationGameDataResource to exist');
    }
    await stageEncodedComponentsGameData(gameData,
        snapshot.entities.map(entity => entity.components));
    for (const wireEntity of snapshot.entities) {
        await loadEntityGameData(world, decodeWireEntity(world, wireEntity));
    }
}
