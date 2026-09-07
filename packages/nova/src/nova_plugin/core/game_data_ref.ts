import { isLeft } from 'fp-ts/lib/Either.js';
import * as t from 'io-ts';
import { Animation } from 'novadatainterface/animation';
import { BaseData } from 'novadatainterface/base_data';
import { Gettable } from 'novadatainterface/gettable';
import { isNovaIDNotFoundError } from 'novadatainterface/nova_id_not_found_error';
import { WireShapedType } from 'nova_ecs/plugins/serializer_plugin';
import { World } from 'nova_ecs/world';
import { SimulationGameDataInterface } from '../../client/gamedata/simulation_game_data.js';
import { DisplayAssetDataResource, SimulationGameDataResource } from './game_data_resource.js';

/**
 * ============================================================================
 * Game data on the wire: references, not copies (#225)
 * ============================================================================
 *
 * Six serializer-registered components hold PARSED GAME DATA — the
 * ship class (ShipData), the planet (PlanetData), a weapon
 * (ProjectileData, BeamData), an explosion (ExplosionData), and the
 * Animation any of those (or an asteroid) contributes. Every peer
 * loads the same data set (the build handshake requires plug-in
 * parity), so sending the data itself — kilobytes per entity, in every
 * input record that inserts one, every baseline a joiner reconstructs
 * from, every frame the display receives — sent nothing the receiver
 * did not already have. They cross the wire as a REFERENCE into the
 * receiving peer's own game data:
 *
 *   ShipData, PlanetData, ProjectileData, BeamData, ExplosionData
 *       `{id}` — the data's own nova id, resolved in the Ship, Planet,
 *       Weapon (checked to be the projectile or beam kind) or Explosion
 *       table. Nothing per-entity: a component's value is always the
 *       cached object for that id (escort upgrades swap in another
 *       class's object, escort_action.ts, still by id). Explosions are
 *       display-side entities (display/explosion_plugin.ts) and their
 *       table is the display's asset data; the simulation's game data
 *       has none, and no simulation entity carries one.
 *   AnimationComponent
 *       `{owner, id}` — an Animation has no table of its own; it is a
 *       field of its owner (`ship`, `planet`, `weapon`, `explosion`,
 *       `asteroid`, or an asteroid's `asteroidDebris`). The owner is
 *       found by object identity: every Animation a world holds came
 *       out of a cached data object, so an index over the caches
 *       answers it (built lazily, extended when a lookup misses).
 *   BeamState
 *       NOT game data — per-beam state that used to share the seven's
 *       opaque passthrough codec. It now has its real io-ts shape
 *       (beam_plugin.ts).
 *
 * Decoding resolves against the cache SYNCHRONOUSLY (`getCached`) and
 * fails loudly on a miss — never a silent placeholder, never an async
 * load at apply time, which would attach the component at a load-
 * dependent tick and desync. Every receiving path therefore STAGES the
 * references before it decodes (`stageGameDataRefs`), the same way
 * genesis stages an entity's closure before inserting it: input
 * records (simulation_input.ts loadInputRecordsGameData), wire
 * snapshots (entity_data_loader.ts loadWireSnapshotGameData), the
 * bridge host's insertions, and the display's frames
 * (apply_simulation_frame.ts stageSimulationFrameGameData).
 */

/** The wire form of a game-data component: the data's id. */
export const GameDataRef = t.type({ id: t.string }, 'GameDataRef');
export type GameDataRef = t.TypeOf<typeof GameDataRef>;

/** What owns an Animation, and in which field. */
export const AnimationOwner = t.keyof({
    ship: null, planet: null, weapon: null, explosion: null,
    asteroid: null, asteroidDebris: null,
}, 'AnimationOwner');
export type AnimationOwner = t.TypeOf<typeof AnimationOwner>;

/** The wire form of an AnimationComponent: its owner's id. */
export const AnimationRef = t.type({ owner: AnimationOwner, id: t.string }, 'AnimationRef');
export type AnimationRef = t.TypeOf<typeof AnimationRef>;

/** The game-data tables a reference resolves in. */
export type GameDataTable = 'Ship' | 'Planet' | 'Weapon' | 'Explosion' | 'Asteroid';

const OWNER_TABLES: Record<AnimationOwner, GameDataTable> = {
    ship: 'Ship', planet: 'Planet', weapon: 'Weapon', explosion: 'Explosion',
    asteroid: 'Asteroid', asteroidDebris: 'Asteroid',
};

/** The table `name` in a game data set that has it. */
function tableIn(gameData: SimulationGameDataInterface | undefined,
    name: GameDataTable): Gettable<BaseData> | undefined {
    if (name === 'Explosion') {
        return undefined;
    }
    return gameData?.data[name] as Gettable<BaseData> | undefined;
}

/**
 * The table `name` resolves in for `world`: the simulation's game data,
 * or the display's asset data for explosions.
 */
function tableOf(world: World, name: GameDataTable): Gettable<BaseData> | undefined {
    if (name === 'Explosion') {
        return world.resources.get(DisplayAssetDataResource)?.data.Explosion;
    }
    return tableIn(world.resources.get(SimulationGameDataResource), name);
}

/** The Animation `owner` contributes, if it has one. */
function animationOf(owner: AnimationOwner, data: BaseData): Animation | undefined {
    const record = data as unknown as {
        animation?: Animation, debrisAnimation?: Animation,
    };
    return owner === 'asteroidDebris' ? record.debrisAnimation : record.animation;
}

/**
 * Animation object -> its reference, by identity. Process-wide: an
 * object belongs to one owner wherever it is seen, and identity is
 * what the sim shares between the owner's data and the component.
 */
const animationIndex = new WeakMap<Animation, AnimationRef>();

function indexAnimations(world: World) {
    const owners: [AnimationOwner, GameDataTable][] = [
        ['ship', 'Ship'], ['planet', 'Planet'], ['weapon', 'Weapon'],
        ['explosion', 'Explosion'], ['asteroid', 'Asteroid'], ['asteroidDebris', 'Asteroid'],
    ];
    for (const [owner, name] of owners) {
        const cached = tableOf(world, name)?.gotten ?? {};
        for (const id of Object.keys(cached)) {
            const animation = animationOf(owner, cached[id]!);
            if (animation && !animationIndex.has(animation)) {
                animationIndex.set(animation, { owner, id });
            }
        }
    }
}

/** The reference of an Animation this world's game data owns. */
export function animationRef(world: World, animation: Animation): AnimationRef {
    const known = animationIndex.get(animation);
    if (known) {
        return known;
    }
    indexAnimations(world);
    const found = animationIndex.get(animation);
    if (!found) {
        throw new Error(`AnimationComponent holds an Animation (${animation.id}) that `
            + 'no cached game data owns; it cannot cross the wire');
    }
    return found;
}

function isObject(u: unknown): u is object {
    return typeof u === 'object' && u !== null;
}

/**
 * The serializer codec of a game-data component: `{id}` on the wire,
 * the cached data object in the world. `accept` narrows a table whose
 * rows come in kinds (Weapon).
 */
export function gameDataRefType<Data extends BaseData>(world: World, name: GameDataTable,
    componentName: string, accept?: (data: BaseData) => data is Data,
): WireShapedType<Data, GameDataRef> {
    return new WireShapedType<Data, GameDataRef>(
        `${componentName}Ref`,
        (u): u is Data => isObject(u) && typeof (u as BaseData).id === 'string',
        (input, context) => {
            const ref = GameDataRef.validate(input, context);
            if (isLeft(ref)) {
                return ref;
            }
            const { id } = ref.right;
            const cache = tableOf(world, name);
            if (!cache) {
                return t.failure(input, context,
                    `${componentName} ${id} cannot be resolved: this world has no ${name} data`);
            }
            const data = cache.getCached(id);
            if (!data) {
                return t.failure(input, context,
                    `${componentName} ${id} is not staged in this world's ${name} data`);
            }
            if (accept && !accept(data)) {
                return t.failure(input, context,
                    `${componentName} ${id} is not a ${componentName}`);
            }
            return t.success(data as Data);
        },
        data => ({ id: data.id }),
        GameDataRef,
    );
}

/** The serializer codec of AnimationComponent: `{owner, id}` on the wire. */
export function animationRefType(world: World): WireShapedType<Animation, AnimationRef> {
    return new WireShapedType<Animation, AnimationRef>(
        'AnimationRef',
        (u): u is Animation => isObject(u) && 'images' in u,
        (input, context) => {
            const ref = AnimationRef.validate(input, context);
            if (isLeft(ref)) {
                return ref;
            }
            const { owner, id } = ref.right;
            const data = tableOf(world, OWNER_TABLES[owner])?.getCached(id);
            const animation = data && animationOf(owner, data);
            if (!animation) {
                return t.failure(input, context, `AnimationComponent of ${owner} ${id} is not `
                    + `staged in this world's ${OWNER_TABLES[owner]} data`);
            }
            return t.success(animation);
        },
        animation => animationRef(world, animation),
        AnimationRef,
    );
}

// ---------------------------------------------------------------------------
// Staging
// ---------------------------------------------------------------------------

/** How each reference-carrying component's wire form is read. */
export const GAME_DATA_REF_COMPONENTS: ReadonlyMap<string, GameDataTable | 'animation'> = new Map([
    ['ShipData', 'Ship'],
    ['PlanetData', 'Planet'],
    ['ProjectileData', 'Weapon'],
    ['BeamData', 'Weapon'],
    ['ExplosionData', 'Explosion'],
    ['AnimationComponent', 'animation'],
]);

/** Ids to load, by table. */
export type GameDataRefs = Map<GameDataTable, Set<string>>;

/**
 * The references in a list of encoded components (`[name, encoded]`
 * pairs: an EncodedEntity's, an EntityDelta's, a wire entity's). A
 * malformed reference is skipped here; the decode reports it.
 */
export function collectGameDataRefs(components: Iterable<readonly [string, unknown, ...unknown[]]>,
    into: GameDataRefs = new Map()): GameDataRefs {
    const add = (name: GameDataTable, id: unknown) => {
        if (typeof id !== 'string') {
            return;
        }
        let ids = into.get(name);
        if (!ids) {
            ids = new Set();
            into.set(name, ids);
        }
        ids.add(id);
    };
    for (const [name, encoded] of components) {
        const kind = GAME_DATA_REF_COMPONENTS.get(name);
        if (kind === undefined || !isObject(encoded)) {
            continue;
        }
        if (kind === 'animation') {
            const { owner, id } = encoded as Partial<AnimationRef>;
            if (owner !== undefined && owner in OWNER_TABLES) {
                add(OWNER_TABLES[owner], id);
            }
        } else {
            add(kind, (encoded as Partial<GameDataRef>).id);
        }
    }
    return into;
}

/**
 * Loads every referenced id into `gameData`'s caches, so the decodes
 * that follow resolve synchronously. An id the data set does not have
 * is reported and skipped rather than failing the staging (the decode
 * then fails for that component, and only it): a hostile record can
 * name any id, and a rejected staging wedges the archive on that
 * record for good (see entity_data_loader.ts).
 */
export async function stageGameDataRefs(gameData: SimulationGameDataInterface,
    refs: GameDataRefs): Promise<void> {
    const loads: Promise<void>[] = [];
    for (const [name, ids] of refs) {
        const cache = tableIn(gameData, name);
        if (!cache) {
            // Explosions: display-side entities never cross a wire, and
            // the simulation's data has no such table to stage in.
            console.warn(`Cannot stage ${name} ${[...ids].join(', ')}: no such table`);
            continue;
        }
        for (const id of ids) {
            loads.push(cache.get(id).then(() => undefined, (error: unknown) => {
                if (isNovaIDNotFoundError(error)) {
                    console.warn(`Skipping ${name} ${id}: ${(error as Error).message}`);
                    return;
                }
                throw error;
            }));
        }
    }
    await Promise.all(loads);
}

/** `stageGameDataRefs` over one or more encoded component lists. */
export async function stageEncodedComponentsGameData(gameData: SimulationGameDataInterface,
    lists: Iterable<Iterable<readonly [string, unknown, ...unknown[]]>>): Promise<void> {
    const refs: GameDataRefs = new Map();
    for (const components of lists) {
        collectGameDataRefs(components, refs);
    }
    if (refs.size > 0) {
        await stageGameDataRefs(gameData, refs);
    }
}
