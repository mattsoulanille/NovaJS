import * as t from 'io-ts';
import { AsteroidData } from 'novadatainterface/asteroid_data';
import { Emit, Entities, RunQuery, UUID } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position, PositionType } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { EntityMap } from 'nova_ecs/entity_map';
import { EcsEvent } from 'nova_ecs/events';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { MovementState, MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { Random, RandomResource } from 'nova_ecs/plugins/random_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { TimeResource, TimeSystem } from 'nova_ecs/plugins/time_plugin';
import { Query } from 'nova_ecs/query';
import { System } from 'nova_ecs/system';
import { World } from 'nova_ecs/world';
import SAT from 'sat';
import { SimulationGameDataInterface } from '../../client/gamedata/simulation_game_data.js';
import { registerSimulationBridgeEvent } from '../../communication/simulation_bridge_events.js';
import { AnimationComponent, TumbleAnimation, TumbleAnimationComponent } from '../core/index.js';
import { BeamDataComponent } from './beam_plugin.js';
import { BlastDamageComponent } from '../ship/index.js';
import { CargoComponent, cargoUsed } from '../ship/index.js';
import { loadWithRetries } from '../core/index.js';
import { CollisionEvent, CollisionHitterComponent, CollisionVulnerabilityComponent } from '../core/index.js';
import { CompositeHull, HitboxHullComponent, HurtboxHullComponent, UpdateHitboxHullSystem, UpdateHurtboxHullSystem } from '../core/index.js';
import { DamagedEvent, knockbackDirection } from '../ship/index.js';
import { registerEntityDeriver } from '../core/index.js';
import { SimulationGameDataResource } from '../core/index.js';
import { IdFactory, IdFactoryResource } from '../core/index.js';
import { DecoyTargetComponent } from './jamming_plugin.js';
import { OutfitsStateComponent } from '../ship/index.js';
import { ProjectileDataComponent } from '../core/index.js';
import { ShipPhysicsComponent } from '../ship/index.js';

/**
 * The asteroid field is a square of this half-size centered on the
 * origin, where the system's planets and ship spawns live. The original
 * engine keeps the system's asteroid count drifting within the visible
 * screen and wraps them around its edges (a per-screen density, not a
 * total); a shared deterministic simulation can't have per-player
 * asteroids, so instead the field covers the region gameplay happens in
 * at the same per-screen density, and asteroids wrap at its edges.
 */
export const ASTEROID_FIELD_HALF_SIZE = 3000;
/**
 * The screen area the original engine's per-screen asteroid count
 * refers to (a 1024x768 game window, roughly).
 */
const REFERENCE_SCREEN_AREA = 1024 * 768;
/**
 * Density cap. The sÿst Asteroids field is a per-screen density (0-16);
 * the field is (2*3000)^2 / (1024*768) ≈ 45.8 screens, so the demanded
 * total is count * 45.8: Fomalhaut (nova:136, count 2) demands ~92 and
 * the densest systems (count 10, e.g. S7evyn nova:472) demand ~458.
 * Measured on an M2 laptop (node, real Nova data): Fomalhaut's 92
 * asteroids cost 0.09 ms/step of simulation plus 0.31 ms/frame of
 * sim->display snapshot encoding; an uncapped S7evyn (458) costs
 * 0.47 ms/step plus 1.79 ms/frame of snapshot encoding — the encode
 * (every serializer component of every entity, per frame) is the term
 * that scales worst, and >2 ms of a 16 ms frame on rocks alone is too
 * much next to everything else the frame must do. 256 holds the worst
 * systems to ~0.24 ms/step + ~0.66 ms/frame while leaving all systems
 * with count <= 5 (the vast majority; Fomalhaut included) uncapped.
 */
export const MAX_ASTEROIDS_PER_SYSTEM = 256;
/** How often a depleted field regenerates one asteroid. */
const RESPAWN_INTERVAL_MS = 5000;
/** Asteroid drift speed range, px/s. */
const ASTEROID_MIN_SPEED = 10;
const ASTEROID_MAX_SPEED = 50;
/**
 * Ceiling on an asteroid's speed, px/s.
 *
 * Why one is needed: an asteroid has no MovementPhysicsComponent, so
 * MovementSystem's `shortenToLength(maxVelocity)` — the thing that stops
 * a knocked-around *ship* from running away — never applies to it, and
 * AsteroidMotionSystem's drift has no drag. Every knockback impulse
 * (AsteroidDamageSystem below) therefore accumulates forever. A beam is
 * the worst case, because BeamDamageSystem re-emits DamagedEvent every
 * step the beam dwells on its target: a Thunderhead Lance (wëap
 * nova:166, impact 50) held on a Dust Small (röid nova:136, mass 100)
 * adds 50 * 30 * 5 / 100 = 75 px/s for every second of contact, with
 * nothing to bound it. Fragments inherit their parent's velocity, so a
 * runaway rock also breaks into runaway fragments.
 *
 * The value: the top speed of the fastest ship in the stock game, so a
 * capped asteroid can always be outrun. Excluding the Escape Pod (shïp
 * nova:895, Speed 2000 -> 600 px/s; not a ship anyone flies), the
 * fastest of the 288 stock shïp resources is the Manta (shïp nova:315,
 * Speed 660). shïp Speed is pixels/frame * 100 at the original engine's
 * 30 fps, which ship_parse converts with ShipSpeedConversionFactor =
 * FPS / 100 = 0.3 into the px/s that MovementState.velocity and
 * asteroid drift both use: 660 * 0.3 = 198 px/s.
 *
 * Hardcoded rather than derived at runtime: the sim must not vary with
 * which plug-ins happen to be installed (see the fixture note in
 * simulation_test_fixture.ts). asteroid_plugin_test.ts pins the
 * derivation against real Nova Files data.
 */
export const MAX_ASTEROID_SPEED = 198;

/**
 * Clamps an asteroid velocity to MAX_ASTEROID_SPEED, preserving
 * direction. Pure and allocation-free below the cap: Vector's
 * shortenToLength returns the receiver untouched when it is already
 * short enough, and only rescales (one new Vector) when it is not.
 */
function capAsteroidSpeed(velocity: Vector): Vector {
    return velocity.shortenToLength(MAX_ASTEROID_SPEED);
}
/** Fragment ejection speed range, px/s (added to the parent velocity). */
const FRAGMENT_MIN_SPEED = 15;
const FRAGMENT_MAX_SPEED = 60;
/**
 * Resource-box ejection speed range, px/s. In the original engine the
 * boxes spawn at rest relative to the system — they do NOT inherit the
 * destroyed asteroid's velocity — and each gets only a small random
 * drift (playtest observation, 2026-07-09; roughly 1/10-1/5 of the
 * 20-80 px/s this first shipped with). Tune here.
 */
const DEBRIS_MIN_SPEED = 2.5;
const DEBRIS_MAX_SPEED = 10;
/** How long a resource-box lasts before fading away, ms. */
export const DEBRIS_LIFETIME_MS = 15_000;
/** Tumble rate of resource-boxes, sprite frames/s. */
const DEBRIS_TUMBLE_FRAME_RATE = 15;
/**
 * Hurtbox radius of a resource-box. Follows the rendered size: the
 * engine's 8x8 box sprites at the display's DEBRIS_SCALE (1x) are
 * 8 px.
 */
const DEBRIS_RADIUS = 4;
/** Hitbox radius fallback when an asteroid's sprite hull is unknown. */
const DEFAULT_ASTEROID_RADIUS = 20;

/**
 * A live asteroid. `id` is the röid's global id, `health` its remaining
 * strength. The tumble is purely cosmetic (TumbleAnimationComponent,
 * rendered by TumbleDrawSystem); the sim rotation stays fixed.
 * Queryable by NPC AI (e.g. future mining behavior) to find asteroids
 * to shoot.
 */
export const AsteroidType = t.type({
    id: t.string, // Not a UUID. A nova id.
    health: t.number,
});
export type AsteroidType = t.TypeOf<typeof AsteroidType>;
export const AsteroidComponent = new Component<AsteroidType>('Asteroid');

/** Static röid data; shared, never mutated. */
export const AsteroidDataComponent = new Component<AsteroidData>('AsteroidData');

/**
 * A scoopable resource-box ejected by a destroyed asteroid. `commodity`
 * is the cargo key it grants (see CargoComponent), `expires` the sim
 * time (ms) at which it fades away. Queryable by NPC AI to find debris
 * to scoop.
 */
export const DebrisType = t.type({
    commodity: t.string,
    expires: t.number,
});
export type DebrisType = t.TypeOf<typeof DebrisType>;
export const DebrisComponent = new Component<DebrisType>('Debris');

/**
 * Per-system asteroid field state, attached to a dedicated entity with
 * the deterministic uuid 'asteroid field'. Tracks the spawn target so
 * destroyed asteroids eventually drift back in (the original respawns
 * offscreen to keep the count constant).
 */
export const AsteroidFieldType = t.type({
    /** How many asteroids the field wants alive. */
    targetCount: t.number,
    /** Global röid ids that spawn here. */
    types: t.array(t.string),
    /** Sim time (ms) after which the field may regenerate an asteroid. */
    nextRespawn: t.number,
});
export type AsteroidFieldType = t.TypeOf<typeof AsteroidFieldType>;
export const AsteroidFieldComponent = new Component<AsteroidFieldType>('AsteroidField');

/** Emitted when an asteroid breaks apart, for display effects. */
export const AsteroidBreakEvent = new EcsEvent<{
    position: Position,
    explosion?: string,
    particleCount: number,
    particleColor: number,
    /** The broken asteroid's collision radius; the dust spawns spread
     *  across it rather than from a point. */
    radius: number,
}>('AsteroidBreakEvent');
export const AsteroidBreakEventType = t.intersection([
    t.type({
        position: PositionType,
        particleCount: t.number,
        particleColor: t.number,
        radius: t.number,
    }),
    t.partial({
        explosion: t.string,
    }),
]);
registerSimulationBridgeEvent({
    event: AsteroidBreakEvent,
    includeEntityUuids: false,
});

function mod(n: number, m: number): number {
    return ((n % m) + m) % m;
}

/**
 * Advances a drifting body. Replaces (never mutates) the position
 * object: snapshot codecs encode t.type structures by identity, so
 * rollback snapshots share the live objects and in-place mutation
 * would corrupt history. This is the same replace-don't-mutate
 * contract MovementSystem follows; the only per-asteroid allocation
 * per tick is this one small object, which dies young. The visible
 * tumble is not sim state at all: TumbleAnimationComponent drives it
 * display-side on logical time, and the sim rotation stays fixed.
 */
function drift(state: MovementState, delta_s: number,
    wrapHalfSize: number) {
    const x = mod(state.position.x + state.velocity.x * delta_s
        + wrapHalfSize, 2 * wrapHalfSize) - wrapHalfSize;
    const y = mod(state.position.y + state.velocity.y * delta_s
        + wrapHalfSize, 2 * wrapHalfSize) - wrapHalfSize;
    state.position = new Position(x, y);
}

const AsteroidMotionSystem = new System({
    name: 'AsteroidMotionSystem',
    args: [AsteroidComponent, MovementStateComponent, TimeResource] as const,
    step(_asteroid, movement, time) {
        drift(movement, time.delta_s, ASTEROID_FIELD_HALF_SIZE);
    },
    // after TimeSystem matters for determinism, not just freshness: a
    // system that reads TimeResource before TimeSystem updates it sees
    // delta_s = 0 on a world's very first step but the previous delta
    // on the first step after a wire-baseline restore, so a late
    // joiner's asteroids would drift one extra step out of lockstep.
    after: [TimeSystem],
    before: [UpdateHitboxHullSystem, UpdateHurtboxHullSystem],
});

const DebrisMotionSystem = new System({
    name: 'DebrisMotionSystem',
    args: [DebrisComponent, MovementStateComponent, TimeResource,
        Entities, UUID] as const,
    step(debris, movement, time, entities, uuid) {
        if (time.time > debris.expires) {
            entities.delete(uuid);
            return;
        }
        // Debris drifts and expires long before it could reach the
        // world wrap boundary, so wrap at the world's edge.
        drift(movement, time.delta_s, 10000);
    },
    // See AsteroidMotionSystem: after TimeSystem is load-bearing for
    // late-join determinism.
    after: [TimeSystem],
    before: [UpdateHitboxHullSystem, UpdateHurtboxHullSystem],
});

/**
 * A tumble at `frameRate` frames/s, random direction, random starting
 * phase (so a field of the same röid doesn't tumble in unison).
 */
function tumbleFor(frameRate: number, random: Random): TumbleAnimation {
    return {
        frameRate: random.next() < 0.5 ? -frameRate : frameRate,
        phase: random.next(),
    };
}

/**
 * The asteroid's collision radius, from its sprite's convex hulls.
 * Simulation state from a getCached read: sound only because
 * loadAsteroidGameData warmed (or consistently failed to find) the
 * sheet on every world — the default-radius fallback must never be a
 * per-world outcome.
 */
function asteroidRadius(gameData: SimulationGameDataInterface,
    data: AsteroidData): number {
    const spriteSheet = gameData.data.SpriteSheet
        .getCached(data.animation.images.baseImage.id);
    const firstFrame = spriteSheet?.hulls?.[0];
    if (!firstFrame?.length) {
        return DEFAULT_ASTEROID_RADIUS;
    }
    let radiusSquared = 0;
    for (const convexHull of firstFrame) {
        for (const [x, y] of convexHull) {
            radiusSquared = Math.max(radiusSquared, x * x + y * y);
        }
    }
    return Math.sqrt(radiusSquared) || DEFAULT_ASTEROID_RADIUS;
}

/** Uniform random unit vector via rejection sampling; IEEE-exact ops only. */
function randomDirection(random: Random): Vector {
    while (true) {
        const x = random.next() * 2 - 1;
        const y = random.next() * 2 - 1;
        const lengthSquared = x * x + y * y;
        if (lengthSquared > 1e-6 && lengthSquared <= 1) {
            const length = Math.sqrt(lengthSquared);
            return new Vector(x / length, y / length);
        }
    }
}

function randomBetween(random: Random, min: number, max: number): number {
    return min + random.next() * (max - min);
}

/** ±50% of an average, rounded, as the Bible specifies for yields. */
function averagePlusMinusHalf(average: number, random: Random): number {
    return Math.round(average * (0.5 + random.next()));
}

export function makeAsteroid(gameData: SimulationGameDataInterface,
    data: AsteroidData, random: Random, position: Position,
    velocity: Vector): Entity {
    return new Entity(data.name)
        .addComponent(AsteroidComponent, {
            id: data.id,
            health: data.strength,
        })
        .addComponent(AsteroidDataComponent, data)
        .addComponent(AnimationComponent, data.animation)
        // röid SpinRate, pre-converted to frames/s by the parser.
        .addComponent(TumbleAnimationComponent, tumbleFor(data.frameRate, random))
        .addComponent(MovementStateComponent, {
            position,
            // Every construction path goes through here (field spawn,
            // respawn, breakup fragments that inherit a parent's
            // velocity), so this is the one place a new asteroid can be
            // born over the cap.
            velocity: capAsteroidSpeed(velocity),
            // Fixed: the visible tumble is TumbleAnimationComponent,
            // not a sim rotation.
            rotation: new Angle(0),
            accelerating: 0,
            turning: 0,
            turnBack: false,
        })
        .addComponent(HitboxHullComponent, new CompositeHull([
            new SAT.Circle(new SAT.Vector(0, 0),
                asteroidRadius(gameData, data)),
        ]))
        .addComponent(CollisionVulnerabilityComponent, {
            vulnerableTo: new Set(['normal']),
        })
        // Jammed missiles with the "decoyed by asteroids" seeker flag
        // retarget onto the nearest decoy (see findNearestDecoy in
        // jamming_plugin.ts).
        .addComponent(DecoyTargetComponent, { weight: 1 });
}

function makeDebris(data: AsteroidData, random: Random, position: Position,
    velocity: Vector, expires: number): Entity {
    return new Entity(`${data.name} debris`)
        .addComponent(DebrisComponent, {
            commodity: data.yieldType!,
            expires,
        })
        // The shared debrisAnimation reference lets the display pool
        // graphics across all boxes of the same röid type.
        .addComponent(AnimationComponent, data.debrisAnimation!)
        .addComponent(TumbleAnimationComponent,
            tumbleFor(DEBRIS_TUMBLE_FRAME_RATE, random))
        .addComponent(MovementStateComponent, {
            position,
            velocity,
            rotation: new Angle(0),
            accelerating: 0,
            turning: 0,
            turnBack: false,
        })
        .addComponent(HurtboxHullComponent, new CompositeHull([
            new SAT.Circle(new SAT.Vector(0, 0), DEBRIS_RADIUS),
        ]))
        // Only ships are vulnerable to 'debris', so boxes never collide
        // with asteroids, projectiles, or each other.
        .addComponent(CollisionHitterComponent, {
            hitTypes: new Set(['debris']),
        });
}

function spawnFieldAsteroid(entities: EntityMap,
    gameData: SimulationGameDataInterface, ids: IdFactory, random: Random,
    types: string[], atEdge: boolean) {
    if (types.length === 0) {
        return;
    }
    // getCached is deterministic here only because spawnAsteroids
    // loaded (with retries) every field type and its fragment closure;
    // a miss would consume a different number of random draws and skip
    // the spawn on this world alone. See Gettable.getCached's warning.
    const data = gameData.data.Asteroid
        .getCached(types[random.below(types.length)]);
    if (!data) {
        return;
    }
    let x = randomBetween(random, -ASTEROID_FIELD_HALF_SIZE,
        ASTEROID_FIELD_HALF_SIZE);
    let y = randomBetween(random, -ASTEROID_FIELD_HALF_SIZE,
        ASTEROID_FIELD_HALF_SIZE);
    if (atEdge) {
        // Respawned asteroids drift in from a field edge instead of
        // popping into the middle of a battle.
        if (random.next() < 0.5) {
            x = -ASTEROID_FIELD_HALF_SIZE;
        } else {
            y = -ASTEROID_FIELD_HALF_SIZE;
        }
    }
    const velocity = randomDirection(random).scale(randomBetween(
        random, ASTEROID_MIN_SPEED, ASTEROID_MAX_SPEED));
    entities.set(ids.next('asteroid'),
        makeAsteroid(gameData, data, random, new Position(x, y), velocity));
}

/**
 * Loads the transitive closure of data an asteroid type needs: its own
 * data and sprite sheet (for the collision radius) plus everything its
 * fragments need, recursively, so mid-simulation breakup is synchronous.
 *
 * This warms every id the asteroid systems later read with `getCached`
 * (respawn type picks, breakup fragments, hurtbox radii) — the sole
 * guarantee that those reads behave identically on every world. So
 * loads retry, and an asteroid whose *data* stays unloadable throws:
 * a world quietly missing an asteroid type spawns different fields and
 * different fragments than everyone else (a recorded desync class).
 * A missing *sprite sheet* only degrades the hurtbox to the default
 * radius, which is consistent when the sheet is absent from the data
 * itself (the test fixture); after retries it stays a warning.
 */
export async function loadAsteroidGameData(
    gameData: SimulationGameDataInterface, asteroidId: string,
    seen = new Set<string>()): Promise<void> {
    if (seen.has(asteroidId)) {
        return;
    }
    seen.add(asteroidId);
    const data: AsteroidData = await loadWithRetries(
        () => gameData.data.Asteroid.get(asteroidId),
        `asteroid ${asteroidId}`);
    try {
        await loadWithRetries(() => gameData.data.SpriteSheet.get(
            data.animation.images.baseImage.id),
            `asteroid ${asteroidId} sprite sheet`, 2);
    } catch (e) {
        console.warn(String(e));
    }
    for (const fragment of data.fragments) {
        await loadAsteroidGameData(gameData, fragment, seen);
    }
}

/**
 * Spawns a system's asteroid field: SystemData.asteroids per reference
 * screen area across the field, of the system's röid types, from the
 * world's deterministic Random (same system seed -> same field). Call
 * from makeSystem before the world steps.
 */
export async function spawnAsteroids(world: World,
    systemData: { asteroids: number, asteroidTypes: string[] }) {
    if (systemData.asteroids <= 0 || systemData.asteroidTypes.length === 0) {
        return;
    }
    const gameData = world.resources.get(SimulationGameDataResource);
    const random = world.resources.get(RandomResource);
    const ids = world.resources.get(IdFactoryResource);
    if (!gameData || !random || !ids) {
        throw new Error('Expected game data, random, and id factory resources');
    }

    for (const typeId of systemData.asteroidTypes) {
        await loadAsteroidGameData(gameData, typeId);
    }

    const fieldScreens = (2 * ASTEROID_FIELD_HALF_SIZE) ** 2
        / REFERENCE_SCREEN_AREA;
    const targetCount = Math.min(MAX_ASTEROIDS_PER_SYSTEM,
        Math.round(systemData.asteroids * fieldScreens));

    for (let i = 0; i < targetCount; i++) {
        spawnFieldAsteroid(world.entities, gameData, ids, random,
            systemData.asteroidTypes, false);
    }

    const field = new Entity('asteroid field')
        .addComponent(AsteroidFieldComponent, {
            targetCount,
            types: systemData.asteroidTypes,
            nextRespawn: 0,
        });
    world.entities.set('asteroid field', field);
}

const LiveAsteroidsQuery = new Query([AsteroidComponent] as const);

/**
 * Regenerates destroyed asteroids one at a time, from a field edge,
 * until the field is back at its target count. Fragments count toward
 * the target, so a freshly shattered field pauses before regrowing.
 */
const AsteroidRespawnSystem = new System({
    name: 'AsteroidRespawnSystem',
    args: [AsteroidFieldComponent, LiveAsteroidsQuery, TimeResource,
        Entities, RandomResource, IdFactoryResource,
        SimulationGameDataResource] as const,
    step(field, liveAsteroids, time, entities, random, ids, gameData) {
        if (time.time < field.nextRespawn
            || liveAsteroids.length >= field.targetCount) {
            return;
        }
        field.nextRespawn = time.time + RESPAWN_INTERVAL_MS;
        spawnFieldAsteroid(entities, gameData, ids, random, field.types, true);
    },
    // Determinism rule 4: the respawn timer compares against time.time,
    // so this must run after TimeSystem advances the clock.
    after: [TimeSystem],
});

const DamagerQuery = new Query([Optional(ProjectileDataComponent),
    Optional(BeamDataComponent), Optional(MovementStateComponent),
    Optional(BlastDamageComponent)] as const);

/**
 * Applies weapon damage to asteroids and breaks them apart. Asteroids
 * take a weapon's mass (armor) damage against their strength, times 10
 * for "asteroid miner" weapons (wëap flags2 0x8000). A destroyed
 * asteroid ejects sub-asteroids and scoopable resource-boxes, both
 * averaged ±50% per the Bible.
 */
const AsteroidDamageSystem = new System({
    name: 'AsteroidDamageSystem',
    events: [DamagedEvent],
    args: [DamagedEvent, AsteroidComponent, AsteroidDataComponent,
        MovementStateComponent, RunQuery, UUID, Entities, Emit,
        RandomResource, IdFactoryResource, SimulationGameDataResource,
        TimeResource] as const,
    step({ damage, damager, scale = 1 }, asteroid, data, movement, runQuery,
        uuid, entities, emit, random, ids, gameData, time) {
        if (asteroid.health <= 0) {
            return; // Already broken apart this tick.
        }

        const [damagerParts] = runQuery(DamagerQuery, damager);
        const weaponData = damagerParts?.[0] ?? damagerParts?.[1];
        let armorDamage = damage.armor * scale;
        if (weaponData?.asteroidMiner) {
            armorDamage *= 10;
        }

        // Knockback, scaled by the röid's mass. Aimed by the same rule
        // ships use (knockbackDirection): a blast shoves the rock
        // radially away from the explosion, anything else along the
        // damager's own heading. A blast sitting exactly on the rock
        // has no direction, and yields no impulse.
        const damagerMovement = damagerParts?.[2];
        if (damage.knockback && damagerMovement && data.mass > 0) {
            const direction = knockbackDirection(
                movement.position, damagerMovement,
                Boolean(damagerParts?.[3]));
            if (direction) {
                // Capped: nothing else bounds an asteroid's speed (no
                // MovementPhysicsComponent, no drag), so without this
                // the impulses accumulate without limit. See
                // MAX_ASTEROID_SPEED.
                movement.velocity = capAsteroidSpeed(movement.velocity.add(
                    direction.scale(
                        damage.knockback * scale * 5 / data.mass)));
            }
        }

        if (armorDamage <= 0) {
            return;
        }
        asteroid.health -= armorDamage;
        if (asteroid.health > 0) {
            return;
        }

        // Break apart: sub-asteroids...
        const position = Position.fromVectorLike(movement.position);
        if (data.fragments.length > 0) {
            const fragmentCount =
                averagePlusMinusHalf(data.fragmentCount, random);
            for (let i = 0; i < fragmentCount; i++) {
                // Warm on every world: loadAsteroidGameData stages the
                // fragment closure recursively (and throws rather than
                // leave a type cold). A per-world miss here would skip
                // fragments and fork the Random stream.
                const fragmentData = gameData.data.Asteroid.getCached(
                    data.fragments[random.below(data.fragments.length)]);
                if (!fragmentData) {
                    continue;
                }
                const velocity = Vector.fromVectorLike(movement.velocity)
                    .add(randomDirection(random).scale(randomBetween(
                        random, FRAGMENT_MIN_SPEED, FRAGMENT_MAX_SPEED)));
                entities.set(ids.next('asteroid'), makeAsteroid(
                    gameData, fragmentData, random, position, velocity));
            }
        }

        // ...and resource-boxes.
        if (data.yieldType && data.debrisAnimation) {
            const boxCount = averagePlusMinusHalf(data.yieldQuantity, random);
            for (let i = 0; i < boxCount; i++) {
                const velocity = randomDirection(random).scale(randomBetween(
                    random, DEBRIS_MIN_SPEED, DEBRIS_MAX_SPEED));
                entities.set(ids.next('debris'), makeDebris(
                    data, random, position, velocity,
                    time.time + DEBRIS_LIFETIME_MS));
            }
        }

        entities.delete(uuid);
        emit(AsteroidBreakEvent, {
            position,
            explosion: data.explosion ?? undefined,
            particleCount: data.particles.count,
            particleColor: data.particles.color,
            radius: asteroidRadius(gameData, data),
        });
    },
});

/**
 * Scoops debris a ship runs over into its cargo hold, if the ship
 * carries a mining scoop outfit (ModType 31) and has cargo space free.
 */
const ScoopSystem = new System({
    name: 'ScoopSystem',
    events: [CollisionEvent],
    args: [CollisionEvent, Entities, CargoComponent, OutfitsStateComponent,
        ShipPhysicsComponent, SimulationGameDataResource] as const,
    step(collision, entities, cargo, outfits, physics, gameData) {
        const other = entities.get(collision.other);
        const debris = other?.components.get(DebrisComponent);
        if (!debris) {
            return;
        }

        let hasScoop = false;
        for (const [outfitId, { count }] of outfits) {
            if (count > 0
                && gameData.data.Outfit.getCached(outfitId)?.miningScoop) {
                hasScoop = true;
                break;
            }
        }
        if (!hasScoop) {
            return;
        }
        if (cargoUsed(cargo) + 1 > physics.freeCargo) {
            return;
        }
        cargo.set(debris.commodity, (cargo.get(debris.commodity) ?? 0) + 1);
        entities.delete(collision.other);
    },
});

function deriveAsteroidData(gameData: SimulationGameDataInterface,
    asteroid: { id: string }) {
    return gameData.data.Asteroid.getCached(asteroid.id);
}

export const AsteroidPlugin: Plugin = {
    name: 'AsteroidPlugin',
    build(world) {
        const serializer = world.resources.get(SerializerResource);
        serializer?.addComponent(AsteroidComponent, AsteroidType);
        serializer?.addComponent(DebrisComponent, DebrisType);
        serializer?.addComponent(AsteroidFieldComponent, AsteroidFieldType);
        serializer?.addEvent(AsteroidBreakEvent, AsteroidBreakEventType);

        // AsteroidDataComponent is intentionally NOT serializer
        // registered: it is static shared data, and registering it
        // would re-encode it per asteroid per display frame. Wire
        // snapshot restores derive it from AsteroidComponent instead
        // (see snapshot_policies.ts).
        registerEntityDeriver(world, {
            name: 'AsteroidDataDeriver',
            provided: AsteroidDataComponent,
            requires: [AsteroidComponent],
            derive: (entity, gameData) => deriveAsteroidData(
                gameData, entity.components.get(AsteroidComponent)!),
        });

        world.addSystem(AsteroidMotionSystem);
        world.addSystem(DebrisMotionSystem);
        world.addSystem(AsteroidRespawnSystem);
        world.addSystem(AsteroidDamageSystem);
        world.addSystem(ScoopSystem);
    },
};
