import { Entity } from 'nova_ecs/entity';
import { PersData } from 'novadatainterface/pers_data';
import { ShipData } from 'novadatainterface/ship_data';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { CargoComponent, OutfitsStateComponent, ShipComponent } from '../nova_plugin/ship/index.js';
import {
    AcceptedMission, acceptOffer, LOCATION_SHIP, makeMissionOffer, MissionEvent, MissionOffer,
    missionMatchesLocation,
} from '../nova_plugin/missions/index.js';
import {
    ShipObjective, ActiveMissionType, CreditsComponent, GameDateComponent, MissionsComponent,
    dayNumber,
} from '../nova_plugin/player/index.js';
import {
    ActiveRanksComponent, AggressionSuppressGovtsComponent,
    ControlBitsComponent,
} from '../nova_plugin/ncb/index.js';
import {
    CombatRatingComponent, LegalRecordsComponent,
} from '../nova_plugin/reputation/index.js';
import { MissionSession } from './mission_session.js';
import { MissionUniverse } from './mission_universe.js';
import {
    shipOffers, ShipOfferTrigger, shipOfferTrigger,
} from './ship_mission_offer.js';

/**
 * ============================================================================
 * Turning an in-flight accept into an input record
 * ============================================================================
 *
 * The problem: `MissionSession` is the ONLY correct implementation of
 * "what does accepting this mission do" — it runs OnAccept's set string
 * with all its Sxxx/Axxx/Fxxx/Gxxx/Kxxx operators, applies reputation,
 * loads start-time cargo, advances the date, and handles auto-abort — and
 * it works by mutating an Entity and committing to it. In flight there is
 * no entity the client may commit to: the display's copy is a one-way
 * mirror the next simulation frame overwrites.
 *
 * The resolution, and the reason this file is short: run the real
 * machinery against a DETACHED COPY of the player's state, then DIFF the
 * copy against what we started with. The diff is the delta set the input
 * record carries (mission_accept.ts), so the sim applies exactly what the
 * docked path would have written — without this module having to know
 * what a set string can do. Anything a future set-string operator learns
 * to change is picked up for free, as long as it lands in one of the
 * components below.
 *
 * WHAT THE COPY MUST CARRY is everything MissionSession reads or writes,
 * which is enumerated once in `detachPlayerState`. A component missing
 * from that list would make the session see an empty value and diff to a
 * wrong delta, so it is written as an explicit list rather than a
 * best-effort clone.
 *
 * DETERMINISM. The rolls here (AvailRandom, destination choice, <SN>) are
 * plain `Math.random` on the owning client, exactly as the docked path
 * and `buildMissionShipSpawns` roll theirs — the RESULT is baked into the
 * record, so every peer applies the same numbers. Nothing in this file
 * runs inside the simulation.
 */

/** Everything MissionSession reads or writes on the player's entity. */
function detachPlayerState(player: Entity): Entity {
    const copy = new Entity(player.name);
    const ship = player.components.get(ShipComponent);
    if (ship) {
        copy.components.set(ShipComponent, { ...ship });
    }
    const date = player.components.get(GameDateComponent);
    if (date) {
        copy.components.set(GameDateComponent, { ...date });
    }
    const credits = player.components.get(CreditsComponent);
    copy.components.set(CreditsComponent,
        { credits: credits?.credits ?? 0 });
    const missions = player.components.get(MissionsComponent);
    copy.components.set(MissionsComponent, new Map(
        [...(missions ?? [])].map(([id, active]) => [id, { ...active }])));
    copy.components.set(CargoComponent,
        new Map(player.components.get(CargoComponent) ?? []));
    copy.components.set(ControlBitsComponent,
        new Set(player.components.get(ControlBitsComponent) ?? []));
    copy.components.set(ActiveRanksComponent,
        new Set(player.components.get(ActiveRanksComponent) ?? []));
    // The baked ränk 0x0100 set travels with the ranks it was derived
    // from; MissionSession.commit re-derives it if the accept moves a
    // rank, and the diff below carries the change to the simulation.
    copy.components.set(AggressionSuppressGovtsComponent, new Set(
        player.components.get(AggressionSuppressGovtsComponent) ?? []));
    copy.components.set(LegalRecordsComponent,
        new Map(player.components.get(LegalRecordsComponent) ?? []));
    const rating = player.components.get(CombatRatingComponent);
    if (rating) {
        copy.components.set(CombatRatingComponent, { ...rating });
    }
    const outfits = player.components.get(OutfitsStateComponent);
    copy.components.set(OutfitsStateComponent, new Map(
        [...(outfits ?? [])].map(([id, state]) => [id, { ...state }])));
    return copy;
}

/** Signed differences between two count maps, dropping the zeroes. */
function diffCounts(before: ReadonlyMap<string, number>,
    after: ReadonlyMap<string, number>): [string, number][] {
    const keys = [...new Set([...before.keys(), ...after.keys()])].sort();
    const deltas: [string, number][] = [];
    for (const key of keys) {
        const delta = (after.get(key) ?? 0) - (before.get(key) ?? 0);
        if (delta !== 0) {
            deltas.push([key, delta]);
        }
    }
    return deltas;
}

/** Members added to / removed from a set. */
function diffSet<T>(before: ReadonlySet<T>, after: ReadonlySet<T>):
    { added: T[], removed: T[] } {
    return {
        added: [...after].filter(x => !before.has(x)),
        removed: [...before].filter(x => !after.has(x)),
    };
}

/**
 * The stellar an in-flight mission context stands on: one in the system
 * the player is flying in, or MissionSession's neutral '<in-flight>'
 * sentinel when there is none to borrow. See buildShipMissionOffer's
 * note for why the machinery wants one at all.
 */
export function inFlightStellar(universe: MissionUniverse,
    systemId: string | undefined): string {
    return (systemId ? universe.stellarInSystem(systemId) : undefined)
        ?? '<in-flight>';
}

/**
 * ============================================================================
 * Resolving what a përs ship is offering, right now, in flight
 * ============================================================================
 *
 * The docked boards roll a whole LOCATION's worth of missions
 * (mission_offers' rollOffers); a përs offers exactly one — its
 * LinkMission — so this resolves that one mission through the SAME
 * pipeline: the availability sweep (missionMatchesLocation at
 * LOCATION_SHIP), the AvailRandom percentage roll, and makeMissionOffer
 * to freeze the destination / cargo / ship-objective choices.
 *
 * THE OFFER CONTEXT HAS NO LANDING, so it borrows a stellar from the
 * system the player is flying in (MissionUniverse.stellarInSystem). The
 * machinery is written around "where is this being offered" in three
 * places and all three want the system, not a specific rock: AvailStel is
 * judged against it (every stock AvailLoc 2 mission is AvailStel -1, "any
 * inhabited stellar"), ShipSyst -1 — "the system the mission was offered
 * in", which mïsn 133's four pirates use — is resolved THROUGH it, and
 * the ActiveMission records it as `acceptedAt`.
 *
 * Without a system (or in one with no stellars at all) it falls back to
 * MissionSession's '<in-flight>' sentinel, the established answer for
 * in-flight mission work (processInFlightMissions uses it), which
 * supplies a neutral inhabited government-less stellar. Missions whose
 * ships spawn relative to the offering system then become unofferable
 * rather than spawning them somewhere arbitrary.
 *
 * SESSION SAFETY. MissionSession copies every map/set it works with out
 * of the entity and only writes back on commit(), which is never called
 * here — so building an offer against the display's one-way mirror of
 * the player leaves the mirror a mirror.
 *
 * DETERMINISM: none of this is in the simulation. The rolls are the
 * owning client's, and only the RESULT (buildShipMissionAccept's record)
 * ever crosses the wire.
 */
export async function buildShipMissionOffer(player: Entity, pers: PersData,
    trigger: ShipOfferTrigger,
    gameData: SimulationGameDataInterface, universe: MissionUniverse,
    options: {
        /** The system the player (and the offering ship) is in. */
        systemId?: string,
        random?: () => number,
    } = {}): Promise<MissionOffer | null> {
    const random = options.random ?? Math.random;
    if (!pers.linkMission || shipOfferTrigger(pers) !== trigger) {
        return null;
    }
    await universe.load();
    const mission = universe.getMission(pers.linkMission);
    if (!mission) {
        return null;
    }
    const session = await MissionSession.create(player, gameData, universe,
        inFlightStellar(universe, options.systemId));
    const ctx = session.machinery.offerContext();
    if (!missionMatchesLocation(mission, LOCATION_SHIP, ctx)) {
        return null;
    }
    // AvailRandom, rolled per encounter exactly as the boards roll it
    // per opening. The original re-offers a refused mission on the next
    // hail, so a fresh roll per hail is the faithful behaviour.
    if (mission.availRandom < 100
        && random() * 100 >= mission.availRandom) {
        return null;
    }
    const offer = makeMissionOffer(mission, ctx);
    if (!offer || !offer.acceptable) {
        return null;
    }
    // The three "not for a ship like yours" bits need the PLAYER's hull
    // (shipOffers' note); resolved last, since it is the only gate that
    // cannot be answered from the përs and the mission alone.
    let playerShip: ShipData | undefined;
    try {
        const shipId = player.components.get(ShipComponent)?.id;
        playerShip = shipId
            ? await gameData.data.Ship.get(shipId) : undefined;
    } catch {
        // Unknown hull: the hull-shaped gates simply don't fire.
    }
    if (!shipOffers(pers, { trigger, missionAvailable: true, playerShip })) {
        return null;
    }
    return offer;
}

/** The record, plus the texts the popup shows after accepting. */
export interface ShipMissionAccept {
    record: AcceptedMission;
    /**
     * The mission as it ended up, for the briefing's substitutions and
     * for building its special ships. UNDEFINED for an immediate
     * auto-abort (mïsn 133 "Derelict Decoy"), which never becomes
     * active — its ships come from the offer's own frozen objective
     * instead (see `shipObjective` below).
     */
    active: ReturnType<typeof missionsAfter>;
    /**
     * The mission-ship source to hand to buildAcceptedMissionShips: the
     * accepted mission, or — for an immediate auto-abort — a stand-in
     * built from the offer, so the trap still springs.
     */
    shipSource: {
        shipObjective?: ShipObjective,
        shipName?: string,
        shipSubtitle?: string,
        travelPlanet: string | null,
        returnPlanet: string | null,
    };
    /** What the accept produced for the player to read (the briefing,
     * or the auto-abort's own notice). */
    events: MissionEvent[];
}

function missionsAfter(copy: Entity, missionId: string) {
    return copy.components.get(MissionsComponent)?.get(missionId);
}

/**
 * Accepts `offer` against a detached copy of the player's state and
 * returns the input record that reproduces it in the simulation, or null
 * when the accept was refused (a full hold, the 16-mission cap).
 *
 * `player` is the DISPLAY world's mirror of the player's ship; it is read
 * and never written, so the mirror stays a mirror.
 *
 * `ships` is left to the caller rather than built here because the ships
 * are built FROM the mission this call resolves (buildAcceptedMissionShips
 * takes the returned `active`): the caller runs the two in order and
 * attaches the batch to `record.ships` before dispatching. That keeps the
 * whole acceptance on one input record — see AcceptedMissionType's note on
 * why the ambush cannot ride a second one.
 */
export async function buildShipMissionAccept(player: Entity,
    offer: MissionOffer, gameData: SimulationGameDataInterface,
    universe: MissionUniverse, options: {
        /** Entity uuid of the përs ship that made the offer. */
        offeredBy?: string,
        /** What accepting does to that hull (shipOfferConsequence). */
        offeredByFate?: 'replace' | 'leave',
        ships?: { uuid: string, entity: unknown }[],
        /** The system the offer was made in; MUST be the one the offer
         * was resolved against, or the accept re-rolls a different
         * destination and ship system than the player was shown. */
        systemId?: string,
    } = {}): Promise<ShipMissionAccept | null> {
    const { offeredBy, offeredByFate } = options;
    const ships = options.ships ?? [];
    const copy = detachPlayerState(player);
    // No checkpoint announcement from the detached copy: it lacks the
    // outfits/cron/etc. components a snapshot needs. The client's periodic
    // save notices the new mission on the real player entity instead
    // (checkpoint_requests.ts describeFlightChanges).
    const session = await MissionSession.create(copy, gameData, universe,
        inFlightStellar(universe, options.systemId),
        { announceCheckpoints: false });
    const before = detachPlayerState(copy);
    const result = acceptOffer(session.machinery, offer, session.outfits);
    if (!result.accepted) {
        return null;
    }
    const events = session.commit();

    const creditsBefore = before.components.get(CreditsComponent)!.credits;
    const creditsAfter = copy.components.get(CreditsComponent)!.credits;
    // mïsn DatePostInc: an immediate auto-abort settles at accept, so
    // MissionSession.commit has already pushed the copy's calendar. Diffed
    // like everything else here rather than read off the mïsn, so whatever
    // else learns to move the date is carried for free.
    const dateBefore = before.components.get(GameDateComponent);
    const dateAfter = copy.components.get(GameDateComponent);
    const dateDelta = dateBefore && dateAfter
        ? dayNumber(dateAfter) - dayNumber(dateBefore) : 0;
    const bits = diffSet(before.components.get(ControlBitsComponent)!,
        copy.components.get(ControlBitsComponent)!);
    const ranks = diffSet(before.components.get(ActiveRanksComponent)!,
        copy.components.get(ActiveRanksComponent)!);
    // The ränk 0x0100 suppression set the sim reads. Diffed like the ranks
    // themselves rather than re-derived on the far side, because the
    // simulation has no ränk data to derive it from (rank_logic.ts).
    const suppressGovts = diffSet(
        before.components.get(AggressionSuppressGovtsComponent)
        ?? new Set<string>(),
        copy.components.get(AggressionSuppressGovtsComponent)
        ?? new Set<string>());
    const cargo = diffCounts(before.components.get(CargoComponent)!,
        copy.components.get(CargoComponent)!);
    const outfitCounts = (entity: Entity) => new Map(
        [...(entity.components.get(OutfitsStateComponent) ?? [])]
            .map(([id, state]) => [id, state.count] as const));
    const outfits = diffCounts(outfitCounts(before), outfitCounts(copy));
    // The REST of the mission list: what the OnAccept's own Sxxx started
    // and its Axxx/Fxxx ended, besides the mission being accepted (which
    // has its own field below). See AcceptedMissionType.missionsStarted.
    const missionsBefore = before.components.get(MissionsComponent)!;
    const missionsNow = copy.components.get(MissionsComponent)!;
    const missionsStarted: [string, unknown][] = [...missionsNow]
        .filter(([id]) => id !== offer.data.id && !missionsBefore.has(id))
        .map(([id, started]) => [id, ActiveMissionType.encode(started)]);
    const missionsEnded = [...missionsBefore.keys()]
        .filter(id => !missionsNow.has(id));
    const records = diffCounts(
        before.components.get(LegalRecordsComponent)!,
        copy.components.get(LegalRecordsComponent)!);

    const active = missionsAfter(copy, offer.data.id);
    // An IMMEDIATE auto-abort mission never becomes active
    // (mission_logic's acceptOffer) — but its effects are real, and for
    // a ship-offered one they are the entire mission: mïsn 133's four
    // pirates. The record says so with `autoAborted`, the sim skips the
    // mission list, and the offering hull carries the idempotence key
    // that the missing mission would otherwise have been
    // (ShipOfferSpentComponent). The ships come from the OFFER's frozen
    // objective, which is where they lived before acceptOffer discarded
    // the mission around them.
    const autoAborted = !active;
    if (autoAborted && !offeredBy) {
        // No hull to key on. The only producer of one of these is a
        // përs offer, so this cannot happen in practice; refusing is
        // still cheaper than shipping a record the sim will drop.
        return null;
    }

    return {
        active,
        events,
        shipSource: active ?? {
            shipObjective: offer.shipObjective,
            travelPlanet: offer.travelPlanet,
            returnPlanet: offer.returnPlanet,
            // An auto-aborted mission's <SN> lives only as long as its
            // notice (acceptOffer's comment), so the ships take the
            // per-spawn random pick, as they did before <SN> existed.
        },
        record: {
            missionId: offer.data.id,
            mission: active ? ActiveMissionType.encode(active) : null,
            ...(autoAborted ? { autoAborted: true } : {}),
            ...(offeredBy ? { offeredBy } : {}),
            // Only meaningful beside an offeredBy, and only when the
            // përs flags actually said to do something ('stay' is the
            // absence of the field).
            ...(offeredBy && offeredByFate ? { offeredByFate } : {}),
            ...(creditsAfter !== creditsBefore
                ? { creditsDelta: creditsAfter - creditsBefore } : {}),
            ...(dateDelta > 0 ? { dateDelta } : {}),
            ...(bits.added.length ? { bitsSet: bits.added } : {}),
            ...(bits.removed.length ? { bitsCleared: bits.removed } : {}),
            ...(ranks.added.length ? { ranksGranted: ranks.added } : {}),
            ...(ranks.removed.length ? { ranksRevoked: ranks.removed } : {}),
            ...(suppressGovts.added.length
                ? { suppressGovtsAdded: suppressGovts.added } : {}),
            ...(suppressGovts.removed.length
                ? { suppressGovtsRemoved: suppressGovts.removed } : {}),
            ...(cargo.length ? { cargoDelta: cargo } : {}),
            ...(outfits.length ? { outfitsDelta: outfits } : {}),
            ...(missionsStarted.length ? { missionsStarted } : {}),
            ...(missionsEnded.length ? { missionsEnded } : {}),
            ...(records.length ? { recordsDelta: records } : {}),
            ...(ships.length ? { ships: ships as never } : {}),
        },
    };
}
