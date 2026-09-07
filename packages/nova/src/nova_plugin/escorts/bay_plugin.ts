import * as t from 'io-ts';
import { BayWeaponData, WeaponData } from 'novadatainterface/weapon_data';
import { Entities, GetEntity, RunQueryFunction, UUID } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { Plugin } from 'nova_ecs/plugin';
import { DeltaResource } from 'nova_ecs/plugins/delta_plugin';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { CommunicatorResource, MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { markerType, SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { Optional } from 'nova_ecs/optional';
import { Query } from 'nova_ecs/query';
import { System } from 'nova_ecs/system';
import { SimulationGameDataInterface } from '../../client/gamedata/simulation_game_data.js';
import { SimulationGameDataResource } from '../core/index.js';
import { OutfitsStateComponent } from '../ship/index.js';
import { HitboxHullComponent, HurtboxHullComponent } from '../core/index.js';
import { CollisionEvent, CollisionHitterComponent, CollisionVulnerabilityComponent } from '../core/index.js';
import { EscortCommandComponent } from '../player/index.js';
import { ExitPointData } from '../combat/index.js';
import { GovtComponent } from '../core/index.js';
import { WeaponConstructors, WeaponEntry } from '../combat/index.js';
import { BeamCollisionSystem, BeamResetSystem, BlastCollisionSystem, DropExplodingTargetSystem, TargetIndexProvider } from '../combat/index.js';
import { OwnerComponent, SourceComponent } from '../ship/index.js';
import { DeathAIComponent } from '../npc/index.js';
import { FormationComponent, NpcComponent, NpcSteeringSystem, nextFormationSlot } from '../npc/index.js';
import { EscortLandingComponent, PlayerEscortComponent } from '../player/index.js';
import { ShipComponent } from '../ship/index.js';
import { SoundEvent } from '../core/index.js';
import { TargetComponent } from '../ship/index.js';
import { WeaponsStateComponent } from '../ship/index.js';

/** Exported so a landing order can cancel an in-progress return
 * (player_escort_plugin): a fighter whose carrier is leaving the system
 * lands on the planet instead of chasing a bay that is about to vanish. */
export const CollectableEscortComponent = new Component<undefined>('CollectableEscort');
export const ReturnComponent = new Component<undefined>('ReturnComponent');
/**
 * Marks a bay-launched fighter — the ships that CAN return to a bay.
 * (Historical name: it once triggered auto-return when the fighter's
 * target vanished; fighters now launch into formation and dock only on
 * the returnToBay escort command. The name is kept because the marker
 * is serializer-registered and renaming would churn wire compat for no
 * behavior change.)
 */
export const ReturnWhenTargetRemovedComponent = new Component<undefined>('ReturnWhenTargetRemoved');

/**
 * Links a launched fighter back to the bay weapon that launched it, so
 * docking can refund a round of ammo to the carrier's magazine and so
 * the outfitter can count still-deployed fighters against buy caps.
 *
 * A separate component rather than data folded into
 * ReturnWhenTargetRemovedComponent: that one is a registered marker
 * (markerType / `encode: () => null`) on the wire, and giving it a
 * payload would change its codec, so old and new peers would disagree
 * about the shape of an existing component. A NEW component is additive
 * — peers that don't know it ignore the extra key.
 */
const BayFighter = t.type({
    /** Global id of the bay wëap this fighter launched from. */
    bayWeaponId: t.string,
});
export type BayFighter = t.TypeOf<typeof BayFighter>;
export const BayFighterComponent =
    new Component<BayFighter>('BayFighterComponent');

/**
 * Credits one round of `bayWeaponId` ammo back to `carrier`'s magazine,
 * for a fighter that just docked. Returns whether a round was actually
 * refunded.
 *
 * Policy (deliberately the mirror image of weapon_plugin's
 * consumeAmmo): the round goes to the LOWEST-sorted outfit id that
 * supplies this weapon, so every peer picks the same outfit. Two
 * further rules:
 *
 *  - The count is bumped IN PLACE on an existing OutfitsState entry
 *    rather than reassigning OutfitsStateComponent. Provide's change
 *    detection only fires on component reassignment (see
 *    nova_ecs/provide.ts), so an in-place bump — exactly what
 *    consumeAmmo does — leaves WeaponsStateComponent and the
 *    WeaponsComponent local state (reload timers, burst counters)
 *    alone. Reassigning would re-derive both and reset every weapon's
 *    reload clock mid-flight, which is the tracker issue noted at
 *    fire_weapon_plugin.ts WeaponsComponentProvider.
 *  - It never pushes the magazine past capacity (the bay's MaxAmmo
 *    times the number of bays the carrier mounts), so a carrier that
 *    somehow restocked while its fighters were out cannot end up
 *    over-full. In normal play the deployed-fighter accounting in the
 *    outfitter (outfitter_rules deployedCounts) keeps this from ever
 *    biting.
 *
 * A carrier with no entry at all for any supplying outfit gets no
 * refund: consumeAmmo decrements existing entries and leaves them at
 * zero rather than deleting them, so the entry is there in every path
 * that launched the fighter in the first place. Nothing here can
 * invent an outfit id, since finding one would need an async scan of
 * every outfit in the game data.
 */
export function refundFighterToBay(carrier: Entity, bayWeaponId: string,
    gameData: SimulationGameDataInterface): boolean {
    const outfits = carrier.components.get(OutfitsStateComponent);
    if (!outfits) {
        return false;
    }
    const supplying = [...outfits.keys()]
        .filter(id => gameData.data.Outfit.getCached(id)?.ammoFor
            === bayWeaponId)
        .sort();
    if (supplying.length === 0) {
        return false;
    }

    // Capacity: MaxAmmo per bay times the bays mounted. MaxAmmo <= 0
    // means the bay defers to the outfit's Max field (matching
    // outfitter_rules ammoCapacity), which is not simulation state, so
    // treat it as uncapped here.
    const bay = gameData.data.Weapon.getCached(bayWeaponId);
    const bays = carrier.components.get(WeaponsStateComponent)
        ?.get(bayWeaponId)?.count ?? 0;
    if (bay && bay.maxAmmo > 0) {
        const capacity = bay.maxAmmo * bays;
        let held = 0;
        for (const id of supplying) {
            held += outfits.get(id)!.count;
        }
        if (held >= capacity) {
            return false;
        }
    }

    outfits.get(supplying[0])!.count++;
    return true;
}

/** Speed, in px/s, a fighter is pushed out of the bay at, on top of
 * the carrier's own velocity. */
export const EXIT_KICK = 10;

class BayWeaponEntry extends WeaponEntry {
    declare data: BayWeaponData;
    protected pointDefenseRangeSquared;
    //    private factoryQueue: FactoryQueue<Entity>;

    constructor(data: WeaponData, runQuery: RunQueryFunction) {
        if (data.type !== 'BayWeaponData') {
            throw new Error('Data type must be BayWeaponData');
        }

        super(data, runQuery);
        
        this.pointDefenseRangeSquared = 0;

        // const queueHolder = {} as { queue: FactoryQueue<Entity> };
        // this.factoryQueue = new FactoryQueue(() => {
        //     const ship = new Entity();
        //     ship.components.set(ShipComponent, {
        //         id: data.shipID,
        //     }).set(MovementStateComponent, {
        //         accelerating: 0,
        //         position: new Position(0, 0),
        //         rotation: new Angle(0),
        //         turnBack: false,
        //         turning: 0,
        //         velocity: new Vector(0, 0),
        //     }).set(ReturnToQueueComponent, queueHolder)
        //         .set(DeathAIComponent, undefined);
        //     return ship;
        // });
        // queueHolder.queue = this.factoryQueue;
    }

    private makeShip() {
        const ship = new Entity();
        ship.components.set(ShipComponent, {
            id: this.data.shipID,
        }).set(MovementStateComponent, {
            accelerating: 0,
            position: new Position(0, 0),
            rotation: new Angle(0),
            turnBack: false,
            turning: 0,
            velocity: new Vector(0, 0),
        }).set(DeathAIComponent, undefined)
            .set(ReturnWhenTargetRemovedComponent, undefined)
        return ship;
    }

    fire(position: Position, angle: Angle, owner: string, target = undefined, source: string, sourceVelocity?: Vector, exitPointData?: ExitPointData, silent?: boolean): Entity | undefined {
        // In input-driven multiplayer every peer simulates every bay
        // deterministically; ownership tags along for identity only.
        const q = this.runQuery(BaySourceQuery, source)[0];
        const multiplayerOwner = q?.[0]?.owner ?? 'sim';
        const sourceGovt = q?.[1];

        // Vector is immutable: add() RETURNS the sum, so these must be
        // chained. They used to be called for effect, which threw both
        // terms away and launched every fighter at a dead stop next to
        // a carrier at full speed.
        let velocity = new Vector(0, 0);
        if (sourceVelocity) {
            velocity = velocity.add(sourceVelocity);
        }
        // Tracker issue: BayWeaponData carries no launch speed, so every
        // bay uses the EXIT_KICK constant rather than its wëap's field.
        velocity = velocity.add(angle.getUnitVector().scale(EXIT_KICK));

        const ship = this.makeShip();
        ship.components.set(OwnerComponent, {owner});
        ship.components.set(BayFighterComponent,
            { bayWeaponId: this.data.id });
        ship.components.set(SourceComponent, source);
        ship.components.set(TargetComponent, { target: undefined });
        if (sourceGovt) {
            // A fighter flies its carrier's flag. Without this it is a
            // govt-less independent, and a XENOPHOBIC carrier — pirates,
            // and the stock Pirate Carrier is one — reads "hostile" off
            // its own wing the instant it launches: govtDisposition puts
            // xenophobes at war with independents, and the new fighter is
            // sitting at range ~0, so chooseNearest hands the carrier its
            // own fighter as the nearest enemy. Inheriting the govt makes
            // the wing an ALLY of its carrier, and makes the carrier's
            // enemies willing to engage it.
            //
            // A no-op for player-launched fighters, which is why player
            // behavior is untouched: a player's ship carries no
            // GovtComponent, so there is nothing to copy. Fighters from a
            // player's hired carrier ESCORT do inherit that escort's govt.
            ship.components.set(GovtComponent, { ...sourceGovt });
        }
        ship.components.set(MovementStateComponent, {
            accelerating: 0,
            position: Position.fromVectorLike(position),
            velocity: Vector.fromVectorLike(velocity),
            rotation: Angle.fromAngleLike(angle),
            turnBack: false,
            turning: 0,
        });
        ship.components.set(MultiplayerData, {owner: multiplayerOwner});

        // Fighters launch as ESCORTS: into a formation slot on their
        // carrier, under the default escort command. They no longer
        // launch straight at the carrier's target — attacking is the
        // 'attack' escort command's job (escort_command_plugin), so a
        // launch needs no target at all.
        const slot = nextFormationSlot(
            this.runQuery(BayFormationQuery).map(([formation]) => formation),
            source);
        ship.components.set(FormationComponent, { leader: source, slot });
        ship.components.set(EscortCommandComponent,
            { command: 'formation' });

        this.entities.set(this.ids.next(`bay:${multiplayerOwner}`), ship);
        const ownerVuln = this.entities.get(source)?.components
            .get(CollisionVulnerabilityComponent);
        ownerVuln?.vulnerableTo.add(`return_escorts`);

        // A BAY IS A WEAPON, so a launch is heard exactly like any other
        // shot: the wëap resource's own snd, on the untargeted SoundEvent
        // channel that everyone hears (not the self-only PlayerSoundEvent),
        // so ANY ship's launch is audible. 22 of the 23 stock bays carry a
        // sound (only nova:175 "Create Dart", a mission-spawn utility, has
        // none) — launching was silent purely because this path never
        // emitted, unlike ProjectileWeaponEntry/BeamWeaponEntry.fire.
        //
        // Byte-for-byte the projectile pattern, including `silent` (used by
        // submunition bursts so one volley is heard once). Emitting an event
        // touches no simulation state and draws no PRNG, so this cannot move
        // the sim. The "how many copies of one sound may start this frame"
        // cap is display-side (display/sound_plugin.ts, sound_limiter.ts),
        // so a carrier emptying its bays gets it for free.
        if (this.data.sound && !silent) {
            this.emit(SoundEvent, {
                id: this.data.sound,
                loop: this.data.loopSound,
            });
        }

        return ship;
    }
}

const BayFormationQuery = new Query([FormationComponent] as const);

/** The launching carrier's identity bits: its multiplayer owner (for the
 * fighter's entity id) and its government (which the fighter inherits). */
const BaySourceQuery = new Query(
    [Optional(MultiplayerData), Optional(GovtComponent)] as const);

/**
 * Keeps a carrier SCOOPABLE while any of its collectable fighters exist.
 *
 * A returning fighter docks by colliding with its carrier through the
 * 'return_escorts' collision channel, which requires the CARRIER's
 * CollisionVulnerability to list that tag. The tag used to be added only
 * as a side effect of BayWeaponEntry.fire — but the carrier entity is
 * REBUILT on landing/departure (the providers derive a fresh
 * vulnerability set), so fighters deployed before a landing could not
 * return afterwards until a NEW launch happened to re-add the tag
 * (shipped bug: "return to ship" silently failed post-departure until
 * another fighter was launched). Deriving the tag from current state
 * makes the launch-time add merely an optimization.
 *
 * Deterministic: an idempotent in-place set add, commutative across
 * entity iteration order; no PRNG, no time.
 */
const ReturnVulnerabilitySystem = new System({
    name: 'ReturnVulnerability',
    args: [SourceComponent, CollectableEscortComponent, Entities] as const,
    step(source, _collectable, entities) {
        entities.get(source)?.components
            .get(CollisionVulnerabilityComponent)
            ?.vulnerableTo.add('return_escorts');
    },
    // #237 pins (shared: *): BayPlugin registers after TargetPlugin and
    // BeamPlugin.
    after: [BeamResetSystem, DropExplodingTargetSystem],
});

const CollectableEscortAI = new System({
    name: 'CollectableEscortAI',
    events: [CollisionEvent],
    args: [CollisionEvent, SourceComponent, Entities, UUID,
        Optional(BayFighterComponent), SimulationGameDataResource,
        CollectableEscortComponent] as const,
    step(collision, source, entities, uuid, bayFighter, gameData) {
        if (collision.other !== source) {
            return;
        }
        // Docking restocks the bay: credit the round back BEFORE the
        // fighter is deleted, while its link to the launching bay is
        // still readable. A fighter with no BayFighterComponent (state
        // from a peer that predates it, or a collectable escort that a
        // bay never launched) just docks and vanishes, exactly as
        // before.
        const carrier = entities.get(source);
        if (bayFighter && carrier) {
            refundFighterToBay(carrier, bayFighter.bayWeaponId, gameData);
        }
        entities.delete(uuid);
    },
    // #237 pins (shared: *): among the CollisionEvent handlers, after
    // beam's and before blast's.
    after: [BeamCollisionSystem],
    before: [BlastCollisionSystem],
});

/**
 * An NPC carrier's fighters go home to nothing when the carrier dies:
 * this hands them a graceful exit.
 *
 * WHAT HAPPENED BEFORE (the state this fixes): a bay fighter is steered
 * entirely by escort machinery, and every piece of it fails open when
 * the carrier entity vanishes. FormationSystem sees the leader is gone
 * and drops FormationComponent, so nothing station-keeps it — but only
 * when it runs at all, which it does not while the fighter is under a
 * non-formation command. EscortCommandBehaviorSystem keeps running with
 * a missing root: 'attack' still works while the victim lives, and the
 * moment it reverts to 'formation' the fighter has no leader to form on
 * and only the opportunistic front-quadrant-turret rule left. Meanwhile
 * NpcDecisionSystem and NpcSteeringSystem both bail on any ship holding
 * an EscortCommandComponent, and a bay fighter has no NpcComponent to
 * fall back to anyway. Net result: the fighter drifted forever on its
 * launch velocity, occasionally firing a turret, and never despawned.
 *
 * WHAT IT DOES NOW: converts the orphan into a plain NPC in 'depart'
 * mode. NpcSteeringSystem then flies it out of the system and deletes
 * it at NPC_DEPART_RADIUS — the same simplified "jump out" every other
 * NPC uses — once EscortCommandComponent is gone and the AI stops
 * yielding to it. It withdraws rather than finishing its current fight:
 * with the carrier dead there is no hangar to dock in, no ammo to
 * refund, and no one left to command it.
 *
 * DETERMINISM: 'depart' is set explicitly, so NpcDecisionSystem returns
 * at its `mode === 'depart'` guard BEFORE rolling `departAt`. That
 * matters — the roll draws from the shared seeded RandomResource, and a
 * draw whose count depended on how many carriers happened to die would
 * shift every later draw on that peer. This path consumes no randomness
 * at all. aiType 3 (warship) is a sane resting value that nothing reads
 * while the mode stays 'depart'.
 *
 * PLAYER-LAUNCHED FIGHTERS ARE EXEMPT: PlayerEscortComponent is stamped
 * whenever the escort chain tops out at a player ship and is NEVER
 * cleared (that is the whole point of it — see player_escort.ts), so it
 * still marks a player's fighter after the carrier escort it flew from
 * has died. Those keep their existing re-attachment behavior.
 */
export const OrphanedBayFighterSystem = new System({
    name: 'OrphanedBayFighterAI',
    args: [BayFighterComponent, SourceComponent, Entities, GetEntity,
        Optional(PlayerEscortComponent), Optional(NpcComponent)] as const,
    step(_bayFighter, source, entities, entity, playerEscort, npc) {
        if (playerEscort || npc) {
            // Not ours to retire, or already retired (idempotent: the
            // NpcComponent it gains below stops it running again).
            return;
        }
        if (entities.has(source)) {
            return; // Carrier still alive.
        }
        entity.components.delete(EscortCommandComponent);
        entity.components.delete(FormationComponent);
        entity.components.set(NpcComponent, { aiType: 3, mode: 'depart' });
    },
    before: [NpcSteeringSystem],
    // #237 pin (shared: *): BayPlugin's registration order.
    after: [ReturnVulnerabilitySystem],
});

/** Flips a fighter into the return-and-collect flow: fly home and be
 * scooped up on contact with the carrier. Triggered by the returnToBay
 * escort command (escort_command_plugin). */
export function startReturnHome(entity: Entity) {
    entity.components.set(ReturnComponent, undefined);
    entity.components.set(CollectableEscortComponent, undefined);
    entity.components.set(CollisionHitterComponent, {
        hitTypes: new Set([`return_escorts`]),
    });
    const hitbox = entity.components.get(HitboxHullComponent);
    if (hitbox) {
        entity.components.set(HurtboxHullComponent, hitbox);
    }
}

export const ReturnAI = new System({
    name: 'ReturnToBase',
    args: [OwnerComponent, MovementStateComponent, ReturnComponent,
        Optional(EscortLandingComponent)] as const,
    step(owner, movementState, _return, landing) {
        if (landing) {
            // Landing with the player wins over flying home to the bay
            // (player_escort_plugin steers this ship).
            return;
        }
        movementState.turnTo = owner.owner;
        movementState.accelerating = 1;
    },
    // #237 pins (shared: Owner, MovementState, EscortLanding, Return; *):
    // first of BayPlugin's systems, after TargetPlugin's index provider.
    after: [TargetIndexProvider],
    before: [ReturnVulnerabilitySystem],
});

export const BayPlugin: Plugin = {
    name: 'BayPlugin',
    build(world) {
        const weaponConstructors = world.resources.get(WeaponConstructors);
        if (!weaponConstructors) {
            throw new Error('Expected WeaponConstructors to exist');
        }
        weaponConstructors.set('BayWeaponData', BayWeaponEntry);
        // Escort state is simulation state: unregistered, it is
        // invisible to desync hashes, silently dropped by rollback
        // snapshots (each peer's rollbacks then disagree about which
        // escorts can return), and lost from resync baselines
        // (escorts that can never return home).
        const serializer = world.resources.get(SerializerResource);
        serializer?.addComponent(ReturnComponent, markerType);
        serializer?.addComponent(CollectableEscortComponent, markerType);
        serializer?.addComponent(ReturnWhenTargetRemovedComponent, markerType);

        // Which bay a fighter came from is simulation state (docking
        // refunds ammo to that bay) AND display-world state (the
        // outfitter counts deployed fighters against buy caps). Going
        // through the delta maker registers it with the serializer too,
        // so it survives rollback snapshots, desync hashes, resync
        // baselines, and the display bridge — which drops components
        // the serializer doesn't know (SimulationBridgeHost.snapshot).
        const deltaMaker = world.resources.get(DeltaResource);
        if (!deltaMaker) {
            throw new Error('Expected delta maker resource to exist');
        }
        world.addComponent(BayFighterComponent);
        deltaMaker.addComponent(BayFighterComponent, {
            componentType: BayFighter,
        });

        world.addSystem(ReturnAI);
        world.addSystem(ReturnVulnerabilitySystem);
        world.addSystem(CollectableEscortAI);
        world.addSystem(OrphanedBayFighterSystem);
    }
}
