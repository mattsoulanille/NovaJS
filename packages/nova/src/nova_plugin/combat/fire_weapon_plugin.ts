import * as t from 'io-ts';
import { Animation } from 'novadatainterface/animation';
import { Gettable } from 'novadatainterface/gettable';
import { isNovaIDNotFoundError } from 'novadatainterface/nova_id_not_found_error';
import { WeaponData } from 'novadatainterface/weapon_data';
import { Emit, EmitFunction, Entities, GetEntity, RunQuery, RunQueryFunction, UUID } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Random, RandomResource } from 'nova_ecs/plugins/random_plugin';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { IdFactory, IdFactoryResource, StagedWeaponIds } from '../core/index.js';
import { EntityMap } from 'nova_ecs/entity_map';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { DeltaResource } from 'nova_ecs/plugins/delta_plugin';
import { MovementState, MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { markerType, SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { Time, TimeResource } from 'nova_ecs/plugins/time_plugin';
import { Provide } from 'nova_ecs/provide';
import { Query } from 'nova_ecs/query';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { DefaultMap } from 'nova_ecs/utils';
import { SingletonComponent } from 'nova_ecs/world';
import { SimulationGameDataInterface } from '../../client/gamedata/simulation_game_data.js';
// FIRST among the local imports, and deliberately: the leaf module that
// holds OwnerComponent/SourceComponent/VulnerableToPD, which everything
// below (hostility, flock, ship_plugin and their dependencies) also
// wants. See weapon_components.ts for why they do not live here.
import {
    OwnerComponent, OwnerComponentType, SourceComponent, VulnerableToPD,
} from '../ship/index.js';
import { AnimationComponent } from '../core/index.js';
import {
    blindSpotBlocksQuadrant, getQuadrant, isQuadrantGuidance,
} from './blind_spots.js';
import { CloakActiveComponent, CloakScannerComponent, isTargetable } from '../ship/index.js';
import { ExplodingComponent, ExplodingFinishedSystem } from '../ship/index.js';
import { DisabledComponent } from '../ship/index.js';
import { applyExitPoint, closestExitPointIndex, ExitPointData, getExitPointData } from './exit_point.js';
import { FiringGroup, FiringGroupComponent } from '../ship/index.js';
import { isInFlock } from './flock.js';
import { SimulationGameDataResource, SystemIdResource } from '../core/index.js';
import { GovtComponent } from '../core/index.js';
import { firstOrderLead, firstOrderWithFallback } from './guidance.js';
import { isHostileTarget } from './hostility.js';
import { PointDefenseCandidate, selectPointDefenseTarget } from './point_defense.js';
import { certainlyBeyond } from '../core/index.js';
import { ShipComponent, ShipDataComponent, ShipDataProvider } from '../ship/index.js';
import { TargetComponent } from '../ship/index.js';
import { WeaponsStateComponent } from '../ship/index.js';
import { aimsTurretsAccurately } from '../player/index.js';
import { ShotEnd, submunitionFires } from './submunition_rule.js';

// Re-exported so the ~40 existing importers of these three keep working.
export { OwnerComponent, SourceComponent, VulnerableToPD };
export type { OwnerComponentType };

export const WeaponConstructors = new Resource<Map<WeaponData['type'],
    { new(data: WeaponData, runQuery: RunQueryFunction): WeaponEntry }>>('WeaponConstructors');

export const WeaponEntries = new Resource<Gettable<WeaponEntry | undefined>>('WeaponEntries');

/**
 * Fires weapon `id`'s submunitions from the shot `source`, which ended as
 * `end` says; whether each submunition entry fires at all is
 * submunitionFires' call (submunition_rule.ts).
 */
export type FireSubsFunction = (id: string, source: string, end: ShotEnd) => Entity[];
export const FireSubs = new Resource<FireSubsFunction>('FireSubs');

export const SubCounts = new Component<DefaultMap<string, number>>('SubCount');

export interface WeaponLocalState {
    lastFired: number,
    burstCount: number,
    reloadingBurst: boolean,
    wasFiring: boolean,
    exitIndex: number,
    /**
     * The uuid of the last entity this weapon spawned (the last of a
     * simultaneous volley), for wëap Flags3 0x0004 "can't fire another
     * shot of this type until the previous one expires or hits
     * something". Optional (absent until the first shot) so the default
     * state, older snapshots and the wire shape are unchanged.
     */
    lastShot?: string,
}
type WeaponsLocalState = DefaultMap<string, WeaponLocalState>;
export const WeaponsComponent = new Component<WeaponsLocalState>('WeaponsComponent')
export function defaultWeaponLocalState(): WeaponLocalState {
    return {
        lastFired: 0,
        burstCount: 0,
        reloadingBurst: false,
        wasFiring: false,
        exitIndex: 0,
    };
}
// Tracker issue: the local weapon state map is only rebuilt when
// WeaponsStateComponent is REASSIGNED (Provide change detection); an
// in-place change to the set or count of weapons leaves it stale. See
// bay_plugin.ts for why consumeAmmo deliberately relies on that.
export const WeaponsComponentProvider = Provide({
    name: "WeaponsComponentProvider",
    provided: WeaponsComponent,
    update: [WeaponsStateComponent],
    args: [WeaponsStateComponent] as const,
    factory() {
        return new DefaultMap(defaultWeaponLocalState);
    },
    // #237 pin: the pair no longer shares state (the provider declares
    // its write with SetComponent now), but the edge carries the
    // transitive order — FireWeaponPlugin registers after DeathPlugin.
    after: [ExplodingFinishedSystem],
});

/**
 * Picks the exit point this shot leaves the ship from, and advances the
 * weapon's round-robin cursor.
 *
 * Normally a ship cycles through the exit points of the weapon's
 * `exitType` one shot at a time. A weapon with wëap Flags3 0x0010
 * (`firesFromClosestToTarget` — the Ion Cannons) instead fires from
 * whichever exit point is closest to the target, when it has one; with
 * no target it falls back to the round-robin cursor.
 *
 * `targetPosition` is the firer's current target's position, or
 * undefined when it has none. All of this is simulation state (the
 * spawned shot's position), so the choice is pure geometry over
 * replicated state — see closestExitPointIndex.
 *
 * Seam: a point-defense weapon picks its own victim later in
 * fireFromEntity, so a PD weapon carrying the flag would aim from the
 * exit point nearest the ship's SELECTED target rather than the PD
 * victim. No stock weapon is both (only the two Ion Cannons set the
 * flag, and they are beamTurrets), and the selected target is
 * replicated either way, so this stays deterministic.
 */
export function getNextExitpoint(sourceMovement: MovementState, sourceAnimation: Animation,
    weapon: WeaponData, localState: WeaponLocalState,
    targetPosition?: Position) {
    let exitPoint = sourceMovement.position;
    let exitPointData: ExitPointData = {
        position: [0, 0, 0],
        upCompress: [0, 0],
        downCompress: [0, 0],
    }
    if (weapon.exitType !== "center") {
        const exitPoints = sourceAnimation.exitPoints;
        const offset = exitPoints[weapon.exitType];
        // A shän can define no exit points at all for this weapon's
        // class, in which case there is nothing to pick from and the
        // shot leaves from the ship's centre. Skipping the whole block
        // (rather than falling through it) is what keeps `% 0` from
        // writing NaN into exitIndex: that cursor is replicated,
        // wire-serialized state, and JSON turns NaN into null, so a
        // peer restoring the snapshot would not agree with the
        // incumbents about it.
        if (offset.length > 0) {
            if (weapon.firesFromClosestToTarget && targetPosition) {
                localState.exitIndex = closestExitPointIndex(
                    offset, exitPoints, sourceMovement.position,
                    sourceMovement.rotation, targetPosition);
            } else {
                localState.exitIndex =
                    ((localState.exitIndex ?? 0) + 1) % offset.length;
            }

            exitPointData = getExitPointData(sourceAnimation, weapon, localState);
            exitPoint = exitPoint.add(
                applyExitPoint(exitPointData, sourceMovement.rotation)
            ) as Position;
        }
    }

    return { exitPoint, exitPointData };
}

/**
 * The movement state of a target that can still be aimed at, or
 * undefined when there is nothing left to aim at.
 *
 * A TargetComponent holds a uuid, and that uuid outlives what it names.
 * The target's entity can be deleted mid-tick (it jumped out, was
 * captured, was cleaned up by its own death AI) while every
 * TargetComponent naming it still says so: DeleteEvent is QUEUED, so
 * TargetRemovedSystem does not clear those references until the current
 * event finishes, and a rollback restore drops the queued DeleteEvent
 * entirely (World.clearEventQueue). An exploding target is the same
 * situation a beat earlier — it still exists, with a position, but it is
 * a fireball rather than something to shoot at, and every lock on it
 * breaks (DropExplodingTargetSystem) on a tick boundary that firing code
 * must not straddle.
 *
 * Resolving through here rather than trusting the uuid means aiming
 * asks "is there something there?" instead of "was there something
 * there?". Deterministic: entity existence, ExplodingComponent and
 * MovementStateComponent are all replicated simulation state, so every
 * peer answers this identically for a given tick.
 */
export function liveTargetMovement(entities: EntityMap,
    target: string | undefined): MovementState | undefined {
    if (target === undefined) {
        return undefined;
    }
    const entity = entities.get(target);
    if (!entity || entity.components.has(ExplodingComponent)) {
        return undefined;
    }
    return entity.components.get(MovementStateComponent);
}

export function sampleInaccuracy(accuracy: number, random: Random) {
    return 2 * (random.next() - 0.5) * accuracy * (2 * Math.PI / 360);
}

/**
 * Returns evenly spaced angles centered around zero with a given spacing
 * inbetween.
 */
export function getEvenlySpacedAngles(spacing: number, count: number) {
    const angles: Angle[] = [];
    let offset: number;
    if (count % 2 === 1) {
        angles.push(new Angle(0));
        offset = spacing;
        count--;
    } else {
        offset = spacing / 2;
    }

    for (let i = 0; i < count / 2; i++) {
        const angle = i * spacing + offset;
        angles.push(new Angle(angle));
        angles.push(new Angle(-angle));
    }
    return angles;
}

function getRandomInCone(angle: number, count: number, random: Random) {
    const angles: Angle[] = [];
    for (let i = 0; i < count; i++) {
        angles[i] = new Angle((2 * random.next() - 1) * angle);
    }
    return angles;
}

const FireFromEntityQuery = new Query([Optional(WeaponsComponent),
    Entities, MovementStateComponent, AnimationComponent, UUID,
Optional(OwnerComponent), Optional(TargetComponent),
// The firer's ship class, for its shïp-level turret blind spots. Optional
// because plenty of things fire without being ships (projectiles that
// submunition, bay fighters before ShipDataProvider has run); those simply
// have no ship-level blind spots.
Optional(ShipDataComponent), GetEntity] as const, 'FireFromEntityQuery');

const SubsQuery = new Query([WeaponEntries, MovementStateComponent, Optional(SubCounts),
    Optional(OwnerComponent), Optional(TargetComponent), GetEntity] as const);

const ConstructorQuery = new Query([Entities, Emit, WeaponEntries,
    RandomResource, IdFactoryResource, TimeResource,
    SimulationGameDataResource, Optional(SystemIdResource),
    SingletonComponent] as const);

const PointDefenseQuery = new Query([MovementStateComponent, Optional(OwnerComponent),
    UUID, Optional(TargetComponent), GetEntity, VulnerableToPD] as const);

/**
 * Attaches (and removes) the point defense marker on SHIPS, from the
 * ship class's own data.
 *
 * A step system rather than a Provide or an entity deriver because the
 * marker is a MARKER: its data is `undefined`, which both of those
 * mechanisms read as "not derivable yet". It also has to cope with
 * entities that never pass through staging — a bay fighter is built by
 * BayWeaponEntry.fire and dropped straight into the entity map, so the
 * provider systems are the only thing that ever completes it, and bay
 * fighters are the main reason this feature exists.
 *
 * DETERMINISM: reads only ShipDataComponent, which is derived from
 * synced game data on every peer, and writes an idempotent marker. No
 * PRNG, no clock, no dependence on iteration order. Ordered after
 * ShipDataProvider so a freshly inserted ship is marked on the same tick
 * its data lands rather than the one after.
 */
export const ShipPointDefenseVulnerabilitySystem = new System({
    name: 'ShipPointDefenseVulnerability',
    // WeaponsComponentProvider is a #237 pin (shared: WeaponsComponent,
    // WeaponsStateComponent).
    after: [ShipDataProvider, WeaponsComponentProvider],
    args: [ShipDataComponent, GetEntity] as const,
    step(shipData, entity) {
        const vulnerable = shipData.vulnerableTo.includes('pointDefense');
        if (vulnerable === entity.components.has(VulnerableToPD)) {
            return;
        }
        if (vulnerable) {
            entity.components.set(VulnerableToPD, undefined);
        } else {
            entity.components.delete(VulnerableToPD);
        }
    },
});

export abstract class WeaponEntry {
    protected entities: EntityMap;
    protected emit: EmitFunction;
    protected random: Random;
    protected ids: IdFactory;
    /**
     * The world's live simulation clock. Held as a reference, exactly
     * like `entities` and `random` above: TimeSystem mutates the Time
     * object in place and the snapshot policy restores it with
     * Object.assign, so the identity never changes and this always
     * reads the CURRENT tick. Weapon spawning needs it because locking
     * a guided missile on a ship is a timestamped act of war
     * (provokeGuidedLock).
     */
    protected time: Time;
    /**
     * The simulation's game data, held for the same reason `time` is:
     * point defense now has to ask the one hostility rule (hostility.ts)
     * whether a PD-vulnerable SHIP in reach is an enemy, and that rule
     * reads government data.
     */
    protected gameData: SimulationGameDataInterface;
    /**
     * The world's own system, for the same hostility question: a criminal
     * record is judged by the law of the system it is in (reference A14,
     * reputation/local_law.ts). Constant for the world's lifetime.
     */
    protected systemId: string | undefined;
    protected abstract pointDefenseRangeSquared: number;
    constructor(public data: WeaponData, protected runQuery: RunQueryFunction) {
        let weaponEntries: Gettable<WeaponEntry | undefined>;
        [this.entities, this.emit, weaponEntries, this.random, this.ids,
            this.time, this.gameData, this.systemId] =
            runQuery(ConstructorQuery)[0];
        if ('submunitions' in this.data) {
            for (const sub of this.data.submunitions) {
                weaponEntries.get(sub.id);
            }
        }
    }

    /**
     * Where an aimed shot points at `target`: the exact intercept
     * (firstOrderWithFallback) for the quadrant turrets' in-arc aim and
     * projectile point defence, the FIRST-ORDER lead (firstOrderLead) for
     * a projectile turret (wëap Guidance 4), MEASURED (reference "A
     * turret's lead, and a lead into a blind sector (the T leftover),
     * wave 50"; only the Guidance-4 turret was flown, so the others keep
     * the intercept). `accurate` (a player's own ship with the
     * Enhancements toggle "Accurate turret aim" on, player/turret_aim.ts
     * aimsTurretsAccurately) keeps that turret on the exact intercept:
     * Matthew's ruling, the original's turrets are rather inaccurate.
     * BeamWeaponEntry points every beam straight at its target instead.
     */
    protected guidance(exitPoint: Position, source: MovementState,
        target: MovementState, accurate = false) {
        if (this.data.guidance === 'turret' && !accurate) {
            return firstOrderLead(exitPoint, source.velocity, target.position,
                target.velocity, this.data.shotSpeed);
        }
        return firstOrderWithFallback(exitPoint, source.velocity, target.position,
            target.velocity, this.data.shotSpeed);
    }

    /**
     * Spawns one shot. `silent` suppresses this shot's firing sound
     * without changing anything else about it — see fireSubs, which uses
     * it so a submunition burst is heard once rather than once per child.
     * Purely an output concern: SoundEvent carries no simulation state,
     * so silencing a shot cannot move the sim.
     *
     * `aimOffset` is the inaccuracy already folded into `angle`, in
     * radians, for shots that are re-aimed after they spawn: a beam is
     * rebuilt from its firing ship every tick and must keep the SAME
     * error it left with (EVN Bible: inaccuracy is the error "as it
     * leaves the ship"), so BeamWeaponEntry stores it. Projectiles carry
     * their heading and ignore it.
     */
    abstract fire(position: Position, angle: Angle, owner?: string,
        target?: string, source?: string, sourceVelocity?: Vector,
        exitPointData?: ExitPointData, silent?: boolean,
        aimOffset?: number): Entity | undefined;

    /**
     * Stamps a spawned weapon entity (projectile, beam, bay fighter,
     * submunition) with the firer's firing group so its hits are
     * filtered by the friendly-fire pair predicate (see
     * firing_group.ts). The group is the firer's own group when it has
     * one (fleet members, bay fighters, parent projectiles), else the
     * firer's owner-chain root; the govt rides along for the same-govt
     * immunity clause (projectiles only, SAME_GOVT_FIRING_IMMUNITY).
     */
    protected stampFiringGroup(spawned: Entity, firer: Entity,
        ownerUuid: string) {
        const inherited = firer.components.get(FiringGroupComponent);
        const group = inherited?.group ?? ownerUuid;
        const govt = inherited?.govt
            ?? firer.components.get(GovtComponent)?.id;
        const firingGroup: FiringGroup =
            govt === undefined ? { group } : { group, govt };
        spawned.components.set(FiringGroupComponent, firingGroup);
    }

    /**
     * What this point defense turret shoots at THIS instant, out of the
     * live world: the Bible's "incoming guided weapons and nearby ships"
     * (wëap Guidance 9/10, ~:3103), missiles first.
     *
     * This half gathers facts; point_defense.ts makes the choice (and is
     * unit-tested on its own). The split is what keeps the priority and
     * tie-breaking rules readable and testable without a world.
     *
     * WHOSE ENEMIES the turret fights: its OWNER's. A bay fighter's or a
     * hired escort's turret judges hostility from the point of view of
     * the ship it belongs to, so an escort's point defense engages the
     * enemies its master is at war with rather than the (usually empty)
     * politics of a hireling. An independent NPC owns itself and so
     * judges for itself.
     *
     * Cost: hostility is asked only about SHIPS that are already inside
     * the turret's reach — a handful of entities on a busy tick, and
     * zero on a quiet one. Distance is measured first for exactly that
     * reason.
     */
    private choosePointDefenseTarget(exitPoint: Position, source: string,
        ownerUuid: string, firer: Entity) {
        const viewerUuid = ownerUuid ?? source;
        const viewerEntity = this.entities.get(viewerUuid) ?? firer;
        const myScanner = viewerEntity.components.get(CloakScannerComponent);
        const getEntity = (uuid: string) => this.entities.get(uuid);

        const candidates: (PointDefenseCandidate
            & { movement: MovementState })[] = [];
        const range = Math.sqrt(this.pointDefenseRangeSquared);
        for (const [movement, candidateOwner, uuid, candidateTarget, entity]
            of this.runQuery(PointDefenseQuery)) {
            // Far candidates are rejected without building the offset;
            // the exact test below decides the rest.
            const position = movement.position;
            if (certainlyBeyond(position.x, exitPoint.x, range)
                || certainlyBeyond(position.y, exitPoint.y, range)) {
                continue;
            }
            const distanceSquared =
                position.subtract(exitPoint).lengthSquared;
            if (distanceSquared > this.pointDefenseRangeSquared) {
                continue;
            }
            const isShip = entity.components.has(ShipComponent);
            if (isShip) {
                // The same three filters the nearest-hostile scan
                // applies (hostility.ts): a hulk in its death throes, a
                // ship dead in space, and a ship this one cannot see are
                // not targets. Without them a hostile wreck's stale
                // 'attack' posture could keep a turret firing into it.
                if (entity.components.has(ExplodingComponent)
                    || entity.components.has(DisabledComponent)
                    || !isTargetable(
                        entity.components.get(CloakActiveComponent),
                        myScanner)
                    // shïp Flags2 0x0004 (A13 wave 41; GUESS for PD).
                    || entity.components.get(ShipDataComponent)
                        ?.untargetable) {
                    continue;
                }
            }
            candidates.push({
                uuid,
                kind: isShip ? 'fighter' : 'missile',
                distanceSquared,
                owner: candidateOwner?.owner ?? uuid,
                target: candidateTarget?.target,
                hostile: isShip && isHostileTarget(uuid, entity, {
                    viewerUuid,
                    viewerEntity,
                    entities: this.entities,
                    gameData: this.gameData,
                    now: this.time.time,
                    systemId: this.systemId,
                }),
                // Checked for MISSILES too, and deliberately: a shot
                // fired by our escort carries that escort as its owner,
                // so only the flock walk (not the owner comparison)
                // recognises it as ours.
                inFlock: isInFlock(uuid, viewerUuid, getEntity)
                    || (viewerUuid !== source
                        && isInFlock(uuid, source, getEntity)),
                movement,
            });
        }

        return selectPointDefenseTarget(candidates, {
            owner: viewerUuid,
            source,
            rangeSquared: this.pointDefenseRangeSquared,
        });
    }

    /**
     * `weaponTarget` is the target the firing AI chose for THIS weapon
     * (its synced WeaponState.target), when it chose one. It takes
     * precedence over the ship's own TargetComponent lock for aiming:
     * the two only differ for an escort flying formation, whose
     * front-quadrant turrets each pick their own victim
     * (escort_command_plugin's formation rule) while the ship holds no
     * lock at all. Aiming off the empty lock is what sent those shots
     * straight out of the nose ("fires straight ahead if no target",
     * EVN Bible wëap Guidance 7) instead of at the chosen hostile.
     * WeaponsSystem passes it for AI ships only; a pilot aims with the
     * ship's lock, which is what they selected.
     */
    fireFromEntity(source: string, inaccuracy = true,
        weaponTarget?: string): Entity | undefined {
        // A per-entity runQuery is answered from nova_ecs's query cache
        // (QueryCacheEntry.getResultForEntity), so this is cheap per shot.
        const results = this.runQuery(FireFromEntityQuery, source);
        if (!results[0]) {
            return undefined;
        }
        let [weapons, entities, movement, animation, uuid, owner, targetVal,
            shipData, entity] = results[0];
        if (!owner) {
            owner = {owner: uuid};
        }
        let target = weaponTarget ?? targetVal?.target;
        if (!weapons) {
            weapons = new DefaultMap(() => ({
                lastFired: 0,
                burstCount: 0,
                reloadingBurst: false,
                wasFiring: false,
                exitIndex: 0,
            }));
            entity.components.set(WeaponsComponent, weapons);
        }

        const weapon = weapons.get(this.data.id);

        // Resolved BEFORE the exit point is chosen: a weapon with wëap
        // Flags3 0x0010 fires from the exit point nearest the target.
        const targetMovement = liveTargetMovement(entities, target);

        const { exitPoint, exitPointData } = getNextExitpoint(
            movement, animation, this.data, weapon, targetMovement?.position);

        let angle = movement.rotation;
        if ('guidance' in this.data) {
            // Gated on the target STILL BEING THERE, not on the target
            // uuid being set. A turret aims with targetMovement below and
            // silently keeps `angle` — the ship's own heading — when it
            // resolves to nothing, so a lock naming a destroyed ship used
            // to fire one full-strength shot straight out of the nose:
            // visible, and damaging whatever happened to be in front.
            // Nothing to aim at means nothing fires, exactly as if the
            // ship had never had a target.
            if (!targetMovement && (this.data.guidance === 'beamTurret'
                || this.data.guidance === 'turret')) {
                return undefined;
            }

            if (this.data.guidance === 'rearQuadrant') {
                angle = angle.add(Math.PI);
            }

            const quadrant = targetMovement
                ? getQuadrant(movement.position, movement.rotation,
                    targetMovement.position)
                : undefined;

            // Blind spots (wëap Flags 0x1000/0x2000/0x4000 OR'ed with
            // the firing ship's shïp Flags 0x1000/0x2000/0x4000).
            //
            // Deliberately gated on WHERE THE TARGET IS and nothing
            // else — see blind_spots.ts. The check sits BEFORE the
            // aiming below rather than after it because the aimed angle
            // is not what the rule tests: a rear-blind turret leading a
            // target off its bow fires happily even when the lead angle
            // swings behind the beam. MEASURED (reference "A turret's
            // lead, and a lead into a blind sector (the T leftover), wave
            // 50", finding 2): the rear-blind Kit Fast Blind Ring fired
            // with its aim 20 deg into the rear sector while the target
            // sat at -128 / -134 deg, and held fire once the target
            // passed about 135.
            //
            // What a blind target COSTS depends on the guidance, and the
            // rule is one sentence: a target in a blind sector is no
            // target at all, as far as aiming goes.
            //  - A full turret (guidance 3/4) does not fire without a
            //    target (the targetless return above), so it holds fire.
            //    Returning here rather than clearing `firing` means the
            //    weapon burns no ammo and its reload clock does not
            //    restart (WeaponsSystem only stamps those when a shot
            //    comes back), so the turret is ready the instant the
            //    target crosses back into a live sector.
            //  - A quadrant turret (guidance 7/8) "fires straight ahead
            //    if no target" (EVN Bible wëap Guidance 7, ~:3100), so it
            //    fires straight along its axis — out of the nose for 7,
            //    out of the tail for 8 — exactly as it does at a target
            //    merely outside its ±45° arc. Matthew's playtest report
            //    (2026-11-26): "Railguns should still fire (straight
            //    forward) if the target is not within their firing
            //    arc." The stock Fixed Railguns (nova:156-158) are
            //    guidance 7 and ride on rear-blind hulls (the Aurora
            //    Cruisers nova:154/247-255, the Thunderforge nova:380, and
            //    any rear-blind hull a pilot fits them to, such as the
            //    Fed Destroyer nova:141), where a target astern used to
            //    silence them outright. A blind spot stops a turret AIMING into
            //    a sector; it never stopped a gun firing forward.
            const blind = blindSpotBlocksQuadrant({
                guidance: this.data.guidance,
                weaponBlindSpots: this.data.turretBlindSpots,
                shipBlindSpots: shipData?.turretBlindSpots,
                targetQuadrant: quadrant,
            });
            if (blind && !isQuadrantGuidance(this.data.guidance)) {
                return undefined;
            }

            if ((this.data.guidance === quadrant
                || this.data.guidance === 'turret'
                || this.data.guidance === 'beamTurret')
                && targetMovement && !blind) {
                angle = this.guidance(exitPoint, movement, targetMovement,
                    aimsTurretsAccurately(entity));
            }

            if (this.data.guidance === 'pointDefense' ||
                this.data.guidance === 'pointDefenseBeam') {
                const chosen = this.choosePointDefenseTarget(
                    exitPoint, source, owner.owner, entity);
                if (!chosen) {
                    return undefined;
                }
                angle = this.guidance(exitPoint, movement, chosen.movement);
                target = chosen.uuid;
            }
        }

        // The weapon's error as it leaves the ship (wëap Inaccuracy,
        // ~:3137-3143): "ignored for guidance-10 point defense beams",
        // so those draw nothing and aim true. A NEGATIVE Inaccuracy on an
        // unguided gun ("fires to the side by this angle") fires STRAIGHT
        // too: MEASURED (reference "Negative Inaccuracy (E2), wave 40"),
        // an Inaccuracy -30 gun on the Shuttle shän's ±3 px exits put
        // every shot within a degree of the heading, one gun or two. What
        // makes the Bible's side angle appear is not known (GUESS: some
        // other field), so until a rig shows it there is no side angle
        // and no spread. Everything else gets the uniform random error.
        // Which branch a weapon takes is a property of its synced data,
        // so every peer draws the PRNG the same number of times.
        let aimOffset = 0;
        const firesStraight = this.data.guidance === 'pointDefenseBeam'
            || (this.data.firesAtFixedAngle
                && this.data.guidance === 'unguided');
        if (inaccuracy && !firesStraight) {
            aimOffset = sampleInaccuracy(this.data.accuracy, this.random);
            angle = angle.add(aimOffset);
        }

        const spawned = this.fire(exitPoint, angle, owner.owner ?? source,
            target, source, movement.velocity, exitPointData, false,
            aimOffset);
        if (spawned) {
            this.stampFiringGroup(spawned, entity, owner.owner);
        }
        return spawned;
    }

    fireSubs(source: string, end: ShotEnd, position?: Position): Entity[] {
        let [weaponEntries, movement, subCounts, owner, target, sourceEntity]
            = this.runQuery(SubsQuery, source)[0];
        if (!('submunitions' in this.data)) {
            return [];
        }
        if (!owner) {
            owner = {owner: source};
            // Does this really need to be set?
            sourceEntity.components.set(OwnerComponent, owner);
        }
        if (!subCounts) {
            subCounts = new DefaultMap(() => 0);
            // Does this really need to be set?
            sourceEntity.components.set(SubCounts, subCounts);
        }

        const subs: Entity[] = [];
        for (const sub of this.data.submunitions) {
            // wëap SubLimit (EVN Bible ~:3280-3284): "If you have defined
            // a recursively-submunitioning weapon (i.e. one which splits
            // into more copies of itself) this field will allow you to
            // limit the number of recursive splits that happen. This
            // field is ignored if the weapon is not recursively
            // submunitioning." So it applies ONLY when the sub is this
            // very weapon — arpia's "Explosion" (sub limit -1, the usual
            // unused value) is not recursive and must sub regardless —
            // and it counts SPLITS: subCounts holds how many ancestors
            // of this shot were themselves spawned as this sub, i.e.
            // which generation this shot is, and a limit of L allows
            // generations 0..L-1 to split, L splits in all. A recursive
            // weapon with a limit of 0 or less makes no recursive splits
            // at all: an unbounded chain of copies is an entity explosion
            // nobody asks for, and every recursive weapon in the stock
            // data and 27 plug-ins carries a positive limit (2..375).
            if (sub.id === this.data.id
                && subCounts.get(sub.id) >= Math.max(sub.limit, 0)) {
                continue;
            }

            const angles = sub.theta < 0
                ? getEvenlySpacedAngles(Math.abs(sub.theta), sub.count)
                : getRandomInCone(sub.theta, sub.count, this.random);

            const subWeapon = weaponEntries.getCached(sub.id);
            if (!subWeapon) {
                continue;
            }
            // A direct hit subs only with wëap ProxRadius > 0 (a NovaJS
            // departure); an expiry only without wëap Flags2 0x0020
            // (submunition_rule.ts).
            if (!submunitionFires(this.data, sub, end)) {
                continue;
            }

            // One firing sound for the whole burst, not one per child: a
            // wëap that submunitions into a dozen rockets stacked a dozen
            // copies of the same sample on the same frame, which is just
            // loud. Tracked per SUBMUNITION ENTRY rather than per
            // fireSubs call so a projectile that subs into two different
            // weapons still plays each of their sounds once; and kept as
            // a local, so a sub that itself submunitions gets its own
            // fresh tracker and each generation is heard once.
            //
            // Deliberately NOT hoisted to "once per weapon per frame":
            // a burst weapon firing N shots over N frames must still be
            // heard N times, and each of those is a separate fire call.
            let soundPlayed = false;
            for (let i = 0; i < sub.count; i++) {
                const angle = angles[i] || new Angle(0);
                const subEntity = subWeapon.fire(position ?? movement.position,
                    movement.rotation.add(angle), owner.owner,
                    target?.target, source, undefined, undefined,
                    /* silent */ soundPlayed);
                if (subEntity) {
                    // Keyed off an actual spawn, so a first child that
                    // fails to spawn does not swallow the burst's sound.
                    soundPlayed = true;
                    subs.push(subEntity);
                    this.stampFiringGroup(subEntity, sourceEntity,
                        owner.owner);
                    const newCounts = new DefaultMap(() => 0, subCounts);
                    newCounts.set(sub.id, newCounts.get(sub.id) + 1);
                    subEntity.components.set(SubCounts, newCounts);
                }
            }
        }
        return subs;
    }
}

export const FireWeaponPlugin: Plugin = {
    name: 'FireWeaponPlugin',
    build(world) {
        const gameData = world.resources.get(SimulationGameDataResource);
        if (!gameData) {
            throw new Error('Expected SimulationGameDataResource to exist');
        }

        const runQuery = world.resources.get(RunQuery);
        if (!runQuery) {
            throw new Error('Expected RunQuery to exist');
        }

        const deltaMaker = world.resources.get(DeltaResource);
        if (!deltaMaker) {
            throw new Error('Expected DeltaMaker to exist');
        }
        deltaMaker.addComponent(OwnerComponent, {
            componentType: OwnerComponentType,
        });

        // Firing groups are simulation state (weapon hits depend on
        // them), so they are serializer-registered: hashed for desync
        // detection, snapshotted for rollback, carried on the wire.
        deltaMaker.addComponent(FiringGroupComponent, {
            componentType: FiringGroup,
        });

        // SourceComponent must be serializer-registered to reach the
        // DISPLAY world at all. SimulationBridgeHost.snapshot() encodes
        // only the components the serializer knows
        // (`serializer.hasComponent`), so an unregistered component is
        // silently dropped from every simulation frame — and a display
        // system that queries it then matches NOTHING, with no error
        // anywhere. This is the same class of bug CreateTime had (see
        // create_time.ts); here it broke two display consumers:
        //   - hail_dialog_plugin's bay-fighter test
        //     (`components.has(SourceComponent)`) was always false, so a
        //     player-launched bay fighter was mislabelled "Hired Escort:"
        //     with escort-management buttons it has no state for.
        //   - ship_animation_plugin's ActiveBeamsQuery
        //     ([SourceComponent, BeamDataComponent]) could never match,
        //     so a ship's weapon glow dropped as soon as the fire key was
        //     released instead of lasting the beam's shot duration.
        // It is NOT registered through deltaMaker: DeltaMaker's default
        // delta path drafts component data with immer, which needs an
        // objectish value, and this component holds a bare string.
        // Serializer registration is all the bridge (and the wire/hash
        // paths) needs.
        //
        // Registration does not change rollback-snapshot or wire-snapshot
        // behaviour: configureSnapshotPolicies sets SourceComponent's
        // policy ('share') and wire codec (passthroughWire<string>())
        // explicitly, and explicit entries are consulted BEFORE the
        // serializer-registered default (snapshot_plugin's
        // snapshotComponents / wireSnapshotComponents).
        //
        // The serializer resource is guaranteed here: DeltaResource above
        // is required, and DeltaPlugin builds SerializerPlugin.
        const serializer = world.resources.get(SerializerResource);
        if (!serializer) {
            throw new Error('Expected a serializer to register SourceComponent');
        }
        serializer.addComponent(SourceComponent, t.string);

        // VulnerableToPD is registered the same way, and for the same
        // reason: a MARKER's data is `undefined`, and DeltaMaker's
        // default delta path calls immer's createDraft on every
        // registered component's data, which throws on anything that is
        // not objectish. That never bit while only PROJECTILES carried
        // the marker (projectiles hold no MultiplayerData, so they never
        // reach DeltaMaker.getDelta); the moment ships carry it — which
        // is the whole point of shïp Flags2 0x0008 — every delta-synced
        // ship went through that path.
        //
        // Nothing is lost by not sending it. The marker is DERIVED, not
        // authored: from the ship class's data on every peer every step
        // (ShipPointDefenseVulnerabilitySystem) and from the weapon's
        // data at spawn for projectiles, both off synced game data. And
        // serializer registration is what the wire-snapshot, rollback
        // and desync-hash paths actually consult.
        serializer.addComponent(VulnerableToPD, markerType);

        world.addSystem(WeaponsComponentProvider);
        // Marks PD-vulnerable ship classes (shïp Flags2 0x0008) so point
        // defense turrets can see the "nearby ships" half of their prey.
        world.addSystem(ShipPointDefenseVulnerabilitySystem);
        world.addComponent(VulnerableToPD);
        world.addComponent(WeaponsComponent);
        world.addComponent(OwnerComponent);
        world.addComponent(SourceComponent);
        world.addComponent(FiringGroupComponent);
        world.resources.set(WeaponConstructors, new Map());
        const weaponConstructors = world.resources.get(WeaponConstructors)!;

        // Dev-build diagnostic for the unstaged-closure pattern (#279,
        // the class behind #240): an entry built straight from `get`
        // carries only its wëap, so a bay launches fighters whose hull
        // sprite sheet lands on a load-timing-dependent tick and a
        // projectile's shot sprite can miss the first frames. Whether
        // that bites depends on the SHARED game-data cache's warmth —
        // which is why a spec doing this passed or failed with whatever
        // ran before it. The staging contract (loadWeaponsGameData and
        // kin) records the ids it covered in StagedWeaponIds — a
        // makeSystem resource, so worlds that never stage anything (the
        // ship builder, the display world) leave it unset and are never
        // warned about. In a staging world, a get on an id nothing
        // staged is warned about in development builds and left alone
        // in production ones: the check must not touch sim behaviour.
        const stagedWeaponIds = world.resources.get(StagedWeaponIds);
        const warnOnUnstaged = (id: string) => {
            if (stagedWeaponIds === undefined
                || process.env.NODE_ENV === 'production'
                || stagedWeaponIds.has(id)) {
                return;
            }
            console.warn(`WeaponEntries.get('${id}') built an entry for a `
                + 'weapon whose closure this world never staged: a bay '
                + 'launches fighters whose hull sprite sheet is not '
                + 'cached, and a projectile\'s shot sprite can miss its '
                + 'first frames. Stage it first (loadWeaponsGameData, '
                + 'loadEntityGameData, loadOutfitsGameData) and read the '
                + 'entry with getCached.');
        };

        const weaponEntries = new Gettable<WeaponEntry | undefined>(async id => {
            warnOnUnstaged(id);
            // A dangling wëap reference (a plug-in ship or outfit naming a
            // weapon it never shipped) has no entry, so it never fires;
            // see entity_data_loader's loadIfDefined. Other failures
            // propagate.
            const data = await gameData.data.Weapon.get(id).catch(e => {
                if (isNovaIDNotFoundError(e)) {
                    return undefined;
                }
                throw e;
            });
            if (!data) {
                return undefined;
            }
            const construct = weaponConstructors.get(data.type);
            if (!construct) {
                return undefined;
            }
            return new construct(data, runQuery);
        });
        world.resources.set(WeaponEntries, weaponEntries);

        world.resources.set(FireSubs, (id: string, source: string,
            end: ShotEnd) => {
            const weaponEntry = weaponEntries.getCached(id);
            if (!weaponEntry) {
                return [];
            }
            return weaponEntry.fireSubs(source, end);
        });
    }
}
