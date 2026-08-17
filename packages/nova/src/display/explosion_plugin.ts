import { ExplosionData } from "novadatainterface/explosion_data";
import { Emit, Entities, GetEntity, UUID } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { Angle } from "nova_ecs/datatypes/angle";
import { Position } from "nova_ecs/datatypes/position";
import { Vector } from "nova_ecs/datatypes/vector";
import { Entity } from "nova_ecs/entity";
import { Plugin } from "nova_ecs/plugin";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { Optional } from "nova_ecs/optional";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { System } from "nova_ecs/system";
import { SingletonComponent } from "nova_ecs/world";
import { v4 } from "uuid";
import { ExplosionDataComponent } from "../nova_plugin/animation_plugin.js";
import { DisplayAssetDataResource } from "../nova_plugin/game_data_resource.js";
import { ProjectileExplodeEvent } from "../nova_plugin/projectile_plugin.js";
import { SoundEvent } from "../nova_plugin/sound_plugin.js";
import { AnimationGraphicComponent } from "./animation_graphic_plugin.js";
import { armorFullyRestored, DeathEvent, PlayerDeathSystem, ZeroArmorEvent } from "../nova_plugin/death_plugin.js";
import { ArmorComponent } from "../nova_plugin/health_plugin.js";
import { ShipComponent, ShipDataComponent } from "../nova_plugin/ship_plugin.js";
import { DeathAISystem } from "../nova_plugin/npc_plugin.js";
import { PlayerShipSelector } from "../nova_plugin/player_ship_plugin.js";
import {
    MAX_SECONDARY_EXPLOSIONS_PER_STEP, secondaryExplosionsDue,
    secondaryExplosionTotal,
} from "../nova_plugin/ship_explosion.js";
import { defaultSimulationTime, SimulationTimeResource } from "./simulation_time.js";
import { SOUND_EXPLOSION_LOOP, UiSoundEvent } from "./ui_sound.js";


const ExplosionState = new Component<{
    startTime?: number,
    lifetime?: number,
}>('ExplosionState');

const ExplosionSystem = new System({
    name: 'ExplosionSystem',
    args: [AnimationGraphicComponent, ExplosionDataComponent,
        ExplosionState, TimeResource, Entities, UUID, Emit] as const,
    step(graphic, explosionData, explosionState, time, entities, uuid, emit) {
        if (!explosionState.startTime || !explosionState.lifetime) {
            explosionState.startTime = time.time;
            const frameTime = 30 / explosionData.rate;
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
 *  - FIXED PERIOD (`schedule` absent): the nested secondaries a
 *    projectile's primary explosion carries (makeExplosion's second
 *    argument). They ride on a standalone explosion entity that lives
 *    only as long as its animation, tick on the display's own clock, and
 *    are silent — the primary explosion already played the sound.
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
 * still sounds for player and NPC alike: it comes off the standalone
 * explosion entity, and the 371 loop stops on the same DeathEvent that
 * spawns it.
 */
const SecondaryExplosionSystem = new System({
    name: 'SecondaryExplosion',
    args: [SecondaryExplosionComponent, TimeResource, SimulationTimeResource,
        Entities, MovementStateComponent, GetEntity] as const,
    step(explosion, time, simTime, entities, { position }, { components }) {
        const spawn = (silent: boolean) => {
            // TODO: Fix these types in position.ts
            const pos = position.add(
                randomPointInCircle(explosion.radius ?? 80)) as Position;
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

        if (!explosion.lastTime) {
            explosion.lastTime = 0;
        }
        if (explosion.lastTime + explosion.period > time.time) {
            return;
        }

        explosion.lastTime = time.time;
        spawn(true);
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

        const secondary = explosion.projectileData.secondaryExplosion;
        let secondaryExplosionData: ExplosionData | undefined;
        if (secondary) {
            secondaryExplosionData =
                gameData.data.Explosion.getCached(secondary);
        }

        entities.set(v4(), makeExplosion(primaryExplosionData,
            explosion.position, secondaryExplosionData));
    }
});

const ShipFinalExplosionSystem = new System({
    name: 'ShipFinalExplosionSystem',
    events: [DeathEvent],
    before: [PlayerDeathSystem, DeathAISystem],
    args: [ShipDataComponent, DisplayAssetDataResource, MovementStateComponent, Entities] as const,
    step(ship, gameData, movement, entities) {
        if (!ship.finalExplosion) {
            return;
        }
        const explosionData =
            gameData.data.Explosion.getCached(ship.finalExplosion);

        if (!explosionData) {
            return;
        }
        let largeExplosion: ExplosionData | undefined;
        if (ship.largeExplosion) {
            largeExplosion = explosionData;
        }
        entities.set(v4(), makeExplosion(
            explosionData,
            Position.fromVectorLike(movement.position),
            largeExplosion));

    }
});

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
 */
// TODO: Sample collisions in the convex hull of the ship
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

        const explosion =
            gameData.data.Explosion.getCached(ship.initialExplosion);
        if (!explosion) {
            return;
        }

        // TODO: Normalize all times to ms (as ShipZeroArmorSystem says).
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
 */
const ShipSecondaryExplosionStaleSystem = new System({
    name: 'ShipSecondaryExplosionStaleSystem',
    args: [SecondaryExplosionComponent, ArmorComponent, GetEntity] as const,
    step(_explosion, armor, { components }) {
        if (armorFullyRestored(armor)) {
            components.delete(SecondaryExplosionComponent);
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

export function makeExplosion(explosionData: ExplosionData, position: Position,
    secondaryExplosionData?: ExplosionData) {
    const explosion = new Entity()
        .addComponent(ExplosionDataComponent, explosionData)
        .addComponent(ExplosionState, {})
        .addComponent(MovementStateComponent, {
            position,
            accelerating: 0,
            rotation: new Angle(0),
            turnBack: false,
            turning: 0,
            velocity: new Vector(0, 0),
        });
    if (secondaryExplosionData) {
        explosion.addComponent(SecondaryExplosionComponent, {
            explosion: secondaryExplosionData,
            period: 30,
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
        world.removeSystem(ShipSecondaryExplosionSystem);
        world.removeSystem(ShipSecondaryExplosionDoneSystem);
        world.removeSystem(ShipSecondaryExplosionStaleSystem);
        world.removeSystem(PlayerExplosionSoundStartSystem);
        world.removeSystem(PlayerExplosionSoundStopSystem);
    }
}
