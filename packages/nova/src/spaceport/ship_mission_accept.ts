import { Entity } from 'nova_ecs/entity';
import { PersData } from 'novadatainterface/pers_data';
import { PlanetData } from 'novadatainterface/planet_data';
import { ShipData } from 'novadatainterface/ship_data';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { CargoComponent, OutfitsStateComponent, ShipComponent } from '../nova_plugin/ship/index.js';
import {
    abortMission, AbortedMission,
    AcceptedMission, AcceptedMissionShip, acceptOffer, EncodedActiveMission,
    failMissionInFlight, failureOwed,
    LOCATION_SHIP, makeMissionOffer, MissionEvent, MissionOffer,
    MissionSetString, MissionSetStringKind,
    missionMatchesLocation, RefusedMission, refuseOffer, runDeferredAutoAbort,
    runMissionSetString, runShipDoneSetString, SetStringEffects,
    setStringPrefix, ShipChange, shipDoneOwed, SystemMove,
} from '../nova_plugin/missions/index.js';
import {
    ShipObjective, ActiveMission, ActiveMissionType, CreditsComponent, GameDateComponent, MissionsComponent,
    dayNumber, StellarSetStringKind,
} from '../nova_plugin/player/index.js';
import {
    ActiveRanksComponent, AggressionSuppressGovtsComponent,
    ControlBitsComponent,
} from '../nova_plugin/ncb/index.js';
import {
    CombatRatingComponent, LegalGeography, LegalRecordsComponent,
} from '../nova_plugin/reputation/index.js';
import {
    MissionSession, missionNotices, replaceMap,
} from './mission_session.js';
import { warmChangeShipTargets } from './change_ship_targets.js';
import { buildChangedShip } from './shipyard_rules.js';
import { MissionUniverse } from './mission_universe.js';
import {
    shipOffers, ShipOfferTrigger, shipOfferTrigger,
} from './ship_mission_offer.js';
import type { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import {
    anySetStringRequests, emptySetStringRequests, pickShipName,
    recordSetStringRequests, SetStringRequests,
} from './set_string_requests.js';

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

/**
 * Signed differences between two per-system record maps, each read as the
 * simulation reads it (an absent entry is the system's InitialRec), so a
 * record cleaned from an absent negative InitialRec to 0 is a change the
 * apply (mission_accept.ts's applySetStringEffects) composes over the same
 * reading. Zeroes dropped, systems sorted.
 */
function diffRecords(before: ReadonlyMap<string, number>,
    after: ReadonlyMap<string, number>,
    geography: LegalGeography): [string, number][] {
    const keys = [...new Set([...before.keys(), ...after.keys()])].sort();
    const deltas: [string, number][] = [];
    for (const key of keys) {
        const delta = geography.recordIn(after, key)
            - geography.recordIn(before, key);
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
    /**
     * The player's control bits AFTER the accept (its OnAccept applied):
     * what buildAcceptedMissionShips must read, so the ships of a mission
     * taken in flight see the same bits as the ones the per-entry sweep
     * builds from the player entity later — shïp AppearOn on the düde
     * draw, and the visible copy of a stacked system.
     */
    bits: ReadonlySet<number>;
    /**
     * The OnAccept's `Qxxx` messages, in order: the STR# number and the
     * plug-in prefix it resolves against. In flight there is no stellar to
     * leave, so the message on the status line is all of it (the stock
     * Refuel Trader's "Q25057", "<OSN>: Ready for docking, <PSN>.",
     * reference "The Refuel Trader rescue", 2026-11-27). Display-only:
     * nothing in the simulation reads them.
     */
    statusQuotes: { stringId: number, prefix: string }[];
    /** The OnAccept's display requests (its `Qxxx` — the statusQuotes
     * above — `Pxxx` and `Txxx`; set_string_requests.ts). */
    requests: SetStringRequests;
}

/**
 * What every in-flight builder below takes besides the system: the display
 * assets a `Txxx` picks the ship's new name from (its STR#), when the
 * caller has them — without them a `Txxx` is recorded in `requests` but
 * names nothing on the record.
 */
export interface DetachedSetStringOptions {
    systemId?: string;
    displayAssets?: DisplayAssetDataInterface;
}

/**
 * A `Txxx`'s name onto the record's effects (`shipName`), picked from its
 * STR# now that the synchronous string is done (set_string_requests.ts).
 */
async function nameShip(effects: SetStringEffects,
    requests: SetStringRequests,
    displayAssets: DisplayAssetDataInterface | undefined):
    Promise<SetStringEffects> {
    if (!displayAssets || requests.shipNames.length === 0) {
        return effects;
    }
    const name = await pickShipName(displayAssets, requests.shipNames);
    return name === undefined ? effects : { ...effects, shipName: name };
}

/** `from`'s requests appended to a caller's sink, when it gave one. */
function copyRequests(from: SetStringRequests,
    into: SetStringRequests | undefined): void {
    if (into) {
        into.statusQuotes.push(...from.statusQuotes);
        into.sounds.push(...from.sounds);
        into.shipNames.push(...from.shipNames);
    }
}

function missionsAfter(copy: Entity, missionId: string) {
    return copy.components.get(MissionsComponent)?.get(missionId);
}

/**
 * A MissionSession over a detached copy of the player, with the in-flight
 * operators the simulation can carry out wired onto it:
 *
 *  `Cxxx` / `Exxx` / `Hxxx`  the copy's hull is swapped EXACTLY as the
 *               landed path swaps a docked one — LandedTransaction.changeShip:
 *               shipyard_rules' buildChangedShip over the WORKING outfits,
 *               the session re-pointed at the new hull and the working
 *               outfits made its own (in place) — so C / E / H mean here
 *               what they mean in a spaceport, and the rest of the string
 *               runs on the new hull. The class rides the record as
 *               `shipChange` (nova_plugin/missions/mission_ship_change.ts).
 *  `Mxxx` / `Nxxx`  recorded as `moveToSystem` for the simulation to carry
 *               out (MissionSystemMoveSystem).
 *
 * The classes a change could go to (and every outfit) are warmed first,
 * because the set string runs synchronously (change_ship_targets.ts).
 */
async function detachedSession(player: Entity,
    gameData: SimulationGameDataInterface, universe: MissionUniverse,
    systemId: string | undefined) {
    const copy = detachPlayerState(player);
    const shipIds = await warmChangeShipTargets(gameData, universe);
    // No checkpoint announcement from the detached copy: it lacks the
    // outfits/cron/etc. components a snapshot needs. The client's periodic
    // save notices the new mission on the real player entity instead
    // (checkpoint_requests.ts describeFlightChanges).
    const session = await MissionSession.create(copy, gameData, universe,
        inFlightStellar(universe, systemId),
        { announceCheckpoints: false });
    // No lift-off queue in flight: an immediate auto-abort's ships come
    // with the accept's own record (buildAcceptedMissionShips), so its
    // OnAbort runs with the accept too (mission_accept_offer.ts).
    session.state.autoAbortShips = undefined;
    const before = detachPlayerState(copy);
    const outcome: { shipChange?: ShipChange, moveToSystem?: SystemMove } = {};
    session.setChangeShipHook((id, mode) => {
        const newShip = gameData.data.Ship.getCached(id);
        if (!newShip) {
            console.warn(`Change-ship to ${id} ignored: ship data not loaded`);
            return;
        }
        const hull = buildChangedShip(session.target, newShip,
            session.outfits, outfitId => gameData.data.Outfit.getCached(outfitId),
            mode);
        session.retarget(hull, newShip.id);
        replaceMap(session.outfits,
            [...hull.components.get(OutfitsStateComponent) ?? []]
                .map(([outfitId, { count }]) => [outfitId, count] as const));
        outcome.shipChange = { shipId: newShip.id };
    }, id => shipIds.has(id));
    session.machinery.moveToSystem = (systemId, keepCoordinates) => {
        outcome.moveToSystem = { systemId, keepCoordinates };
    };
    // `Qxxx` / `Pxxx` / `Txxx`: recorded for the caller to resolve
    // against display data (set_string_requests.ts). In flight a Q has no
    // stellar to leave, so its message on the status line is all of it.
    const requests = emptySetStringRequests();
    recordSetStringRequests(session.machinery, requests);
    return { session, before, outcome, requests };
}

/**
 * What a set string did to the detached copy, as the DELTAS an in-flight
 * record carries (SetStringEffects): `before` is the copy as it was,
 * `after` the hull the session committed onto — the copy itself, or the
 * hull a change of ship swapped in. `missionId` is the mission the record
 * is ABOUT (it has a field of its own on an accept), left out of
 * missionsStarted.
 */
function diffSetStringEffects(before: Entity, after: Entity,
    missionId: string,
    outcome: { shipChange?: ShipChange, moveToSystem?: SystemMove },
    geography: LegalGeography):
    SetStringEffects {
    const creditsBefore = before.components.get(CreditsComponent)?.credits ?? 0;
    const creditsAfter = after.components.get(CreditsComponent)?.credits ?? 0;
    // mïsn DatePostInc: an immediate auto-abort settles at accept, so
    // MissionSession.commit has already pushed the copy's calendar. Diffed
    // like everything else here rather than read off the mïsn, so whatever
    // else learns to move the date is carried for free.
    const dateBefore = before.components.get(GameDateComponent);
    const dateAfter = after.components.get(GameDateComponent);
    const dateDelta = dateBefore && dateAfter
        ? dayNumber(dateAfter) - dayNumber(dateBefore) : 0;
    const bits = diffSet(
        before.components.get(ControlBitsComponent) ?? new Set<number>(),
        after.components.get(ControlBitsComponent) ?? new Set<number>());
    const ranks = diffSet(
        before.components.get(ActiveRanksComponent) ?? new Set<string>(),
        after.components.get(ActiveRanksComponent) ?? new Set<string>());
    // The ränk 0x0100 suppression set the sim reads. Diffed like the ranks
    // themselves rather than re-derived on the far side, because the
    // simulation has no ränk data to derive it from (rank_logic.ts).
    const suppressGovts = diffSet(
        before.components.get(AggressionSuppressGovtsComponent)
        ?? new Set<string>(),
        after.components.get(AggressionSuppressGovtsComponent)
        ?? new Set<string>());
    const cargo = diffCounts(before.components.get(CargoComponent) ?? new Map(),
        after.components.get(CargoComponent) ?? new Map());
    const outfitCounts = (entity: Entity) => new Map(
        [...(entity.components.get(OutfitsStateComponent) ?? [])]
            .map(([id, state]) => [id, state.count] as const));
    // A change of ship's outfits (C keeps them, E adds the class's
    // defaults, H drops the non-persistent ones) land here too: the new
    // hull's outfits against the old's.
    const outfits = diffCounts(outfitCounts(before), outfitCounts(after));
    // The REST of the mission list: what the string's own Sxxx started
    // and its Axxx/Fxxx ended, besides the mission the record is about.
    // See AcceptedMissionType.missionsStarted.
    const missionsBefore = before.components.get(MissionsComponent)
        ?? new Map<string, ActiveMission>();
    const missionsNow = after.components.get(MissionsComponent)
        ?? new Map<string, ActiveMission>();
    const missionsStarted: [string, EncodedActiveMission][] = [...missionsNow]
        .filter(([id]) => id !== missionId && !missionsBefore.has(id))
        .map(([id, started]) => [id, ActiveMissionType.encode(started)]);
    const missionsEnded = [...missionsBefore.keys()]
        .filter(id => id !== missionId && !missionsNow.has(id));
    const records = diffRecords(
        before.components.get(LegalRecordsComponent) ?? new Map(),
        after.components.get(LegalRecordsComponent) ?? new Map(), geography);
    return {
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
        ...(outcome.shipChange ? { shipChange: outcome.shipChange } : {}),
        ...(outcome.moveToSystem ? { moveToSystem: outcome.moveToSystem } : {}),
    };
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
        /** The caller builds the batch from the returned `active` and
         * attaches it to `record.ships` (see below); the entities are
         * already ENCODED by then, with the bridge's serializer. */
        ships?: AcceptedMissionShip[],
        /** The system the offer was made in; MUST be the one the offer
         * was resolved against, or the accept re-rolls a different
         * destination and ship system than the player was shown. */
        systemId?: string,
        displayAssets?: DisplayAssetDataInterface,
    } = {}): Promise<ShipMissionAccept | null> {
    const { offeredBy, offeredByFate } = options;
    const ships = options.ships ?? [];
    const { session, before, outcome, requests } = await detachedSession(
        player, gameData, universe, options.systemId);
    // A përs that is REPLACED by the special ship is the Bible's condition
    // for deferring a board/rescue auto-abort (deferredAutoAbort).
    const accepted = offeredByFate === 'replace'
        ? { ...offer, replacesPers: true } : offer;
    const result = acceptOffer(session.machinery, accepted, session.outfits);
    if (!result.accepted) {
        return null;
    }
    const events = session.commit();
    // The hull the session committed onto: the copy, or the one an
    // OnAccept `Cxxx` / `Exxx` / `Hxxx` swapped in.
    const after = session.target;
    const effects = await nameShip(diffSetStringEffects(before, after,
        offer.data.id, outcome, universe.legalGeography()), requests,
    options.displayAssets);

    const active = missionsAfter(after, offer.data.id);
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
        statusQuotes: requests.statusQuotes,
        requests,
        bits: new Set(after.components.get(ControlBitsComponent) ?? []),
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
            ...effects,
            ...(ships.length ? { ships } : {}),
        },
    };
}

/** A refusal's record, plus anything its OnRefuse gave the player to read. */
export interface ShipMissionRefusal {
    record: RefusedMission;
    /** E.g. the briefing of a mission the OnRefuse started (Sxxx). */
    events: MissionEvent[];
    /** Its `Qxxx` / `Pxxx` / `Txxx` (set_string_requests.ts). */
    requests: SetStringRequests;
}

/**
 * Refuses `offer` against a detached copy of the player's state — its
 * OnRefuse set string, run by the same machinery the landed boards run it
 * with (refuseOffer) — and returns the input record that reproduces the
 * result in the simulation. Null when there is nothing to carry or show: an
 * empty OnRefuse (every stock AvailLoc 2 mission's), or one that changed
 * nothing and asked for no line, sound or name (set_string_requests.ts).
 *
 * The motivating case is plug-in arpia's mïsn 1112, whose REFUSE button is
 * the one reading "I accept gladly." (see RefusedMissionType).
 */
export async function buildShipMissionRefusal(player: Entity,
    offer: MissionOffer, gameData: SimulationGameDataInterface,
    universe: MissionUniverse, options: {
        /** Entity uuid of the përs ship that made the offer. */
        offeredBy?: string,
        /** The system the offer was made in (see buildShipMissionAccept). */
        systemId?: string,
        displayAssets?: DisplayAssetDataInterface,
    } = {}): Promise<ShipMissionRefusal | null> {
    if (!offer.data.onRefuse?.trim()) {
        return null;
    }
    const { session, before, outcome, requests } = await detachedSession(
        player, gameData, universe, options.systemId);
    refuseOffer(session.machinery, offer, session.outfits);
    const events = session.commit();
    const effects = await nameShip(diffSetStringEffects(before,
        session.target, offer.data.id, outcome, universe.legalGeography()),
    requests, options.displayAssets);
    // A string whose only effect is display (a lone `Qxxx`: arpia's mïsn
    // 1102-1104 OnRefuse `Q25089`) still answers, for its line; the record
    // it carries then changes nothing.
    if (Object.keys(effects).length === 0
        && !anySetStringRequests(requests)) {
        return null;
    }
    return {
        events,
        requests,
        record: {
            missionId: offer.data.id,
            ...(options.offeredBy ? { offeredBy: options.offeredBy } : {}),
            ...effects,
        },
    };
}

/** An abort's record, plus anything its OnAbort gave the player to read. */
export interface MissionAbort {
    record: AbortedMission;
    events: MissionEvent[];
    /** Its OnAbort's `Qxxx` / `Pxxx` / `Txxx` (set_string_requests.ts). */
    requests: SetStringRequests;
}

/**
 * Aborts the player's mission `missionId` IN FLIGHT against a detached
 * copy of the player's state — the very abortMission the docked dialog
 * ran (OnAbort, the 0x0040 CompReward reversal, the mission cargo
 * unloaded) — and returns the input record that reproduces it in the
 * simulation (mission_accept.ts AbortedMissionType). Null when there is
 * nothing to abort: the mission is not on the player's list, or its mïsn
 * says CanAbort 0 ("This mission can't be aborted by the player").
 *
 * `player` is the display world's mirror of the player's ship, read and
 * never written, as for an accept.
 */
export async function buildMissionAbort(player: Entity, missionId: string,
    gameData: SimulationGameDataInterface, universe: MissionUniverse,
    /** `systemId`: the system the player is flying in (an OnAbort `Sxxx`
     * is offered from there, as an in-flight accept's is). */
    options: DetachedSetStringOptions = {}): Promise<MissionAbort | null> {
    await universe.load();
    if (!player.components.get(MissionsComponent)?.has(missionId)) {
        return null;
    }
    if (!(universe.getMission(missionId)?.canAbort ?? true)) {
        return null;
    }
    const { session, before, outcome, requests } = await detachedSession(
        player, gameData, universe, options.systemId);
    abortMission(session.machinery, missionId, session.outfits);
    const events = session.commit();
    const effects = await nameShip(diffSetStringEffects(before,
        session.target, missionId, outcome, universe.legalGeography()),
    requests, options.displayAssets);
    return { events, requests, record: { missionId, ...effects } };
}

/**
 * The owner's half of a DEFERRED auto-abort (mïsn Flags 0x0001 on a
 * board/rescue-goal mission offered by a përs whose ship the special ship
 * replaced — deferredAutoAbort), resolved IN FLIGHT once the simulation
 * has marked it `autoAbortPending` (the board): runDeferredAutoAbort
 * (OnAbort, no CompReward reversal, the record-cleaning Pay, DatePostInc)
 * against a detached copy of the player, returned as the same in-flight
 * abort record the 'i' dialog sends (mission_accept.ts
 * AbortedMissionType, whose apply sees the pending flag and leaves the
 * boarded ship in place). MEASURED (reference "The deferred (përs)
 * auto-abort (R16), wave 43"): the board ends the mission at once in
 * flight, and its DatePostInc comes with it.
 *
 * Null when there is nothing to send: the mission is not on the player's
 * list, or not pending. CanAbort does not apply: the player is not the
 * one aborting it. The caller drops the notices (the original shows none:
 * "Target ship has been boarded." and nothing else).
 */
export async function buildDeferredAutoAbort(player: Entity,
    missionId: string, gameData: SimulationGameDataInterface,
    universe: MissionUniverse,
    options: DetachedSetStringOptions = {}): Promise<MissionAbort | null> {
    await universe.load();
    if (!player.components.get(MissionsComponent)?.get(missionId)
        ?.autoAbortPending) {
        return null;
    }
    const { session, before, outcome, requests } = await detachedSession(
        player, gameData, universe, options.systemId);
    // A goal the board itself completed (a rescue) owes its OnShipDone
    // first, as the date advance runs it before the auto-abort; the
    // `missionSetString` record leaves an auto-aborting mission to this
    // one (mission_set_string_record.ts shipDoneOwed).
    runShipDoneSetString(session.machinery, missionId, session.outfits);
    if (!runDeferredAutoAbort(session.machinery, missionId,
        session.outfits)) {
        return null;
    }
    const events = session.commit();
    const effects = await nameShip(diffSetStringEffects(before,
        session.target, missionId, outcome, universe.legalGeography()),
    requests, options.displayAssets);
    return { events, requests, record: { missionId, ...effects } };
}

/**
 * The owner's half of a mission's OnShipDone or in-flight OnFailure
 * (nova_plugin/missions/mission_set_string_record.ts), resolved IN FLIGHT
 * against a detached copy of the player the moment the simulation has
 * marked it owed (shipDoneOwed / failureOwed on the player's own list):
 * runShipDoneSetString or failMissionInFlight — the date advance's own
 * transitions — under the mïsn's writer prefix, returned as the
 * `missionSetString` record. The notices the date advance would have
 * queued ride the record (the ShipDoneText's own event excepted: the
 * display shows it now and the date advance queues it later, as before).
 *
 * Null when there is nothing to send: the mission is not on the list, or
 * not owed that string. A mission whose data fails to load is still
 * paid (empty), so the debt cannot wedge the queue. `player` is the
 * display world's mirror, read and never written.
 */
export async function buildMissionSetString(player: Entity,
    owed: { kind: MissionSetStringKind, missionId: string },
    gameData: SimulationGameDataInterface, universe: MissionUniverse,
    options: DetachedSetStringOptions & {
        /** Filled with the string's `Qxxx` / `Pxxx` / `Txxx`. */
        requests?: SetStringRequests,
    } = {}): Promise<MissionSetString | null> {
    await universe.load();
    const { kind, missionId } = owed;
    const active = player.components.get(MissionsComponent)?.get(missionId);
    if (!active
        || !(kind === 'shipDone' ? shipDoneOwed(active)
            : failureOwed(active))) {
        return null;
    }
    const { session, before, outcome, requests } = await detachedSession(
        player, gameData, universe, options.systemId);
    if (kind === 'shipDone') {
        runShipDoneSetString(session.machinery, missionId, session.outfits);
    } else {
        failMissionInFlight(session.machinery, missionId, session.outfits);
    }
    const notices = missionNotices(session.commit()
        .filter(event => event.type !== 'shipDone'));
    // An OnShipDone's own mission is not the record's to remove: diffed
    // as a bystander, so a string that ends it (an `Axxx` naming itself)
    // ends it through missionsEnded. A failure's apply removes it.
    const effects = await nameShip(diffSetStringEffects(before,
        session.target, kind === 'shipDone' ? '' : missionId, outcome,
        universe.legalGeography()), requests, options.displayAssets);
    copyRequests(requests, options.requests);
    return {
        missionId, kind,
        ...(notices.length ? { notices } : {}),
        ...effects,
    };
}

/**
 * The two set strings the capture prompt's "Use As My Ship" runs, IN
 * FLIGHT, against a detached copy of the player's state: the OLD class's
 * shïp OnRetire ("evaluated when you sell a ship of this type and/or
 * replace it with a captured ship", EVN Bible ~:2639), then the PRIZE
 * class's OnCapture ("evaluated when you capture a ship of this type",
 * ~:2636), each under its own class's writer prefix (setStringPrefix) —
 * retiring before capturing, the order a shipyard trade runs OnRetire and
 * OnPurchase in (shipyard_rules.ts runShipTradeSetStrings), so a bit both
 * strings touch ends as the prize's says. MEASURED (reference "Capture
 * \"Use As My Ship\" (the hub's CU), wave 45"): both ran (b9288 from the
 * prize's OnCapture, b9290 from the old hull's OnRetire); the prize class's
 * own OnRetire did not.
 *
 * Returned as the in-flight deltas (SetStringEffects) the `captureShip`
 * record carries (encounters/boarding_plugin.ts CapturedShipType), which
 * the simulation applies to the new hull after the swap; empty when both
 * strings are blank or change nothing. Through MissionSession rather than
 * the shipyard's bare bit hooks so an `Sxxx` / `Axxx` / `Gxxx` / `Kxxx` in
 * either string means what it means in any other set string, as for an
 * abort's OnAbort. `player` is the display world's mirror of the player's
 * ship, read and never written.
 *
 * "Use As Escort" passes no `retired` class: the pilot keeps his hull, so
 * only the prize class's OnCapture runs. GUESS (the Bible's "evaluated when
 * you capture a ship of this type" names no answer; wave 45 measured
 * OnCapture only for Use As My Ship).
 */
export async function buildCaptureSetStrings(player: Entity,
    retired: ShipData | undefined, captured: ShipData,
    gameData: SimulationGameDataInterface, universe: MissionUniverse,
    options: DetachedSetStringOptions & {
        /** Filled with the strings' `Qxxx` / `Pxxx` / `Txxx`. */
        requests?: SetStringRequests,
    } = {}): Promise<SetStringEffects> {
    if (!retired?.onRetire && !captured.onCapture) {
        return {};
    }
    await universe.load();
    const { session, before, outcome, requests } = await detachedSession(
        player, gameData, universe, options.systemId);
    if (retired) {
        runMissionSetString(session.machinery, retired.onRetire,
            setStringPrefix(retired), session.outfits);
    }
    runMissionSetString(session.machinery, captured.onCapture,
        setStringPrefix(captured), session.outfits);
    // The notices a string's mission starts or ends would give are dropped:
    // the original shows the status line and nothing else here.
    session.commit();
    copyRequests(requests, options.requests);
    return nameShip(diffSetStringEffects(before, session.target, '',
        outcome, universe.legalGeography()), requests, options.displayAssets);
}

/**
 * A stellar's spöb OnDominate ("evaluated when the stellar is successfully
 * dominated by the player", EVN Bible ~:2893) or OnRelease ("... released
 * from domination by the player", ~:2896), run IN FLIGHT against a
 * detached copy of the player's state under the spöb's writer prefix
 * (setStringPrefix), the in-flight abort's machinery, so every operator
 * means what it means in any other set string. Stock: 272 stellars' OnDominate
 * set one of b6100-b6106; no stock OnRelease.
 *
 * Returned as the deltas a `stellarSetString` record carries
 * (encounters/tribute.ts StellarSetStringType), for the entry the
 * simulation queued on the pilot (player/dominated.ts) — the record is sent
 * even when the string changed nothing, because it is also what clears the
 * debt. The notices a string's mission starts or ends would give are
 * dropped: the original's domination shows its hail line and nothing else.
 * `player` is the display world's mirror, read and never written.
 */
export async function buildStellarSetString(player: Entity,
    planet: Pick<PlanetData, 'id' | 'writerPrefix' | 'domination'>,
    kind: StellarSetStringKind, gameData: SimulationGameDataInterface,
    universe: MissionUniverse,
    options: DetachedSetStringOptions & {
        /** Filled with the string's `Qxxx` / `Pxxx` / `Txxx`. */
        requests?: SetStringRequests,
    } = {}): Promise<SetStringEffects> {
    const expression = kind === 'dominate'
        ? planet.domination.onDominate : planet.domination.onRelease;
    if (!expression.trim()) {
        return {};
    }
    await universe.load();
    const { session, before, outcome, requests } = await detachedSession(
        player, gameData, universe, options.systemId);
    runMissionSetString(session.machinery, expression,
        setStringPrefix(planet), session.outfits);
    session.commit();
    copyRequests(requests, options.requests);
    return nameShip(diffSetStringEffects(before, session.target, '',
        outcome, universe.legalGeography()), requests, options.displayAssets);
}
