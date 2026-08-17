import * as t from 'io-ts';
import { isLeft } from 'fp-ts/lib/Either.js';
import { Component } from 'nova_ecs/component';
import { EncodedEntity, SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { World } from 'nova_ecs/world';
import { CargoComponent } from './cargo_plugin.js';
import { deriveEntityComponents } from './entity_factory.js';
import { ActiveMissionType, CreditsComponent, MissionsComponent, MAX_ACTIVE_MISSIONS } from './player_state_plugin.js';
import { ActiveRanksComponent, ControlBitsComponent } from './ncb_plugin.js';
import { NpcComponent } from './npc_ai_plugin.js';
import { OutfitsStateComponent } from './outfit_plugin.js';
import { ShipPhysicsComponent } from './ship_plugin.js';
import { WeaponsStateComponent } from './weapons_state.js';
import { findControlledEntity } from './ship_control.js';

/**
 * ============================================================================
 * Accepting a mission IN FLIGHT
 * ============================================================================
 *
 * A përs ship can offer a mission when you hail it or when you board it
 * (përs Flags 0x0200, "Offer the LinkMission when boarding instead of
 * when hailing"; mïsn AvailLoc 2, "Offered from ship"). Both happen while
 * the player is FLYING, and that is the whole problem this module exists
 * to solve.
 *
 * WHY IT NEEDS A NEW INPUT KIND. Every other mission acceptance in the
 * game happens while DOCKED, where the player's ship entity is OUT of the
 * simulation and the client owns it outright: `MissionSession` mutates a
 * working copy and `commit()` writes it back, and the whole result
 * re-enters the sim later inside the liftoff `addEntity` record. In
 * flight that entity belongs to the simulation, and the display's copy is
 * a one-way mirror that the next frame overwrites — so committing a
 * session against it would change nothing, on any peer. (mission_info.ts
 * says as much where it greys the Abort button in flight: "an in-flight
 * abort would need an input-record path of its own.") This is that path.
 *
 * ============================================================================
 * WHERE THE TRUST BOUNDARY SITS
 * ============================================================================
 *
 * The codebase has two established and opposite disciplines for input
 * records, and a mission acceptance genuinely straddles them:
 *
 *  - `applyHail`: "the record carries intent only, never a client-chosen
 *    credit figure, so a tampered client can't grant itself a free
 *    repair." Every amount is recomputed sim-side.
 *  - `addEntity` / mission-ship spawning: "the entities are baked into
 *    the record, so the spawn is deterministic for every peer even though
 *    the owner rolled the dude table with plain randomness."
 *
 * Which discipline applies is decided by ONE question: can the simulation
 * reproduce the value? For a hail bribe it can — `bribeAmount` is a pure
 * function of synced state — so it must. For a mission acceptance it
 * cannot, and not for want of trying: the sim has no access to mission
 * game data AT ALL (a deliberate architectural line — see
 * player_state_plugin's header and stellar_clearance.ts, "the mission
 * data lives in the spaceport's MissionUniverse and is NOT reachable from
 * the simulation"). Resolving an offer means rolling AvailRandom, picking
 * a destination stellar out of a filtered candidate list, evaluating NCB
 * expressions, and running the OnAccept set string, which can grant
 * outfits, set bits, award ranks and pay. None of that is reproducible
 * sim-side, so it is resolved on the owning client — exactly as
 * `buildMissionShipSpawns` resolves its dude rolls — and baked in.
 *
 * WHAT IS BAKED, AND WHAT THE SIM STILL ENFORCES. The record carries the
 * accept's RESULT as DELTAS rather than absolutes, which is the
 * load-bearing choice: a delta composes with whatever else the simulation
 * did between the client computing it and the sim applying it, which
 * matters because rollback can resimulate the intervening ticks with
 * different content. An absolute ("set credits to 4212") would silently
 * undo any concurrent purchase or plunder; a delta ("+2000") survives it.
 *
 * The sim then enforces the invariants it CAN check without mission data,
 * and they are the ones that matter for a hostile client:
 *   - the actor is resolved from `peerId`, never named in the record, so
 *     no peer can accept a mission on somebody else's behalf;
 *   - a mission already active is a no-op, so a replayed or duplicated
 *     record cannot pay twice;
 *   - the 16-mission cap (MAX_ACTIVE_MISSIONS) is re-checked;
 *   - credits and cargo are clamped at zero — a negative delta can empty
 *     a hold or a purse but never produce a debt, and EV Nova has no debt.
 *
 * A tampered client can therefore still hand itself a mission it was not
 * offered. That is not a new hole: the same client can already write any
 * ship it likes into an `addEntity` record. Closing it would mean putting
 * the entire mission universe in the simulation, which is a much larger
 * design change than this one, and it is recorded here rather than
 * implied.
 */

/** One mission ship the accept spawns, baked into the record. */
export const AcceptedMissionShipType = t.type({
    uuid: t.string,
    entity: t.UnknownRecord,
});

/**
 * The result of an in-flight mission acceptance, as it crosses the wire.
 *
 * JSON-SAFE BY CONSTRUCTION, which is not optional: input records reach
 * other peers through `JSON.stringify` (socket_channel_client), so a Map,
 * a Set or a Position class instance would arrive as `{}`. Every field
 * here is a primitive, an array, or an io-ts ENCODED value — the mission
 * goes through ActiveMissionType.encode, whose `map` codec emits tuple
 * pairs, and the ships through the Serializer, exactly as `addEntity`
 * already does.
 */
export const AcceptedMissionType = t.intersection([t.type({
    /** The mïsn global id being accepted. */
    missionId: t.string,
    /** The fully resolved ActiveMission, encoded (see the module note on
     * why the client resolves it). Null for an `autoAborted` accept,
     * which never produces one. */
    mission: t.unknown,
}), t.partial({
    /**
     * mïsn Flags 0x0001 in its IMMEDIATE form: "the mission auto-aborts
     * as soon as it is accepted", used by missions whose only purpose is
     * to fire a set of effects. The mission never becomes active, so
     * `mission` is null and nothing is added to the player's list — but
     * its EFFECTS are real, and for a ship-offered one they are the whole
     * point.
     *
     * The stock case is mïsn 133 "Derelict Decoy": autoAbort +
     * cantRefuse + invisible, PayVal 0, OnAccept empty, ShipCount 4,
     * ShipDude 133 (Pirate), ShipBehav 0 ("always attack the player"),
     * ShipStart 1 ("jump in from hyperspace"). Its entire content is the
     * four pirates in `ships` below — the trap you took the bait for.
     *
     * IDEMPOTENCE for this shape cannot come from the mission list (there
     * is no mission to find there), so it comes from the offering hull:
     * see ShipOfferSpentComponent.
     */
    autoAborted: t.boolean,
    /**
     * The uuid of the ship that offered it (a përs). Carried so the sim
     * can settle the përs's own consequences — Flags 0x0100 "don't spawn
     * again", Flags 0x0040 "replace it with the special ship" — against
     * the right hull, and so a spec can see which ship an offer came
     * from. The offer's VALIDITY is not re-derived from it; see the
     * module note.
     */
    offeredBy: t.string,
    /**
     * What accepting does to the OFFERING hull, decided by the përs
     * flags on the client (shipOfferConsequence) because the simulation
     * cannot read përs data:
     *
     *  'replace'  përs Flags 0x0040, "when its LinkMission (with a
     *             single special ship) is accepted, the special ship
     *             replaces this përs ship in place". The `ships` batch
     *             below IS the replacement — built at the përs's own
     *             position — so the hull is deleted in the SAME apply
     *             and the ship visibly "becomes" the special ship.
     *             (Matthew's ruling: the përs is never pulled out of the
     *             world and put back; one atomic swap.)
     *  'leave'    përs Flags 0x0800, "the person leaves after its
     *             mission is accepted". The hull is NOT deleted — its
     *             own NPC AI is told to depart now, so it flies out
     *             under power the way any other NPC leaves a system.
     *
     * Absent means 'stay' (the derelicts you board keep floating there).
     */
    offeredByFate: t.union([t.literal('replace'), t.literal('leave')]),
    /** Signed credit change from the accept (PayVal, OnAccept's Pxxx). */
    creditsDelta: t.number,
    /** Control bits the OnAccept set string set / cleared. */
    bitsSet: t.array(t.number),
    bitsCleared: t.array(t.number),
    /** Ranks the OnAccept set string granted / revoked (Kxxx). */
    ranksGranted: t.array(t.string),
    ranksRevoked: t.array(t.string),
    /** Signed per-outfit change (Gxxx/Dxxx grants and removals). */
    outfitsDelta: t.array(t.tuple([t.string, t.number])),
    /** Signed per-commodity change, including the mission cargo loaded at
     * accept time (PickupMode 0). */
    cargoDelta: t.array(t.tuple([t.string, t.number])),
    /**
     * Special/aux ships this acceptance spawns INTO THE CURRENT SYSTEM —
     * the Derelict Decoy's four pirates jumping in the moment you take
     * the bait. They ride this record rather than a follow-up input so
     * the mission and its ambush land on the same tick on every peer:
     * a second record could be reordered against another peer's, or lost
     * if the client died in between, leaving a mission whose ships never
     * came.
     */
    ships: t.array(AcceptedMissionShipType),
})]);
export type AcceptedMission = t.TypeOf<typeof AcceptedMissionType>;

/**
 * "This hull's LinkMission offer has been taken." Written onto the
 * OFFERING përs ship the tick an acceptance naming it is applied.
 *
 * WHY THE MARKER LIVES ON THE SHIP. Every other in-flight acceptance is
 * made idempotent by the player's own mission list — a mission already
 * there is a no-op — and that guard is what makes a duplicated or
 * double-clicked record harmless. An `autoAborted` mission never joins
 * that list, so it has no such key, and its effects (four pirates) are
 * exactly the kind you must not get twice. The offering hull is the
 * natural key: an offer belongs to ONE ship, is taken ONCE, and the
 * marker dies with the ship, so nothing accumulates in player state.
 *
 * It also stops the DISPLAY re-offering from a hull whose offer is
 * already spent — the component is serializer-registered, so every peer
 * (and the local dialog code) sees it — which is the in-flight reading
 * of the Bible's "don't offer this again". Refusing does NOT set it:
 * the original re-offers a refused mission on the next hail.
 */
export const ShipOfferSpentType = t.type({
    /** The mïsn that was taken from this hull. */
    missionId: t.string,
});
export type ShipOfferSpent = t.TypeOf<typeof ShipOfferSpentType>;
export const ShipOfferSpentComponent =
    new Component<ShipOfferSpent>('ShipOfferSpentComponent');

/**
 * Applies an in-flight mission acceptance on every peer, at the same
 * tick. Mirrors `applyHail`: the actor comes from `peerId`, never from
 * the record, and everything the simulation can check without mission
 * data is re-checked here before anything is mutated.
 *
 * Synchronous and free of randomness and wall-clock reads, as every
 * input-apply path must be (the rollback driver replays it).
 */
export function applyAcceptMission(world: World, peerId: string | undefined,
    accepted: AcceptedMission): void {
    const controlled = findControlledEntity(world, peerId);
    if (!controlled) {
        return;
    }
    const player = controlled.entity;
    const missions = player.components.get(MissionsComponent);
    if (!missions) {
        return;
    }
    // IDEMPOTENT: a duplicated or replayed record must not pay twice.
    // This is also what makes the record safe to resimulate.
    if (missions.has(accepted.missionId)) {
        return;
    }
    // The SECOND idempotence key, for offers made by a ship: the hull
    // that made the offer. It is the only one an `autoAborted` accept
    // has (see ShipOfferSpentComponent), and it also stops two racing
    // records — a double-clicked Accept — from taking one offer twice.
    const offering = accepted.offeredBy
        ? world.entities.get(accepted.offeredBy) : undefined;
    if (offering?.components.has(ShipOfferSpentComponent)) {
        return;
    }
    if (accepted.autoAborted) {
        // An immediate auto-abort has no mission to add and no hull-less
        // idempotence key, so it is only honoured when it names the hull
        // that offered it — which is the only way one is ever produced.
        if (!offering) {
            return;
        }
    } else {
        if (missions.size >= MAX_ACTIVE_MISSIONS) {
            return;
        }
        const decoded = ActiveMissionType.decode(accepted.mission);
        if (isLeft(decoded)) {
            console.warn('Dropping acceptMission input for '
                + `${accepted.missionId}: the mission failed to decode`);
            return;
        }
        missions.set(accepted.missionId, decoded.right);
    }
    if (offering) {
        offering.components.set(ShipOfferSpentComponent,
            { missionId: accepted.missionId });
    }

    if (accepted.creditsDelta) {
        const credits = player.components.get(CreditsComponent);
        if (credits) {
            // Clamped at zero: a mission may cost more than the player
            // has, but EV Nova has no debt.
            credits.credits =
                Math.max(0, credits.credits + accepted.creditsDelta);
        }
    }
    const bits = player.components.get(ControlBitsComponent);
    if (bits) {
        for (const bit of accepted.bitsSet ?? []) {
            bits.add(bit);
        }
        for (const bit of accepted.bitsCleared ?? []) {
            bits.delete(bit);
        }
    }
    const ranks = player.components.get(ActiveRanksComponent);
    if (ranks) {
        for (const rank of accepted.ranksGranted ?? []) {
            ranks.add(rank);
        }
        for (const rank of accepted.ranksRevoked ?? []) {
            ranks.delete(rank);
        }
    }
    const cargo = player.components.get(CargoComponent);
    if (cargo) {
        for (const [key, delta] of accepted.cargoDelta ?? []) {
            const left = (cargo.get(key) ?? 0) + delta;
            if (left > 0) {
                cargo.set(key, left);
            } else {
                cargo.delete(key);
            }
        }
    }
    const outfits = player.components.get(OutfitsStateComponent);
    if (outfits && (accepted.outfitsDelta?.length ?? 0) > 0) {
        for (const [id, delta] of accepted.outfitsDelta ?? []) {
            const left = (outfits.get(id)?.count ?? 0) + delta;
            if (left > 0) {
                outfits.set(id, { count: left });
            } else {
                outfits.delete(id);
            }
        }
        // The same re-derivation MissionSession.commit does when outfits
        // change: weapons and physics are computed FROM the outfit set,
        // so they are dropped and rebuilt by their provider systems.
        player.components.delete(WeaponsStateComponent);
        player.components.delete(ShipPhysicsComponent);
    }

    // The ships come last, after the mission they belong to is in place:
    // MissionShipTrackSystem looks its objective up through the owner's
    // MissionsComponent, so a ship inserted first would spend a tick
    // untracked (and, worse, be deleted by MissionShipCleanupSystem,
    // which removes any mission ship whose owner has no such mission).
    const serializer = world.resources.get(SerializerResource);
    for (const ship of accepted.ships ?? []) {
        if (!serializer) {
            break;
        }
        const decodedShip = serializer.decode(ship.entity as EncodedEntity);
        if (isLeft(decodedShip)) {
            console.warn(`Dropping mission ship ${ship.uuid}: `
                + serializer.describeDecodeFailure(
                    ship.entity as EncodedEntity, decodedShip.left));
            continue;
        }
        deriveEntityComponents(world, decodedShip.right);
        world.entities.set(ship.uuid, decodedShip.right);
    }

    applyOfferingShipFate(world, accepted);
}

/**
 * The offering përs hull's own fate, applied on the same tick as the
 * acceptance so the swap is never observable half-done.
 *
 * The DECISION was made client-side (përs Flags 0x0040 / 0x0800 —
 * shipOfferConsequence), because the përs record is mission-adjacent
 * game data the simulation deliberately cannot read; only the verb
 * crosses the wire. Both branches are idempotent, which is what makes
 * them safe under rollback resimulation: a missing entity is a no-op,
 * and setting an already-past departAt again changes nothing.
 *
 * Deliberately NOT here: përs Flags 0x0100 ("don't spawn again after
 * its LinkMission is accepted"). Përs spawning is SHARED genesis state
 * driven by the system's përs table (pers_plugin's documented gap: "a
 * killed person can reappear on the next eligible spawn draw"), and one
 * player's accepted mission must not delete a person out of everybody
 * else's galaxy. It waits on per-player përs-alive tracking, exactly as
 * the kill case does.
 */
function applyOfferingShipFate(world: World,
    accepted: AcceptedMission): void {
    const uuid = accepted.offeredBy;
    if (!uuid || !accepted.offeredByFate) {
        return;
    }
    const offering = world.entities.get(uuid);
    if (!offering) {
        return;
    }
    if (accepted.offeredByFate === 'replace') {
        // The replacement is already in `ships` above, spawned at this
        // hull's own position: deleting it here completes the swap.
        world.entities.delete(uuid);
        return;
    }
    // 'leave': the person departs under their own power. departAt is the
    // NPC AI's "start heading out" stamp (npc_ai_plugin); 0 is in the
    // past on any clock, so the next AI step begins the departure.
    const npc = offering.components.get(NpcComponent);
    if (npc) {
        npc.departAt = 0;
    }
}
