import { Entity } from 'nova_ecs/entity';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import {
    BayFighterComponent, ReturnWhenTargetRemovedComponent,
} from '../nova_plugin/escorts/index.js';
import {
    EscortCommandComponent, durableEscortFields, EscortLandingComponent, PlayerEscortComponent,
} from '../nova_plugin/player/index.js';
import {
    OwnerComponent, SourceComponent,
} from '../nova_plugin/combat/index.js';
import { FiringGroupComponent, TargetComponent } from '../nova_plugin/ship/index.js';
import {
    GateArrivalComponent, JumpComponent, MultiJumpContinueComponent,
} from '../nova_plugin/travel/index.js';
import {
    FormationComponent, formationSlotPosition, NpcComponent,
} from '../nova_plugin/npc/index.js';

/**
 * ============================================================================
 * The client's carried-escort roster
 * ============================================================================
 *
 * Escorts that left the simulation to follow their player — landed with
 * them on a planet, or departed with them into hyperspace — are held here
 * as whole serialized entities until the client puts them back
 * (browser.ts). Per-player client state, exactly like the docked player
 * ship itself (display/docked_ship.ts): the DESPAWN is simulation state
 * that every peer performs, but only the owning client keeps the roster,
 * and only it respawns them.
 *
 * Entities, not ship ids. Rebuilding an escort from its ship id would
 * silently discard damage, outfits, cargo, ionization, and — for a
 * launched fighter — its bay identity (OwnerComponent / SourceComponent /
 * ReturnWhenTargetRemovedComponent, and any future BayFighterComponent).
 * Carrying the serialized entity preserves every component the serializer
 * knows about, whether or not this module has heard of it.
 *
 * LANDED FIGHTERS ARE STILL LAUNCHED. Landing does not stow a deployed
 * fighter back into its bay (that is a normal state in the original
 * game): a landed fighter comes back out still deployed, keeps its bay
 * identity, and can still be ordered home with the returnToBay command
 * afterwards. `deployedFightersBySource` is the documented hook for bay
 * ammo accounting: it reports the landed roster's still-deployed fighters
 * per carrier so the outfitter's deployed-count can include them.
 */

export interface CarriedEscort {
    /** The player ship uuid this escort belongs to. */
    player: string;
    /** The uuid the escort had before it left the simulation. */
    uuid: string;
    /** The escort's full entity, as decoded from its carry event. */
    entity: Entity;
    /**
     * The uuid the PLAYER SHIP had when this entry's entity was encoded,
     * when that is not the uuid it will be re-inserted under.
     *
     * Only a SAVE crosses that boundary: within a session the player keeps
     * its uuid across landings and jumps, so a carry event's escort comes
     * back beside the same player it left. A restore re-mints the player,
     * and an escort the player launched from its own bays carries
     * OwnerComponent/SourceComponent naming the PRE-SAVE player — the two
     * references ReturnAI steers at and CollectableEscortAI matches the
     * docking collision against. Recorded here so prepareCarriedEscorts
     * can remap them onto the live player exactly as it remaps a fighter's
     * reference to a carrier that came back in the same batch.
     *
     * Rides the entry rather than being a batch parameter deliberately:
     * restored escorts can be held (a multi-jump chain, a gate arrival) or
     * handed back by a failed transition, and they must still carry the
     * remap whenever they are finally put down.
     */
    priorPlayer?: string;
}

/**
 * ----------------------------------------------------------------------
 * Multi-jump chains
 * ----------------------------------------------------------------------
 *
 * A "multi-jump" outfit (ModType 32) auto-continues a routed jump the tick
 * after each arrival (MultiJumpContinueSystem), so a chain crosses several
 * systems from one key press. Escorts are re-inserted through input
 * records, and a record that lands after the chain has already left the
 * intermediate system strands its escort there.
 *
 * The client closes that seam by NOT putting the batch back down until the
 * chain finishes: `multiJumpChainContinues` says a carried batch must be
 * held (asked of the player entity as it leaves a system), and
 * `multiJumpChainSettled` says a held batch may be released (asked of the
 * player entity in the world it arrived in).
 *
 * ORDERING GUARANTEE. The two are read off the player's own entity — the
 * same entity the carry rode with — so no clock, timeout, or round trip is
 * involved and there is nothing to race. At departure the entity's
 * JumpComponent still holds the budget the destination world is about to
 * act on (JumpSequenceSystem's 'arriving' case turns `autoJumpsLeft` into
 * the MultiJumpContinueComponent marker), so "will there be another hop?"
 * is known before the batch would have been inserted. On arrival exactly
 * one of JumpComponent / MultiJumpContinueComponent is present at every
 * step boundary for as long as the chain runs (the arriving step swaps the
 * first for the second; the continuing step swaps back), so their joint
 * absence is an unambiguous "the chain is over" — including when it ended
 * early because the route ran out or the fuel did. Both components
 * serialize, so the display world sees them.
 *
 * The batch is therefore absent from the systems a chain passes through
 * and appears at the final destination with the player. That is the
 * documented cost; it adds no delay, touches no simulation state, and
 * needs no agreement between peers, because a roster is client state.
 */

/**
 * Whether the player entity leaving a system will auto-continue into
 * another jump, so a batch carried with it must be held rather than
 * inserted at this hop.
 */
export function multiJumpChainContinues(player: Entity): boolean {
    return (player.components.get(JumpComponent)?.autoJumpsLeft ?? 0) > 0;
}

/**
 * Whether the player entity has come to rest between jumps, so a held
 * batch may be put back down beside it.
 */
export function multiJumpChainSettled(player: Entity): boolean {
    return !player.components.has(JumpComponent)
        && !player.components.has(MultiJumpContinueComponent);
}

/**
 * ----------------------------------------------------------------------
 * Gate arrivals are positioned a tick LATE
 * ----------------------------------------------------------------------
 *
 * A hyperspace jump sets its arrival kinematics at DEPARTURE, in the origin
 * system (JumpSequenceSystem's 'accelerating' case teleports the ship to the
 * far side of the destination before handing it over), so a jumping player
 * entity already carries its destination position/rotation/velocity by the
 * time the client re-inserts a batch around it.
 *
 * A GATE arrival cannot: the exit point is the destination gate's spöb
 * position, which only exists once the destination system world is up, so
 * GateArrivalSystem teleports the ship on its FIRST TICK there. Until that
 * tick the player entity still holds its ORIGIN-system station — so a batch
 * placed on it lands in formation around where the player used to be,
 * arbitrarily far from the gate they just came out of.
 *
 * The fix reuses the multi-jump hold: a batch arriving with a gate transit
 * is held exactly as a chained batch is, and released once the marker is
 * gone — which is precisely the moment GateArrivalSystem has finished
 * positioning the player. The escorts then take formation stations on the
 * gate exit, coasting outward at the player's emergence velocity.
 * GateArrivalComponent is serializer-registered (gate_transit_plugin), so
 * the display world the client asks sees it appear and disappear.
 */
export function gateArrivalPending(player: Entity): boolean {
    return player.components.has(GateArrivalComponent);
}

/**
 * Whether a batch arriving with this player entity must be HELD rather
 * than put down beside it: another jump is coming (a multi-jump chain), or
 * the player has not been placed at its arrival gate yet. Asked of the
 * player entity as it enters a system.
 */
export function carriedBatchMustHold(player: Entity): boolean {
    return multiJumpChainContinues(player) || gateArrivalPending(player);
}

/**
 * Whether a held batch may now be put down: the exact complement of
 * {@link carriedBatchMustHold}, asked of the player entity in the world it
 * arrived in. Both conditions must have cleared — the chain has settled AND
 * the gate arrival has been positioned — or the batch takes formation on a
 * station the player is about to leave.
 */
export function carriedBatchSettled(player: Entity): boolean {
    return multiJumpChainSettled(player) && !gateArrivalPending(player);
}

/**
 * The same-system convergence invariant, as a predicate.
 *
 * `expected` is every escort the player owns (or owned as it left);
 * `inWorld` is what is in the system with them right now; `rosters` are the
 * client's held batches, each of which is on its way back to the player.
 * `stranded` is what is in none of those — an escort that will never rejoin
 * its player without them flying back for it. The invariant is
 * `stranded.length === 0`, with the single deliberate exception of the
 * zero-energy hyperspace-jump exclusion, whose ships the caller leaves out
 * of `expected` (see escortFollows in player_escort_plugin.ts).
 */
export interface EscortAccounting {
    inWorld: string[];
    inRoster: string[];
    stranded: string[];
}

export function escortsAccountedFor(player: string,
    expected: Iterable<string>, inWorld: Iterable<string>,
    rosters: Iterable<readonly CarriedEscort[]>): EscortAccounting {
    const present = new Set(inWorld);
    const held = new Set<string>();
    for (const roster of rosters) {
        for (const carried of roster) {
            if (carried.player === player) {
                held.add(carried.uuid);
            }
        }
    }
    const accounting: EscortAccounting = {
        inWorld: [], inRoster: [], stranded: [],
    };
    for (const uuid of expected) {
        if (present.has(uuid)) {
            accounting.inWorld.push(uuid);
        } else if (held.has(uuid)) {
            accounting.inRoster.push(uuid);
        } else {
            accounting.stranded.push(uuid);
        }
    }
    return accounting;
}

/**
 * Removes and returns the roster entries belonging to `player`, leaving
 * everyone else's entries in place. Mutates `roster` — a jump or a
 * liftoff consumes exactly one player's escorts, and in multiplayer the
 * other peers' carry events are simply not this client's business.
 */
export function takeCarriedEscorts(roster: CarriedEscort[], player: string):
    CarriedEscort[] {
    const taken: CarriedEscort[] = [];
    for (let i = roster.length - 1; i >= 0; i--) {
        if (roster[i].player === player) {
            taken.unshift(...roster.splice(i, 1));
        }
    }
    return taken;
}

/**
 * Both of a player's rosters, drained for a system transition (browser.ts's
 * jumpTo): the escorts already riding a jump, followed by any that had
 * LANDED — the hypergate/wormhole case, where the player docks at the gate
 * holding escorts that were swept up there and transits without ever
 * lifting off into the origin system.
 *
 * NOTHING IS RESTOCKED HERE, and that is the decision this function exists
 * to hold: the free refuel-and-rearm belongs to escorts that visited a
 * port, and passing through a gate is not a visit (escort_restock.ts). The
 * restock lives on the lift-off drains instead.
 *
 * `fromLanded` is the landed half, by identity, so a transition that fails
 * can hand each escort back to the roster it came from —
 * `restoreFailedTransitionBatch`.
 *
 * Both rosters are emptied of everyone else's entries too: this client
 * would never respawn another peer's escorts.
 */
export function takeEscortsForTransition(jumpRoster: CarriedEscort[],
    landedRoster: CarriedEscort[], player: string):
    { batch: CarriedEscort[], fromLanded: CarriedEscort[] } {
    const jumping = takeCarriedEscorts(jumpRoster, player);
    jumpRoster.length = 0;
    const fromLanded = takeCarriedEscorts(landedRoster, player);
    landedRoster.length = 0;
    return { batch: [...jumping, ...fromLanded], fromLanded };
}

/**
 * Sorts a batch a FAILED system transition is handing back into the two
 * rosters it must return to.
 *
 * The never-drop guarantee is absolute: every entry in `batch` comes out
 * in exactly one of the two halves. A landed escort goes back to the
 * LANDED roster rather than being reclassified as mid-jump, so it keeps
 * its landed bookkeeping — the lift-off restock and the landing-order
 * handling that only the landed roster carries.
 *
 * Anything not recognised as having come from the landed roster joins the
 * jump half. That deliberately includes escorts the failed transition
 * PUSHED onto the batch on its way (a save's restored escorts enter
 * exactly this way), which have no landed context to preserve.
 */
export function restoreFailedTransitionBatch(batch: readonly CarriedEscort[],
    fromLanded: readonly CarriedEscort[]):
    { landed: CarriedEscort[], jumping: CarriedEscort[] } {
    const landedSet = new Set(fromLanded);
    const landed: CarriedEscort[] = [];
    const jumping: CarriedEscort[] = [];
    for (const escort of batch) {
        (landedSet.has(escort) ? landed : jumping).push(escort);
    }
    return { landed, jumping };
}

/**
 * The still-deployed bay fighters in a roster, grouped by the carrier
 * (SourceComponent) that launched them. The hook for bay ammo accounting:
 * a fighter that landed with the player is still deployed, so an
 * outfitter deployed-count must include it (see the module comment).
 */
export function deployedFightersBySource(roster: readonly CarriedEscort[]):
    Map<string, number> {
    const counts = new Map<string, number>();
    for (const { entity } of roster) {
        if (!entity.components.has(ReturnWhenTargetRemovedComponent)) {
            continue;
        }
        const source = entity.components.get(SourceComponent);
        if (source === undefined) {
            continue;
        }
        counts.set(source, (counts.get(source) ?? 0) + 1);
    }
    return counts;
}

/**
 * The same still-deployed fighters as `deployedFightersBySource`, split by
 * the BAY they were launched from: carrier uuid -> bay weapon id -> count.
 *
 * That is the granularity an ammo ceiling needs. A bay's capacity belongs
 * to the bay weapon, and a deployed fighter occupies a slot in the
 * specific bay it came out of, so a carrier with two different bays must
 * not have one bay's launched fighters charged against the other's.
 *
 * A fighter with no BayFighterComponent cannot be attributed to a bay and
 * is left out: it is state from a build that predates that component (or a
 * collectable escort no bay launched), and guessing a bay for it would
 * wrongly shrink a real bay's ceiling.
 */
export function deployedFightersByBay(
    roster: readonly { entity: Entity }[]):
    Map<string, Map<string, number>> {
    const counts = new Map<string, Map<string, number>>();
    for (const { entity } of roster) {
        if (!entity.components.has(ReturnWhenTargetRemovedComponent)) {
            continue;
        }
        const source = entity.components.get(SourceComponent);
        const bay = entity.components.get(BayFighterComponent)?.bayWeaponId;
        if (source === undefined || bay === undefined) {
            continue;
        }
        const byBay = counts.get(source) ?? new Map<string, number>();
        byBay.set(bay, (byBay.get(bay) ?? 0) + 1);
        counts.set(source, byBay);
    }
    return counts;
}

/** Where a formation leader is, for placing its followers' stations. */
interface Station {
    position: Position;
    rotation: Angle;
    velocity: Vector;
}

function stationOf(entity: Entity): Station | undefined {
    const movement = entity.components.get(MovementStateComponent);
    if (!movement) {
        return undefined;
    }
    return {
        position: Position.fromVectorLike(movement.position),
        rotation: Angle.fromAngleLike(movement.rotation),
        velocity: Vector.fromVectorLike(movement.velocity),
    };
}

/**
 * How deep a carried batch's carrier chains are followed when placing
 * stations (a fighter on a carrier escort on the player is depth 2). Same
 * bound as the flock walk.
 */
const MAX_CARRY_DEPTH = 8;

/**
 * Places one carried escort on `attachTo`'s station: formation slot,
 * command reset to 'formation' (the explicit boundary reset — see
 * player_escort_plugin's module comment), the player's firing group, and
 * the durable ownership marker.
 *
 * Every other component is left exactly as it came out of the simulation,
 * except that uuid references (a fighter's OwnerComponent /
 * SourceComponent naming its carrier, or naming the player itself across a
 * save restore) are rewritten through `remap` — the batch comes back under
 * fresh uuids, so an un-remapped fighter could never find its bay again.
 *
 * THE UUID-BEARING COMPONENTS ON A CARRIED ESCORT, and what happens to
 * each here:
 *  - FormationComponent.leader     rewritten to `attachTo`.
 *  - PlayerEscortComponent         rewritten to {player, parent}.
 *  - FiringGroupComponent.group    rewritten to the flock root (`player`).
 *  - OwnerComponent.owner          remapped (carrier, or the pre-save
 *    SourceComponent                player — see CarriedEscort.priorPlayer).
 *  - TargetComponent.target        remapped when it names something in the
 *  - NpcComponent.aggressor        batch, otherwise LEFT AS IT WAS. An
 *    out-of-batch uuid is either still live (a landed escort relaunching
 *    into the system it left) or names an entity that no longer exists,
 *    and every consumer of these two already fails open on a uuid that is
 *    not in the entity map. The command is reset to 'formation' regardless,
 *    so a stale target changes no behaviour.
 *
 * Velocity is copied from the station so a batch arriving from hyperspace
 * coasts in with the player (who arrives at top speed) instead of hanging
 * motionless in front of them.
 */
function placeCarriedEscort(escort: CarriedEscort, player: string,
    attachTo: string, station: Station, slot: number,
    remap: ReadonlyMap<string, string>, ownerUuid?: string): Entity | undefined {
    const movement = escort.entity.components.get(MovementStateComponent);
    if (!movement) {
        return undefined;
    }
    escort.entity.components.set(MovementStateComponent, {
        ...movement,
        position: formationSlotPosition(station.position, station.rotation,
            slot),
        rotation: station.rotation,
        velocity: station.velocity,
        accelerating: 0,
        turning: 0,
        turnBack: false,
        turnTo: null,
    });
    escort.entity.components.set(FormationComponent,
        { leader: attachTo, slot });
    escort.entity.components.set(EscortCommandComponent,
        { command: 'formation' });
    // The firing group is the flock ROOT, so it stays the player even for
    // a fighter that re-attaches to its carrier.
    escort.entity.components.set(FiringGroupComponent, { group: player });
    // The marker is REBUILT (the escort comes back under a fresh uuid, on a
    // fresh leader), but the DURABLE facts have to ride through it: how the
    // escort was acquired, and any deal the player queued against it.
    // durableEscortFields is the whitelist every re-stamp site shares —
    // before it, this wrote `{ player, parent }` flat and a captured prize
    // silently became a hire the first time it landed with its player.
    //
    // `detached` is deliberately dropped rather than carried: this IS the
    // re-attachment the flag was waiting for.
    escort.entity.components.set(PlayerEscortComponent, {
        player, parent: attachTo,
        ...durableEscortFields(
            escort.entity.components.get(PlayerEscortComponent)),
    });
    escort.entity.components.delete(EscortLandingComponent);
    // Belt and braces against a warp-out sequence riding back into the
    // world with the escort. The sweep that took it already dropped the
    // JumpComponent (sweepJumpingEscort); this makes it true of every
    // entry however it reached a roster — including one restored from a
    // save written by a build that did not.
    escort.entity.components.delete(JumpComponent);
    const owner = escort.entity.components.get(OwnerComponent);
    const remappedOwner = owner && remap.get(owner.owner);
    if (remappedOwner) {
        escort.entity.components.set(OwnerComponent, { owner: remappedOwner });
    }
    const source = escort.entity.components.get(SourceComponent);
    const remappedSource = source !== undefined
        ? remap.get(source) : undefined;
    if (remappedSource) {
        escort.entity.components.set(SourceComponent, remappedSource);
    }
    // Targeting and hostility follow the same rule as the bay links: a
    // reference INTO the batch is rewritten to the new uuid, anything else
    // is left alone (see the component audit above).
    const target = escort.entity.components.get(TargetComponent);
    const remappedTarget = target?.target !== undefined
        ? remap.get(target.target) : undefined;
    if (target && remappedTarget) {
        escort.entity.components.set(TargetComponent,
            { ...target, target: remappedTarget });
    }
    const npc = escort.entity.components.get(NpcComponent);
    const remappedAggressor = npc?.aggressor !== undefined
        ? remap.get(npc.aggressor) : undefined;
    if (npc && remappedAggressor) {
        escort.entity.components.set(NpcComponent,
            { ...npc, aggressor: remappedAggressor });
    }
    if (ownerUuid !== undefined) {
        escort.entity.components.set(MultiplayerData, { owner: ownerUuid });
    }
    return escort.entity;
}

/**
 * Prepares a single carried escort for re-insertion directly on its
 * player. The batch form below is what the client actually uses; this is
 * the simple case (and the unit under test).
 */
export function prepareCarriedEscort(escort: CarriedEscort,
    leaderUuid: string, leader: Entity, slot: number,
    ownerUuid?: string): Entity | undefined {
    const station = stationOf(leader);
    if (!station) {
        return undefined;
    }
    return placeCarriedEscort(escort, leaderUuid, leaderUuid, station, slot,
        new Map(), ownerUuid);
}

/**
 * Prepares a whole carried batch for re-insertion, minting the uuid each
 * escort will be inserted under.
 *
 * The batch is handled as a unit so that a carrier escort and the fighters
 * it had launched come back INTACT: each escort attaches to its recorded
 * parent when that parent is in the same batch (placed first, so its
 * station is known), and to the player otherwise. Their owner/source
 * references are remapped to the batch's new uuids, which keeps
 * return-to-bay working after a landing or a jump, and keeps the
 * one-hop/indirect command split (escort_command_plugin) unchanged.
 *
 * Slots run from `firstSlot` for the player's own followers, and from 0
 * for any carrier in the batch (whose formation is new too).
 */
export function prepareCarriedEscorts(escorts: readonly CarriedEscort[],
    leaderUuid: string, leader: Entity, firstSlot: number,
    mintUuid: () => string, ownerUuid?: string):
    Array<{ uuid: string, entity: Entity }> {
    const leaderStation = stationOf(leader);
    if (!leaderStation) {
        return [];
    }
    const remap = new Map<string, string>();
    // A restored batch's references to the player it was saved beside:
    // the player is re-minted on restore, so its PRE-SAVE uuid resolves to
    // the live leader. Seeded first so a (impossible in practice) clash
    // with an escort's own uuid resolves in the escort's favour.
    for (const escort of escorts) {
        if (escort.priorPlayer !== undefined
            && escort.priorPlayer !== leaderUuid) {
            remap.set(escort.priorPlayer, leaderUuid);
        }
    }
    for (const escort of escorts) {
        remap.set(escort.uuid, mintUuid());
    }
    const stations = new Map<string, Station>([[leaderUuid, leaderStation]]);
    const nextSlot = new Map<string, number>([[leaderUuid, firstSlot]]);
    const prepared: Array<{ uuid: string, entity: Entity }> = [];

    const place = (escort: CarriedEscort, attachTo: string) => {
        const station = stations.get(attachTo)!;
        const slot = nextSlot.get(attachTo) ?? 0;
        nextSlot.set(attachTo, slot + 1);
        const uuid = remap.get(escort.uuid)!;
        const entity = placeCarriedEscort(escort, leaderUuid, attachTo,
            station, slot, remap, ownerUuid);
        if (!entity) {
            console.warn(`Carried escort ${escort.uuid} has no movement `
                + `state; skipped`);
            return;
        }
        const ownStation = stationOf(entity);
        if (ownStation) {
            stations.set(uuid, ownStation);
        }
        prepared.push({ uuid, entity });
    };

    let remaining = [...escorts];
    for (let depth = 0; depth < MAX_CARRY_DEPTH && remaining.length > 0;
        depth++) {
        const deferred: CarriedEscort[] = [];
        for (const escort of remaining) {
            const parent = escort.entity.components
                .get(PlayerEscortComponent)?.parent;
            const carrier = parent !== undefined && parent !== escort.uuid
                ? remap.get(parent) : undefined;
            if (carrier === undefined) {
                place(escort, leaderUuid); // A direct escort of the player.
            } else if (stations.has(carrier)) {
                place(escort, carrier);
            } else {
                deferred.push(escort); // Its carrier is not placed yet.
            }
        }
        if (deferred.length === remaining.length) {
            break; // No progress (a carrier cycle): fall through below.
        }
        remaining = deferred;
    }
    // Anything whose carrier never got placed joins the player directly
    // rather than being dropped: ownership is never lost.
    for (const escort of remaining) {
        place(escort, leaderUuid);
    }
    return prepared;
}
