/**
 * ============================================================================
 * Looping sounds are derived from STATE, not from start/stop events
 * ============================================================================
 *
 * #355: "Sounds that loop when firing keep looping after firing is done.
 * They also loop in different periods if I click off the tab and back on."
 *
 * Every looping sound used to be started by a `{ loop: true }` event and
 * ended by a `{ stop: true }` event. For weapon fire (wëap Flags 0x0010,
 * "Weapon's sound is looped rather than played repeatedly") there was no
 * stop at all — the simulation emits `{ loop: true }` with every shot and
 * nothing else — so once 770b763e made loops really loop, the first shot
 * of a looping weapon started a loop that rang until the display world
 * was torn down. The player's death loop did have a stop, but it rode the
 * bridged DeathEvent, which a rollback or resync can drop.
 *
 * So the display now asks, every frame, "which loops SHOULD be playing?"
 * from state it already has, and reconciles what is playing against that
 * answer (`reconcileLoops`). A missed edge — a dropped event, a rollback,
 * a resync, a hidden tab — cannot strand a loop: the next frame's answer
 * no longer contains it, and it is stopped (a weapon loop at the end of
 * the iteration it is in: see LoopPlayback). One-shot sounds stay events.
 *
 * The sources of "wanted", all level-triggered:
 *  - weapon fire: `wantedWeaponLoops` below, from the mirrored
 *    WeaponsStateComponent (`firing` + `lastFired`) of every ship and the
 *    BeamDataComponent of every live beam;
 *  - display-local demands in LoopDemandResource, keyed by owner: the
 *    player's death loop (explosion_plugin, from the ship's dying marker)
 *    and any `UiSoundEvent { loop: true }` until its `{ stop: true }`
 *    (the spaceport ambient — display-local, so its events cannot be lost).
 *
 * KEY: one loop per SOUND ID, however many ships want it. That is the
 * dedupe the event path already had (LoopingSounds was keyed by id), and
 * it is what keeps ten escorts firing Capacitor Pulse Lasers from
 * stacking ten copies of the same sample out of phase with one another.
 */
import { Resource } from 'nova_ecs/resource';
import { World } from 'nova_ecs/world';
import { WeaponData } from 'novadatainterface/weapon_data';
import { ORIGINAL_FRAME_MS } from '../nova_plugin/combat/index.js';
import { WeaponsState } from '../nova_plugin/ship/index.js';

/**
 * Slack on top of a weapon's reload before a run of shots counts as over:
 * the sim may fire up to a tick late (intervalElapsed rounds to the
 * nearest tick), and two original frames is well under anything a player
 * hears as a gap.
 */
export const LOOP_GRACE_MS = 2 * ORIGINAL_FRAME_MS;

/**
 * The longest gap between two shots of a weapon that is firing
 * continuously: its per-shot reload (shared out across non-simultaneous
 * mounts, floored at one original frame — the cadence WeaponsSystem's
 * effectiveReload enforces), or its burst reload when it bursts, so a
 * held burst weapon keeps one loop across its pauses rather than
 * restarting the sample every burst.
 */
export function weaponLoopWindowMs(weapon: WeaponData, count: number): number {
    const perShot = weapon.fireSimultaneously || count <= 0
        ? weapon.reload : weapon.reload / count;
    const burst = weapon.burstCount > 0 ? weapon.burstReload : 0;
    return Math.max(perShot, burst, ORIGINAL_FRAME_MS) + LOOP_GRACE_MS;
}

/** The parts of a beam's weapon data a loop is derived from. */
export type LoopingBeam = Pick<WeaponData, 'sound' | 'loopSound'>;

/**
 * The weapon-fire loops that should be playing at simulation time
 * `simTime`: the sound id of every loop-flagged weapon that is
 *  - on a ship whose mirrored WeaponState says it is firing (the held
 *    trigger / AI intent — point defense fires without it) AND actually
 *    emitted a shot within its loop window (`lastFired`, stamped only
 *    when a shot really spawned, so a turret with no target or a weapon
 *    out of ammo is silent), or
 *  - the weapon of a beam that still exists (a beam keeps firing for its
 *    duration after the trigger is released; its sound keeps looping as
 *    long as it is drawn).
 *
 * Releasing the trigger therefore lets the loop go on the next frame, and
 * a weapon that stops shooting for any other reason lets it go within one
 * reload — "lets go": it finishes the iteration it is in (LoopPlayback).
 * Pure: the display system feeds it the mirrored state.
 */
export function wantedWeaponLoops(
    ships: Iterable<WeaponsState>,
    beams: Iterable<LoopingBeam>,
    simTime: number,
    weaponData: (id: string) => WeaponData | undefined,
): Set<string> {
    const wanted = new Set<string>();
    for (const weapons of ships) {
        for (const [id, state] of weapons) {
            if (state.lastFired === undefined) {
                continue;
            }
            const weapon = weaponData(id);
            if (!weapon?.loopSound || !weapon.sound
                || wanted.has(weapon.sound)) {
                continue;
            }
            const pointDefense = weapon.guidance === 'pointDefense'
                || weapon.guidance === 'pointDefenseBeam';
            if (!state.firing && !pointDefense) {
                continue;
            }
            if (simTime - state.lastFired
                <= weaponLoopWindowMs(weapon, state.count)) {
                wanted.add(weapon.sound);
            }
        }
    }
    for (const beam of beams) {
        if (beam.loopSound && beam.sound) {
            wanted.add(beam.sound);
        }
    }
    return wanted;
}

/** What to start and what to stop to make `playing` equal `wanted`. */
export interface LoopPlan {
    start: string[];
    stop: string[];
}

/**
 * The reconciliation itself: start every wanted loop that is not playing,
 * stop every playing loop that is not wanted. Sorted, so the order sounds
 * are started in never depends on Set insertion order.
 */
export function reconcileLoops(wanted: ReadonlySet<string>,
    playing: ReadonlySet<string> | ReadonlyMap<string, unknown>): LoopPlan {
    const start = [...wanted].filter(id => !playing.has(id)).sort();
    const stop = [...playing.keys()].filter(id => !wanted.has(id)).sort();
    return { start, stop };
}

/**
 * One playing loop. `stop` reports whether the loop is really gone:
 * @pixi/sound cannot stop an instance its auto-pause (window blur) has
 * paused — it has no source node to stop — so a stop can fail and must
 * be retried once the context runs again.
 */
export interface LoopVoice {
    /** Still playing (nothing else stopped it, it has not ended). */
    alive(): boolean;
    /** Stop it now; true once it is gone for good. */
    stop(): boolean;
    /**
     * Stop LOOPING: play the current iteration to its end, then end by
     * itself. False when it cannot (the caller then stops it outright).
     * Optional: a voice without it is always stopped outright.
     */
    release?(): boolean;
    /**
     * Undo a release while the last iteration is still playing: loop
     * again from where it is, with no restart and no second copy. False
     * when it cannot.
     */
    rearm?(): boolean;
}

/**
 * The loops this display world is playing, and the reconciliation that
 * keeps them equal to the wanted set: exactly one voice per sound id.
 *
 * WEAPON LOOPS PLAY WHOLE ITERATIONS. The maintainer's ruling: "Weapons
 * that fire with audio on a loop need to play in full loops of their
 * audio. We can't cut it early in the loop even if they stop firing."
 * So an id passed in `reconcile`'s `finish` set is, when it stops being
 * wanted, RELEASED rather than stopped — it plays to the end of the
 * iteration it is in and then ends by itself — and held in `finishing`
 * until it has. Wanted again before then, it is re-armed (loops on from
 * where it is): never restarted, never doubled. Everything else, and
 * every stopAll (teardown, focus/visibility change), stops at once.
 *
 * `startVoice` returns undefined when the sound is not loaded yet; the id
 * simply stays unplayed and is tried again next frame.
 */
export class LoopPlayback {
    readonly playing = new Map<string, LoopVoice>();
    /** Released loops playing out their last iteration, by sound id. */
    readonly finishing = new Map<string, LoopVoice>();
    /** Playing ids that finish their iteration when no longer wanted. */
    private readonly finishOnRelease = new Set<string>();
    /** Voices whose stop did not take yet (see LoopVoice.stop). */
    private readonly stopping = new Set<LoopVoice>();

    constructor(private readonly startVoice:
        (id: string) => LoopVoice | undefined) { }

    /**
     * @param finish The wanted ids that, once no longer wanted, finish
     * their current iteration instead of stopping (weapon loops). Read
     * every frame, so an id's last wanted frame decides.
     */
    reconcile(wanted: ReadonlySet<string>,
        finish: ReadonlySet<string> = new Set()) {
        this.retryStops();
        // A loop something else silenced (a `{ stop: true }` for the same
        // sound id, which @pixi/sound applies to every instance) is no
        // longer playing, whatever this map remembers: forget it, and the
        // plan below restarts it if it is still wanted. A finishing loop
        // that reached its end is done.
        for (const [id, voice] of this.playing) {
            if (!voice.alive()) {
                this.playing.delete(id);
            }
        }
        for (const [id, voice] of this.finishing) {
            if (!voice.alive()) {
                this.finishing.delete(id);
            }
        }
        for (const id of wanted) {
            if (finish.has(id)) {
                this.finishOnRelease.add(id);
            } else {
                this.finishOnRelease.delete(id);
            }
        }
        const plan = reconcileLoops(wanted, this.playing);
        for (const id of plan.stop) {
            const voice = this.playing.get(id)!;
            this.playing.delete(id);
            if (this.finishOnRelease.delete(id) && voice.release?.()) {
                this.finishing.set(id, voice);
            } else {
                this.stopVoice(voice);
            }
        }
        for (const id of plan.start) {
            const tail = this.finishing.get(id);
            if (tail) {
                if (tail.rearm?.()) {
                    this.finishing.delete(id);
                    this.playing.set(id, tail);
                }
                // Could not re-arm it (the context is paused): let it
                // finish, and start afresh once it has — never a second
                // copy over it.
                continue;
            }
            const voice = this.startVoice(id);
            if (voice) {
                this.playing.set(id, voice);
            }
        }
        for (const id of this.finishOnRelease) {
            if (!this.playing.has(id)) {
                this.finishOnRelease.delete(id);
            }
        }
        return plan;
    }

    /**
     * Stop every loop at once, finishing ones included. The next
     * reconcile starts afresh whatever is still wanted — what a
     * visibility change and a teardown both need.
     */
    stopAll() {
        for (const voice of this.playing.values()) {
            this.stopVoice(voice);
        }
        for (const voice of this.finishing.values()) {
            this.stopVoice(voice);
        }
        this.playing.clear();
        this.finishing.clear();
        this.finishOnRelease.clear();
        this.retryStops();
    }

    /** Voices still waiting for their stop to take (for tests/debug). */
    get pendingStops() {
        return this.stopping.size;
    }

    private stopVoice(voice: LoopVoice) {
        if (!voice.stop()) {
            this.stopping.add(voice);
        }
    }

    private retryStops() {
        for (const voice of this.stopping) {
            if (voice.stop()) {
                this.stopping.delete(voice);
            }
        }
    }
}

/**
 * Display-local loop demands: owner key -> sound id, e.g.
 * `'player-death' -> SOUND_EXPLOSION_LOOP`. An owner sets its entry while
 * it wants the loop and deletes it when it does not; the sound plugin
 * plays the union of these and the weapon loops. Set-if-absent by every
 * plugin that writes it (`loopDemand`), so plug-in build order is moot.
 */
export const LoopDemandResource =
    new Resource<Map<string, string>>('LoopDemand');

export function loopDemand(world: World): Map<string, string> {
    let demand = world.resources.get(LoopDemandResource);
    if (!demand) {
        demand = new Map();
        world.resources.set(LoopDemandResource, demand);
    }
    return demand;
}
