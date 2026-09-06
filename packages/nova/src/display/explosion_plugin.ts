import { ShipData } from "novadatainterface/ship_data";
import { ExplosionData } from "novadatainterface/explosion_data";
import { Emit, EmitFunction, Entities, GetEntity, UUID } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { Angle } from "nova_ecs/datatypes/angle";
import { Position } from "nova_ecs/datatypes/position";
import { Vector } from "nova_ecs/datatypes/vector";
import { Entity } from "nova_ecs/entity";
import { EntityMap } from "nova_ecs/entity_map";
import { DeleteEvent } from "nova_ecs/events";
import { Plugin } from "nova_ecs/plugin";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { Optional } from "nova_ecs/optional";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { System } from "nova_ecs/system";
import { SingletonComponent } from "nova_ecs/world";
import { v4 } from "uuid";
import { DisplayAssetDataInterface } from "../client/gamedata/display_asset_data.js";
import { ExplosionDataComponent } from "../nova_plugin/core/animation_plugin.js";
import { DisplayAssetDataResource } from "../nova_plugin/core/game_data_resource.js";
import { ProjectileExplodeEvent } from "../nova_plugin/combat/projectile_plugin.js";
import { SoundEvent } from "../nova_plugin/core/sound_plugin.js";
import { AnimationGraphicComponent } from "./animation_graphic_plugin.js";
import { armorFullyRestored, DeathEvent, PlayerDeathSystem, ZeroArmorEvent } from "../nova_plugin/ship/death_plugin.js";
import { ArmorComponent } from "../nova_plugin/ship/health_plugin.js";
import { ShipComponent, ShipDataComponent } from "../nova_plugin/ship/ship_plugin.js";
import { DeathAISystem } from "../nova_plugin/npc/npc_plugin.js";
import { PlayerShipSelector } from "../nova_plugin/player/player_ship_plugin.js";
import {
    finalExplosionScale, MAX_SECONDARY_EXPLOSIONS_PER_STEP,
    secondaryExplosionsDue, secondaryExplosionTotal,
} from "../nova_plugin/ship/ship_explosion.js";
import { defaultSimulationTime, SimulationTimeResource } from "./simulation_time.js";
import { SOUND_EXPLOSION_LOOP, UiSoundEvent } from "./ui_sound.js";


const ExplosionState = new Component<{
    startTime?: number,
    lifetime?: number,
    /**
     * Sprite scale for this explosion's graphic, 1 for an ordinary one.
     * Set from finalExplosionScale for the mass-proportional fireball of
     * a shïp DeathDelay >= 60 hull (ShipData.largeExplosion).
     */
    scale?: number,
}>('ExplosionState');

/**
 * One frame of the game animation, in ms. bööm FrameAdvance counts in
 * these: "100 will cause each frame of the explosion to appear for
 * exactly one frame of the game animation" (EVN Bible), and the game runs
 * at 30 fps — the unit every other display timer uses (FADE_FRAME_MS,
 * running_light_blink's MS_PER_FRAME). ExplosionData.rate is
 * FrameAdvance / 100, so a sprite frame lasts GAME_FRAME_MS / rate. It
 * used to be 30 / rate, which ran every explosion ~10% fast.
 */
export const GAME_FRAME_MS = 1000 / 30;

const ExplosionSystem = new System({
    name: 'ExplosionSystem',
    args: [AnimationGraphicComponent, ExplosionDataComponent,
        ExplosionState, TimeResource, Entities, UUID, Emit] as const,
    step(graphic, explosionData, explosionState, time, entities, uuid, emit) {
        // Written every step, like DebrisDrawSystem's: graphics come out
        // of AnimationGraphicPool with their scale reset to 1, and the
        // graphic is provided asynchronously, so there is no single
        // moment at creation time at which this could be set once.
        if (explosionState.scale !== undefined) {
            graphic.container.scale.set(explosionState.scale);
        }
        if (!explosionState.startTime || !explosionState.lifetime) {
            explosionState.startTime = time.time;
            const frameTime = GAME_FRAME_MS / explosionData.rate;
            explosionState.lifetime = frameTime * Math.max(0,
                ...[...graphic.sprites.values()].map(s => s.frames));

            if (explosionData.sound) {
                emit(SoundEvent, { id: explosionData.sound })
            }
        }

        const progress = (time.time - explosionState.startTime)
            / explosionState.lifetime;
        graphic.progress = progress;

        if (progress > 1) {
            entities.delete(uuid);
        }
    }
});

/**
 * Exported for tests: this is the component that, when it leaks onto a
 * living ship, makes it trail explosions around the system.
 *
 * It drives two different cadences, and `schedule` is the discriminator:
 *
 *  - FIXED PERIOD (`schedule` absent): the "+1000" SPARKS — "Explosion
 *    type 0-63, plus a random number of type-0 explosions around it"
 *    (EVN Bible, wëap ExplodType ~:3159, which shïp Explode2 ~:2445
 *    defers to). They ride on a standalone explosion entity that lives
 *    only as long as its animation, tick on the display's own clock, are
 *    silent — the primary explosion already played the sound — and stop
 *    after `remaining` of them, which is the Bible's random number.
 *  - DEATH SEQUENCE (`schedule` present): a ship breaking up. The
 *    explosions ACCELERATE toward the final one and each plays the
 *    bööm's sound, and the spawn times come from the SIMULATION clock
 *    rather than the display's, so they are a pure function of synced
 *    state (see ship_explosion.ts's secondaryExplosionsDue).
 */
export const SecondaryExplosionComponent = new Component<{
    explosion: ExplosionData,
    lastTime?: number,
    period: number,
    radius?: number,
    /**
     * FIXED-PERIOD mode only: how many sparks are still owed. Drawn once
     * per explosion from {@link randomSparkCount} — the "random number of
     * type-0 explosions" of the Bible's +1000 rule. The component removes
     * itself when this reaches 0, so a long-lived primary explosion does
     * not keep spraying sparks for its whole animation.
     *
     * Undefined means unbounded (the old behaviour), which is what the
     * death-sequence mode uses; it is bounded by `schedule.total` instead.
     */
    remaining?: number,
    /**
     * The death sequence this ship is in, in SIM-clock milliseconds:
     * `startTime` is when its armor hit zero, `endTime` when its final
     * explosion is due (start + shïp DeathDelay), `total` how many
     * secondary explosions the whole sequence gets, and `spawned` how
     * many have gone off so far.
     */
    schedule?: {
        startTime: number,
        endTime: number,
        total: number,
        spawned: number,
    },
}>('SecondaryExplosion');

/**
 * Bounds on the Bible's "random number of type-0 explosions around it"
 * (wëap ExplodType 1000-1063, ~:3159; shïp Explode2 + 1000, ~:2445).
 * The Bible gives no range, so these are TUNABLE — few enough that a
 * single blaster hit reads as a hit with sparks rather than a barrage,
 * and at SPARK_PERIOD_MS apart the whole scatter lands inside the
 * primary explosion's own animation (bööm 133 runs 20 frames ~= 600 ms).
 */
export const MIN_EXPLOSION_SPARKS = 2;
export const MAX_EXPLOSION_SPARKS = 6;
/** Milliseconds between consecutive sparks. */
export const SPARK_PERIOD_MS = 30;
/**
 * How far from the explosion's centre sparks are scattered, in pixels,
 * at fireball scale 1. Multiplied by the fireball's scale so a
 * Leviathan's 6.25x fireball gets its sparks spread across the whole of
 * it instead of clustered in the middle of it.
 */
export const SPARK_RADIUS = 80;

/**
 * The Bible's "random number" of sparks, uniform over
 * [MIN_EXPLOSION_SPARKS, MAX_EXPLOSION_SPARKS].
 *
 * Math.random is CORRECT here and only here: explosions live in the
 * per-peer DISPLAY world, so two peers may legitimately draw different
 * spark counts for the same death (randomPointInCircle below already
 * scatters them differently). Nothing in the simulation reads this.
 */
export function randomSparkCount(): number {
    return MIN_EXPLOSION_SPARKS + Math.floor(
        Math.random() * (MAX_EXPLOSION_SPARKS - MIN_EXPLOSION_SPARKS + 1));
}

function randomPointInCircle(r: number): Vector {
    const r2 = r ** 2;
    while (true) {
        const pos = new Position(
            (Math.random() - 0.5) * 2 * r,
            (Math.random() - 0.5) * 2 * r,
        );
        if (pos.lengthSquared <= r2) {
            return pos;
        }
    }
}

/**
 * Spawns the secondary explosions of both cadences (see
 * SecondaryExplosionComponent).
 *
 * SOUND. A death sequence's explosions each play the bööm's own sound —
 * for the stock ships, Explode1 = bööm 132 "ship breakup" = snd 302 —
 * on the everyone-hears SoundEvent channel, which is where makeExplosion's
 * standalone entities already play theirs (ExplosionSystem). There is no
 * distance attenuation to apply: NovaJS mixes every sound at one global
 * volume (display/sound_plugin.ts), so "positional" is not yet a thing
 * the sound path can express; the per-frame SoundStartLimiter is what
 * keeps a cluster of deaths from stacking into a wall of noise.
 *
 * ...EXCEPT ON THE LOCAL PLAYER'S OWN SHIP, which already has snd 371
 * looping for the whole sequence (PlayerExplosionSoundStartSystem). That
 * loop IS the player's breakup sound in the original, so layering 302
 * over it would be playing the same event twice. The final explosion
 * still sounds for player and NPC alike — {@link spawnFinalExplosion}
 * plays the Explode2 bööm's own sound — and the 371 loop stops on the
 * same death that spawns it.
 */
const SecondaryExplosionSystem = new System({
    name: 'SecondaryExplosion',
    args: [SecondaryExplosionComponent, TimeResource, SimulationTimeResource,
        Entities, MovementStateComponent, GetEntity] as const,
    step(explosion, time, simTime, entities, { position }, { components }) {
        const spawn = (silent: boolean) => {
            const pos = position.add(
                randomPointInCircle(explosion.radius ?? SPARK_RADIUS));
            entities.set(v4(), makeExplosion({
                ...explosion.explosion,
                sound: silent ? null : explosion.explosion.sound,
            }, pos));
        };

        const schedule = explosion.schedule;
        if (schedule) {
            const duration = schedule.endTime - schedule.startTime;
            const due = secondaryExplosionsDue(duration > 0
                ? (simTime.time - schedule.startTime) / duration : 1,
                schedule.total);
            const owed = Math.min(MAX_SECONDARY_EXPLOSIONS_PER_STEP,
                due - schedule.spawned);
            if (owed <= 0) {
                return;
            }
            // The 371 loop covers the local player's own breakup.
            const silent = components.has(PlayerShipSelector);
            for (let i = 0; i < owed; i++) {
                spawn(silent);
            }
            schedule.spawned += owed;
            return;
        }

        if (explosion.remaining !== undefined && explosion.remaining <= 0) {
            // The Bible's random number of sparks is spent.
            components.delete(SecondaryExplosionComponent);
            return;
        }

        if (!explosion.lastTime) {
            explosion.lastTime = 0;
        }
        if (explosion.lastTime + explosion.period > time.time) {
            return;
        }

        explosion.lastTime = time.time;
        spawn(true);
        if (explosion.remaining !== undefined) {
            explosion.remaining--;
        }
    }
});

const ProjectileExplosionSystem = new System({
    name: 'ProjectileExplosionSystem',
    events: [ProjectileExplodeEvent],
    args: [ProjectileExplodeEvent, DisplayAssetDataResource, Entities, SingletonComponent] as const,
    step(explosion, gameData, entities) {
        const primary = explosion.projectileData.primaryExplosion;
        if (!primary) {
            return;
        }

        const primaryExplosionData = gameData.data.Explosion.getCached(primary);
        if (!primaryExplosionData) {
            return;
        }

        // wëap ExplodType 1000-1063 (EVN Bible ~:3159). weapon_parse
        // resolves this to bööm 128 — explosion type 0 — in the weapon's
        // own id space, which is the correct graphic for the sparks; the
        // ship half of the same rule (shïp Explode2 + 1000) is
        // ShipData.finalExplosionSparks, resolved the same way.
        const sparks = explosion.projectileData.secondaryExplosion;
        let sparksExplosionData: ExplosionData | undefined;
        if (sparks) {
            sparksExplosionData =
                gameData.data.Explosion.getCached(sparks);
        }

        entities.set(v4(), makeExplosion(primaryExplosionData,
            explosion.position, sparksExplosionData));
    }
});

/**
 * Marks a ship the display believes is in its death sequence: set when
 * its armor reaches zero, cleared when the death is handled (or when
 * the armor comes back — see ShipSecondaryExplosionStaleSystem).
 *
 * It exists so the final explosion survives the ONE ordering the
 * display cannot control: an NPC's entity is deleted by the simulation
 * (DeathAISystem) on the very tick it dies, and the bridge applies a
 * frame's STATE — the deletion included — before it replays that
 * frame's EVENTS. By the time the display's DeathEvent is dispatched,
 * the ship it names is gone from the display world, and an event
 * targeted at a missing entity runs on nothing at all: no fireball, no
 * bööm sound, for every NPC death in the game. (The local player's ship
 * respawns rather than being deleted, so only its death ever reached
 * ShipFinalExplosionSystem.)
 *
 * The deletion itself is the display's reliable signal, since nova_ecs
 * hands DeleteEvent the removed Entity OBJECT — still carrying the
 * hull's shïp data and its last synced position, which is all the final
 * explosion needs. This marker is what separates "deleted because it
 * died" from "deleted because it left the system", and whichever of the
 * two paths fires first clears it, so a ship can never explode twice.
 */
const ShipDyingComponent = new Component<undefined>('ShipDying');

/**
 * Draws the fireball a ship "disappears in" when its death sequence
 * ends — and plays the Explode2 bööm's own sound with it (bööm 133
 * "ship exploding" -> snd 303 for every stock ship, but read from the
 * bööm, never assumed) — from the TWO separate shïp fields the Bible
 * gives for the graphic:
 *
 *  - Explode2 (~:2445) names the bööm, and Explode2 + 1000 adds "a
 *    random number of type-0 explosions around it" — ShipData
 *    .finalExplosionSparks, which is bööm 128 ("FAE Small"), NOT a
 *    second copy of Explode2's own graphic. 179 of the 288 stock ships
 *    set it.
 *  - DeathDelay >= 60 (~:2427) makes it "a huge explosion. The exact
 *    size of the resulting fireball is proportional to the ship's mass"
 *    — ShipData.largeExplosion, which scales the graphic and nothing
 *    else. 86 of the 288 stock ships qualify.
 *
 * These are independent: of the stock ships, all 86 large-explosion
 * hulls also spark, 93 spark without the huge fireball, and 109 do
 * neither. They were previously collapsed into one `largeExplosion`
 * field, which meant every DeathDelay >= 60 ship nested extra copies of
 * bööm 133 around itself and no ship's fireball ever grew.
 *
 * THE SOUND IS EMITTED HERE, not from ExplosionSystem as an ordinary
 * explosion's is, and the fireball entity is handed a copy of the bööm
 * with `sound: null` so it cannot play twice. ExplosionSystem plays a
 * sound only once the entity's PIXI graphic has loaded, which is a
 * per-peer, per-cache-state delay of unbounded length on the very death
 * that has the coldest cache — the one moment a death sound must not be
 * late. Emitting at the explosion keeps it on the everyone-hears
 * SoundEvent channel with the breakup sounds (same volume and the same
 * per-frame SoundStartLimiter), exactly once, at the ship's position.
 */
function spawnFinalExplosion(ship: ShipData,
    gameData: DisplayAssetDataInterface, position: Position,
    entities: EntityMap, emit: EmitFunction) {
    if (!ship.finalExplosion) {
        return;
    }
    const explosionData =
        gameData.data.Explosion.getCached(ship.finalExplosion);

    if (!explosionData) {
        return;
    }
    let sparks: ExplosionData | undefined;
    if (ship.finalExplosionSparks) {
        // Not yet loaded just means no sparks this time; the fireball
        // itself still shows.
        sparks = gameData.data.Explosion
            .getCached(ship.finalExplosionSparks) ?? undefined;
    }
    const scale = ship.largeExplosion
        ? finalExplosionScale(ship.physics.mass) : 1;
    if (explosionData.sound) {
        emit(SoundEvent, { id: explosionData.sound });
    }
    entities.set(v4(), makeExplosion(
        { ...explosionData, sound: null }, position, sparks, scale));
}

/**
 * The final explosion of a ship whose entity is still in the display
 * world when its death is replayed — the local player's, which respawns
 * rather than being deleted. Everything else comes through
 * ShipDeletedFinalExplosionSystem; see ShipDyingComponent for why there
 * are two paths.
 */
const ShipFinalExplosionSystem = new System({
    name: 'ShipFinalExplosionSystem',
    events: [DeathEvent],
    before: [PlayerDeathSystem, DeathAISystem],
    args: [ShipDataComponent, DisplayAssetDataResource, MovementStateComponent,
        Entities, Emit, GetEntity] as const,
    step(ship, gameData, movement, entities, emit, { components }) {
        // Whichever path explodes the ship takes the marker with it, so
        // a later deletion of the same hull cannot explode it again.
        components.delete(ShipDyingComponent);
        spawnFinalExplosion(ship, gameData,
            Position.fromVectorLike(movement.position), entities, emit);
    }
});

/**
 * The final explosion of a ship that the simulation DELETED as it died
 * — every NPC, and any hull the room drops mid-sequence. The entity is
 * already out of the display world by the time its DeathEvent arrives
 * (see ShipDyingComponent), so the deletion is what has to draw it.
 *
 * Gated on the marker, so a ship that leaves the world for any other
 * reason — jumping out, a bay fighter recovered, the room dropping a
 * distant NPC — is removed silently, as it always was.
 */
const ShipDeletedFinalExplosionSystem = new System({
    name: 'ShipDeletedFinalExplosionSystem',
    events: [DeleteEvent],
    args: [ShipDyingComponent, ShipDataComponent, DisplayAssetDataResource,
        MovementStateComponent, Entities, Emit, GetEntity] as const,
    step(_dying, ship, gameData, movement, entities, emit, { components }) {
        components.delete(ShipDyingComponent);
        spawnFinalExplosion(ship, gameData,
            Position.fromVectorLike(movement.position), entities, emit);
    }
});

/**
 * Starts a ship's death sequence in the display: marks the hull as
 * dying (see ShipDyingComponent) and starts loading what its final
 * explosion will need, a whole shïp DeathDelay before it needs it.
 *
 * THE PREFETCH IS THE OTHER HALF OF THE MISSING SOUND. Both the bööm
 * and its snd are reached with getCached, whose FIRST call for an id
 * always misses (it returns undefined and starts a background load), so
 * a cold id is silent exactly once. The breakup explosions hide this —
 * a death sequence asks for bööm 132's sound a dozen times, so only the
 * first puff is quiet — but a ship explodes finally exactly once, and
 * nothing else in the game plays bööm 133 or snd 303, so the miss lands
 * squarely on the sound this system exists to make audible. Warming
 * both at zero armor gives the load the entire death delay (0.33 s for
 * the twitchiest stock hull, 8.3 s for a Leviathan) to finish.
 *
 * Display-only and load-timing dependent by nature: nothing here is
 * read by the simulation, and a prefetch that loses the race merely
 * costs one silent explosion, exactly as before.
 */
const ShipDeathSequenceStartSystem = new System({
    name: 'ShipDeathSequenceStart',
    events: [ZeroArmorEvent],
    args: [ShipDataComponent, DisplayAssetDataResource, GetEntity,
        Optional(ArmorComponent)] as const,
    step(ship, gameData, { components }, armor) {
        // The same replayed-after-the-respawn event ShipSecondary-
        // ExplosionSystem guards against; marking a living ship as
        // dying would explode it the next time it left the system.
        if (armorFullyRestored(armor)) {
            return;
        }
        components.set(ShipDyingComponent, undefined);
        prefetchExplosionSound(gameData, ship.finalExplosion);
        prefetchExplosionSound(gameData, ship.initialExplosion);
    }
});

/** Warms a bööm and its snd so the explosion that needs them is audible. */
function prefetchExplosionSound(gameData: DisplayAssetDataInterface,
    explosionId: string | null) {
    if (!explosionId) {
        return;
    }
    // A missing bööm or snd is the game data's problem, not this
    // prefetch's: the explosion path warns about it on its own, so a
    // failure here is swallowed rather than logged twice.
    void gameData.data.Explosion.get(explosionId).then(explosion => {
        if (explosion?.sound) {
            return gameData.data.Sound.get(explosion.sound);
        }
        return undefined;
    }).catch(() => { });
}

/**
 * Starts a ship's breakup animation when its armor reaches zero.
 *
 * The schedule is anchored on the SIMULATION clock: ZeroArmorEvent
 * carries the sim Time at which the armor hit zero (death_plugin.ts), and
 * the sequence ends one shïp DeathDelay later — exactly the deadline
 * ShipZeroArmorSystem writes into ExplodingComponent, recomputed here
 * from the same two synced inputs because that component does not cross
 * the bridge. So the display's explosion cadence is a function of synced
 * state rather than of this peer's frame rate.
 *
 * Tracker issue: the secondary explosions are placed in a circle
 * (SecondaryExplosionSystem's randomPointInCircle) rather than sampled
 * within the ship's convex hull.
 */
const ShipSecondaryExplosionSystem = new System({
    name: 'ShipSecondaryExplosionSystem',
    events: [ZeroArmorEvent],
    args: [ShipDataComponent, GetEntity, DisplayAssetDataResource,
        Optional(ArmorComponent), ZeroArmorEvent] as const,
    step(ship, {components}, gameData, armor, zeroArmorTime) {
        if (ship.initialExplosion == null) {
            return;
        }
        // The bridge replays a whole frame's worth of simulation events
        // in emit order against already-applied state, so a
        // ZeroArmorEvent can land here describing a life that ended
        // (and respawned) earlier in the same batch. Starting the
        // secondary explosions then pins them to a living ship forever,
        // since only a DeathEvent takes them off again. See
        // armorFullyRestored.
        if (armorFullyRestored(armor)) {
            return;
        }
        // Already dying: the hulk keeps taking hits, and the sim emits a
        // ZeroArmorEvent for EVERY hit that leaves armor at zero. The
        // sim's ShipZeroArmorSystem ignores those repeats (its
        // ExplodingComponent guard, death_plugin.ts) so its deadline
        // stays anchored on the FIRST zero; the schedule here has to stay
        // anchored on the same one, or every further hit restarted the
        // breakup from its slow phase — replaying the early explosions,
        // never reaching the accelerating tail, and drifting the display's
        // end past the sim's death.
        if (components.get(SecondaryExplosionComponent)?.schedule) {
            return;
        }

        const explosion =
            gameData.data.Explosion.getCached(ship.initialExplosion);
        if (!explosion) {
            return;
        }

        // ShipData.deathDelay is in seconds; sim time is ms (tracker
        // issue: normalize novadatainterface durations to ms).
        const durationMs = ship.deathDelay * 1000;
        components.set(SecondaryExplosionComponent, {
            explosion,
            // Unused in schedule mode; kept so the component's shape is
            // unchanged for anything still reading it.
            period: 90,
            schedule: {
                startTime: zeroArmorTime.time,
                endTime: zeroArmorTime.time + durationMs,
                total: secondaryExplosionTotal(durationMs),
                spawned: 0,
            },
        });
    }
});

const ShipSecondaryExplosionDoneSystem = new System({
    name: 'ShipSecondaryExplosionDoneSystem',
    args: [GetEntity] as const,
    events: [DeathEvent],
    step(entity) {
        entity.components.delete(SecondaryExplosionComponent);
        entity.components.delete(ShipDyingComponent);
    }
});

/**
 * Self-heal: a ship at FULL armor is not exploding, so it must not be
 * trailing secondary explosions.
 *
 * ShipSecondaryExplosionDoneSystem is edge-triggered on DeathEvent, which
 * makes a leak permanent whenever the removing edge is missed or arrives
 * out of order — the exact failure Matthew hit (an exploding animation
 * that followed his ship around after a respawn). This level-triggered
 * sweep is the backstop: whatever went wrong upstream, the animation
 * stops as soon as the mirrored armor is back to full.
 *
 * Full armor, not merely nonzero: a hulk mid-explosion normally sits a
 * hair *above* zero (see armorFullyRestored — 70 of the 288 stock ships
 * recharge armor, and they get one tick of it before the disable freezes
 * them), so a nonzero test would cut most real death animations short on
 * their first frame.
 *
 * Gated on ArmorComponent, so the standalone explosion entities
 * makeExplosion creates — which carry SecondaryExplosionComponent and no
 * armor — are untouched.
 *
 * It sweeps ShipDyingComponent on the same rule and for the same
 * reason: a hull left marked as dying after coming back to full armor
 * would draw a final explosion the next time it left the display world.
 */
const ShipSecondaryExplosionStaleSystem = new System({
    name: 'ShipSecondaryExplosionStaleSystem',
    args: [ArmorComponent, GetEntity] as const,
    step(armor, { components }) {
        if (armorFullyRestored(armor)) {
            components.delete(SecondaryExplosionComponent);
            components.delete(ShipDyingComponent);
        }
    },
    before: [SecondaryExplosionSystem],
});

// Loops the death sound (snd 371) for the whole duration of the LOCAL
// player's own explosion sequence. Both events are targeted at the ship
// that zeroed / died, so the PlayerShipSelector arg fires these only on
// the local player's ship. ZeroArmorEvent can re-fire while armor stays
// at zero, but starting a loop already in LoopingSounds is a no-op
// (playSound), so no debounce is needed; DeathEvent ends the sequence
// (and respawns), stopping the loop.
//
// The armorFullyRestored guard is what keeps that last sentence true: a
// ZeroArmorEvent replayed after the respawn would restart the loop
// *after* its stopping DeathEvent, leaving the death sound howling for
// the rest of the flight.
const PlayerExplosionSoundStartSystem = new System({
    name: 'PlayerExplosionSoundStart',
    events: [ZeroArmorEvent],
    args: [PlayerShipSelector, Emit, Optional(ArmorComponent)] as const,
    step(_player, emit, armor) {
        if (armorFullyRestored(armor)) {
            return;
        }
        emit(UiSoundEvent, { id: SOUND_EXPLOSION_LOOP, loop: true });
    }
});

const PlayerExplosionSoundStopSystem = new System({
    name: 'PlayerExplosionSoundStop',
    events: [DeathEvent],
    args: [PlayerShipSelector, Emit] as const,
    step(_player, emit) {
        emit(UiSoundEvent, { id: SOUND_EXPLOSION_LOOP, stop: true });
    }
});

/**
 * Builds a standalone explosion entity.
 *
 * @param sparksExplosionData Explosion type 0 (bööm 128), when the
 * source set the "+1000" bit on its explosion field — wëap ExplodType
 * 1000-1063 or shïp Explode2 + 1000. A random number of these is
 * scattered around the primary (see SecondaryExplosionComponent).
 * @param scale Sprite scale for the primary explosion's graphic; 1 for
 * an ordinary explosion, {@link finalExplosionScale} for the
 * mass-proportional fireball of a shïp DeathDelay >= 60 hull.
 */
export function makeExplosion(explosionData: ExplosionData, position: Position,
    sparksExplosionData?: ExplosionData, scale = 1) {
    const explosion = new Entity()
        .addComponent(ExplosionDataComponent, explosionData)
        .addComponent(ExplosionState, { scale })
        .addComponent(MovementStateComponent, {
            position,
            accelerating: 0,
            rotation: new Angle(0),
            turnBack: false,
            turning: 0,
            velocity: new Vector(0, 0),
        });
    if (sparksExplosionData) {
        explosion.addComponent(SecondaryExplosionComponent, {
            explosion: sparksExplosionData,
            period: SPARK_PERIOD_MS,
            remaining: randomSparkCount(),
            // Spread over the primary fireball, whatever size it is.
            radius: SPARK_RADIUS * scale,
        });
    }
    return explosion;
}

export const ExplosionPlugin: Plugin = {
    name: 'ExplosionPlugin',
    build(world) {
        // The death-sequence cadence reads the MIRRORED sim clock, which
        // applySimulationFrame overwrites every frame; until the first
        // frame arrives it reads t=0 (no sequence has started yet, so
        // nothing is scheduled against it). Same pattern as
        // ProjectileFadePlugin.
        if (!world.resources.has(SimulationTimeResource)) {
            world.resources.set(SimulationTimeResource,
                defaultSimulationTime());
        }
        world.addSystem(ExplosionSystem);
        world.addSystem(ProjectileExplosionSystem);
        world.addSystem(SecondaryExplosionSystem);
        world.addSystem(ShipFinalExplosionSystem);
        world.addSystem(ShipDeletedFinalExplosionSystem);
        world.addSystem(ShipDeathSequenceStartSystem);
        world.addSystem(ShipSecondaryExplosionSystem);
        world.addSystem(ShipSecondaryExplosionDoneSystem);
        world.addSystem(ShipSecondaryExplosionStaleSystem);
        world.addSystem(PlayerExplosionSoundStartSystem);
        world.addSystem(PlayerExplosionSoundStopSystem);
    },
    remove(world) {
        world.removeSystem(ExplosionSystem);
        world.removeSystem(ProjectileExplosionSystem);
        world.removeSystem(SecondaryExplosionSystem);
        world.removeSystem(ShipFinalExplosionSystem);
        world.removeSystem(ShipDeletedFinalExplosionSystem);
        world.removeSystem(ShipDeathSequenceStartSystem);
        world.removeSystem(ShipSecondaryExplosionSystem);
        world.removeSystem(ShipSecondaryExplosionDoneSystem);
        world.removeSystem(ShipSecondaryExplosionStaleSystem);
        world.removeSystem(PlayerExplosionSoundStartSystem);
        world.removeSystem(PlayerExplosionSoundStopSystem);
    }
}
