import { MissionData } from 'novadatainterface/mission_data';
import {
    AUTO_ABORT_FUEL_COST, autoAbortPayEffects, deferredAutoAbort,
} from './mission_auto_abort.js';
import { loadMissionCargo } from './mission_cargo.js';
import { setStringPrefix } from './mission_ids.js';
import { MissionMachineryContext } from './mission_machinery.js';
import { checkAcceptable, makeMissionOffer, MissionOffer } from './mission_offer.js';
import { applyPayVal } from './mission_payval.js';
import { runMissionSetString } from './mission_set_strings.js';
import { ActiveMission, MAX_ACTIVE_MISSIONS } from '../player/index.js';
import { decodePayVal } from '../reputation/index.js';

/**
 * Taking a mission on: acceptOffer (registering the ActiveMission with
 * its accept-time picks frozen, or running an immediate auto-abort),
 * refuseOffer, and the Sxxx scripted start. Split out of mission_logic.ts.
 */

/**
 * Picks the special ships' name for a mission being accepted, from
 * the mïsn's ShipNameID STR# list (MissionData.shipNames; empty when
 * ShipNameID is -1). Undefined when the mission names no list — the
 * ships then get their normal random names and <SN> has nothing to
 * expand to.
 *
 * The EVN Bible's <SN> note fixes the timing: "Nova will screw up if
 * you use this in the initial mission description, as it doesn't pick
 * the special ship names until you actually accept the mission." The
 * pick is therefore made HERE, at accept, and frozen on the
 * ActiveMission so text and ships agree for the mission's whole life
 * (including across saves and system re-entries, which respawn the
 * ships).
 *
 * ONE name per mission, shared by all its special ships: the Bible's
 * ShipNameID line is singular about the name and plural about the
 * ships ("Tells Nova how to name the special ships ... Pick a name
 * from this STR# resource"), <SN> itself is singular, and the only
 * stock multi-ship text that uses it reads "I believe most of them
 * have been named <SN>" (mïsn nova:353) — i.e. one name covering the
 * group. No stock mission combines ShipCount > 1 with a ShipNameID,
 * so nothing in the data contradicts the simpler reading.
 *
 * Player-local randomness, like the AvailRandom offer roll
 * (mission_offers.ts): the result is committed into the player's
 * mission state and mirrors to peers through that state, never
 * through a sim PRNG draw.
 */
function pickSpecialShipName(mission: MissionData,
    random: () => number): string | undefined {
    return pickFromStrList(mission.shipNames, random);
}

/**
 * The ShipSubtitle sibling of pickSpecialShipName: "Tells Nova which
 * subtitle, if any, to use for the special ships ... Pick a subtitle
 * from this STR# resource". Picked at accept and frozen for the same
 * reason, and — like the name — ONE subtitle covers all of the
 * mission's special ships. The original's own pilot file settles that:
 * an in-progress mission records a single specialShipNameIndex /
 * specialShipSubtitleIndex (and a single resolved specialShipName /
 * specialShipSubtitle string) per mission, not one per ship.
 *
 * Unlike the name there is no wildcard for it — it exists only to be
 * shown on the ships themselves (mïsn nova:685, "Assassinate Krane",
 * names no ships at all and subtitles them "Krane").
 */
function pickSpecialShipSubtitle(mission: MissionData,
    random: () => number): string | undefined {
    return pickFromStrList(mission.shipSubtitles, random);
}

function pickFromStrList(entries: readonly string[],
    random: () => number): string | undefined {
    if (entries.length === 0) {
        return undefined;
    }
    return entries[Math.floor(random() * entries.length)];
}

/** The result of an accept attempt (see acceptOffer). */
export type AcceptResult =
    | { accepted: true }
    | { accepted: false; reason: string };

/**
 * Accepts an offer: registers the active mission, loads start-time
 * cargo, runs OnAccept, and handles auto-abort missions (which run
 * their effects and never stay active).
 *
 * The offer's `acceptable` flag is frozen at board-open; a normal
 * (staying) mission is re-checked against the CURRENT context here so a
 * stale offer can't slip cargo past a hold another accepted mission has
 * since filled, or exceed the 16-mission cap (L3/L4). When the re-check
 * fails, nothing is committed and the reason is returned for the UI.
 * `skipAcceptabilityCheck` is for scripted starts (Sxxx), which ignore
 * availability by contract and gate the cap themselves.
 */
export function acceptOffer(machinery: MissionMachineryContext,
    offer: MissionOffer, outfits?: Map<string, number>, depth = 0,
    skipAcceptabilityCheck = false): AcceptResult {
    const { state } = machinery;
    const mission = offer.data;
    const prefix = setStringPrefix(mission);
    const ctx = machinery.offerContext();

    if (mission.flags.autoAbort && !deferredAutoAbort(mission)) {
        // One-shot scripting missions: run OnAccept (and pay if
        // flagged), never becoming active.
        runMissionSetString(machinery, mission.onAccept, prefix,
            outfits, depth);
        // ...and then OnAbort, because it IS an abort. EVN Bible, Flags
        // 0x0001: "automatically abort itself after it is accepted ... Any
        // control bits pointed to by the mission's OnAbort fields will be
        // automatically set when the mission aborts." OnAccept first, then
        // OnAbort, is the order the flag's own wording gives, and the
        // stock data is authored for it: nova:609 "Drop Bear" sets b45 on
        // accept and clears it on abort so it can score AGAIN (its
        // AvailBits are `(b42 & !b45) & ...`), nova:610 mirrors that with
        // b43, and nova:909 "Eamon Boarding" carries its whole consequence
        // — `K152 L138`, Sworn Enemy of the Wild Geese — in OnAbort alone.
        //
        // NOT applied: the CompReward abort reversal (applyOutcomeReputation
        // 'abort', mïsn Flags 0x0040). The Bible's auto-abort text names
        // only the OnAbort BITS, and all sixteen stock enforcement-squad
        // missions (nova:614-629, "Avoid Federation Task Force" and kin)
        // set 0x0040 with CompRewards up to 30 — applying a -150 Rebel
        // reversal every time a squad is dispatched cannot be what their
        // author meant. The DEFERRED auto-abort (runPendingAutoAborts) does
        // apply it, through abortMission; that asymmetry is deliberate and
        // recorded here.
        runMissionSetString(machinery, mission.onAbort, prefix,
            outfits, depth);
        // mïsn Flags2 0x0002, "Apply mission Pay on auto-abort". The Pay
        // is the WHOLE PayVal, not just a positive one: the stock traps
        // that use this bit are the ones that TAKE — nova:609/610 take 2%
        // and 5% of the player's cash ("GOTCHA!! Auroran Drop Bear scores
        // again..."), nova:731 takes 50%, and nova:896 cleans the player's
        // Federation record. Everything the flag covers is settled here,
        // `takeCredits` included: this mission never becomes active, so
        // accept IS its start and its end, and the start-time encoding has
        // nowhere else to fire. Without the flag no PayVal effect applies
        // at all, which is what the bit means.
        let payment: number | undefined;
        if (mission.flags.applyPayOnAutoAbort) {
            payment = applyPayVal(machinery, mission,
                decodePayVal(mission.payVal));
        }
        state.dateAdvance += Math.max(0, mission.datePostInc);
        // An auto-abort mission never becomes active, so its <SN> pick
        // lives only as long as this popup — and as long as the ships
        // below, which wear the same name.
        const shipName = pickSpecialShipName(mission, machinery.random);
        state.events.push({
            missionId: mission.id,
            missionName: mission.name,
            type: 'autoAborted',
            text: mission.briefText,
            // The autoAborted popup shows briefText, so pair it with the
            // briefing dësc's graphic (not failPict) to keep the picture
            // consistent with the text beside it.
            pict: mission.briefPict,
            payment,
            specialShipName: shipName,
        });
        // The ships, which are the reason an auto-abort mission has them
        // ("sometimes useful to create special ships" — EVN Bible, Flags
        // 0x0001): the mission is gone but its frozen objective is kept
        // for the lift-off to spawn from, exactly as the in-flight accept
        // keeps the offer's objective for the Derelict Decoy's ambush
        // (ship_mission_accept.ts). See PendingAutoAbortShipsComponent.
        if (offer.shipObjective && state.autoAbortShips) {
            const shipSubtitle =
                pickSpecialShipSubtitle(mission, machinery.random);
            state.autoAbortShips.push({
                missionId: mission.id,
                shipObjective: {
                    ...offer.shipObjective,
                    live: new Map(offer.shipObjective.live),
                },
                travelPlanet: offer.travelPlanet,
                returnPlanet: offer.returnPlanet,
                ...(shipName !== undefined ? { shipName } : {}),
                ...(shipSubtitle !== undefined ? { shipSubtitle } : {}),
            });
        }
        return { accepted: true };
    }

    // Re-evaluate cargo fit + the mission cap against current state: the
    // frozen offer may no longer be acceptable.
    if (!skipAcceptabilityCheck) {
        const check = checkAcceptable(offer, ctx);
        if (!check.acceptable) {
            return { accepted: false, reason: check.reason };
        }
    }

    const active: ActiveMission = {
        id: mission.id,
        acceptedDay: ctx.currentDay,
        acceptedAt: ctx.stellar.id,
        travelPlanet: offer.travelPlanet,
        returnPlanet: offer.returnPlanet,
        cargoType: offer.cargoType,
        cargoQty: offer.cargoQty,
        cargoLoaded: false,
        travelDone: false,
        deadlineDay: mission.timeLimit > 0
            ? ctx.currentDay + mission.timeLimit
            : null,
        // Frozen so the shared sim can fail the mission on a player
        // disable/destroy without reading mission game data.
        failIfPlayerDisabledOrDestroyed:
            mission.flags.failIfPlayerDisabledOrDestroyed,
        // mïsn Flags 0x8000 "Mission will fail if player is boarded by
        // pirates", frozen for the same reason (MissionPlayerPlunderedSystem
        // reads it). Only written when set, so the record stays additive.
        ...(mission.flags.failIfBoardedByPirates
            ? { failIfBoardedByPirates: true } : {}),
        // Copied (not aliased) so re-showing the offer stays pristine.
        shipObjective: offer.shipObjective && {
            ...offer.shipObjective,
            live: new Map(offer.shipObjective.live),
        },
        // <SN>: the special ships' name, picked now (see
        // pickSpecialShipName) and frozen for the mission's life.
        shipName: pickSpecialShipName(mission, machinery.random),
        // ...and the subtitle shown beneath it on those same ships.
        shipSubtitle: pickSpecialShipSubtitle(mission, machinery.random),
        // mïsn PickupMode 2, "Pick up when boarding special ship" —
        // frozen here for the same reason failIfPlayerDisabledOrDestroyed
        // is: the pickup happens in the SHARED SIMULATION, the tick the
        // owner boards the ship, and the sim never reads mission game
        // data. See MissionShipTrackSystem.
        pickupOnBoard: mission.pickupMode === 2 ? true : undefined,
        // The DEFERRED auto-abort (see deferredAutoAbort), with the two
        // numeric effects the sim applies on that boarding frozen beside
        // it. Both are Bible flags: Flags2 0x0002 "Apply mission Pay on
        // auto-abort" and Flags 0x0008 "Mission takes away 100 units of
        // fuel upon auto-abort".
        ...(deferredAutoAbort(mission) ? {
            autoAbortOnBoard: true,
            ...autoAbortPayEffects(mission),
            autoAbortFuel: mission.flags.remove100FuelOnAutoAbort
                ? AUTO_ABORT_FUEL_COST : undefined,
        } : {}),
    };
    state.missions.set(mission.id, active);
    if (offer.cargoQty > 0
        && (mission.pickupMode === 0 || mission.pickupMode === -1)) {
        loadMissionCargo(state, active);
    }
    // PayVal -50000 and down: take credits at mission START (the only
    // PayVal encoding that applies before completion). Clamped at 0 —
    // EV Nova has no debt.
    const pay = decodePayVal(mission.payVal);
    if (pay.type === 'takeCredits') {
        applyPayVal(machinery, mission, pay);
    }
    runMissionSetString(machinery, mission.onAccept, prefix, outfits, depth);
    state.events.push({
        missionId: mission.id,
        missionName: mission.name,
        type: 'accepted',
        text: mission.briefText,
        specialShipName: active.shipName,
    });
    return { accepted: true };
}

/** Refusing an offer just runs OnRefuse. */
export function refuseOffer(machinery: MissionMachineryContext,
    offer: MissionOffer, outfits?: Map<string, number>): void {
    runMissionSetString(machinery, offer.data.onRefuse,
        setStringPrefix(offer.data), outfits);
}

/** Sxxx: start a mission by id, ignoring availability. */
export function startMissionById(machinery: MissionMachineryContext,
    missionId: string, outfits?: Map<string, number>, depth = 0): void {
    const { state } = machinery;
    const mission = machinery.getMission(missionId);
    if (!mission) {
        console.warn(`Sxxx: mission ${missionId} is not loaded; ignoring.`);
        return;
    }
    if (state.missions.has(missionId)
        || state.missions.size >= MAX_ACTIVE_MISSIONS) {
        return;
    }
    const offer = makeMissionOffer(mission, machinery.offerContext());
    if (!offer) {
        console.warn(`Sxxx: could not resolve destinations for ${missionId}.`);
        return;
    }
    // Scripted starts ignore availability (cargo fit): the cap is gated
    // above. Skip the accept-time re-check so a full hold can't silently
    // block a story mission the way it blocks a board accept.
    acceptOffer(machinery, offer, outfits, depth, true);
}
