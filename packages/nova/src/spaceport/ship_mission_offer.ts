import { PersData } from 'novadatainterface/pers_data';
import { ShipData } from 'novadatainterface/ship_data';

/**
 * ============================================================================
 * Missions offered BY A SHIP (mïsn AvailLoc 2, "Offered from ship")
 * ============================================================================
 *
 * The Bible's AvailLoc 2 reads "Offered from ship (must set up associated
 * përs resource as well)", and the përs is where the trigger lives:
 *
 *   përs Flags 0x0200  "Offer ship's LinkMission when boarding it instead
 *                       of when hailing it"
 *
 * So a përs with a LinkMission offers it on HAILING by default, and on
 * BOARDING when that bit is set. In stock Nova 277 përs carry a
 * LinkMission and they link just 14 missions between them:
 *
 *   BOARDING (0x0200), 17 përs — the Drifting Derelicts (govt 160, whose
 *     Flags1 0x0800 already makes them spawn as hulks): 155/158/167/179/
 *     180/181/184 offer mïsn 134 "Passengers for <DST>", and 156/157/
 *     182/183 offer mïsn 133 "Derelict Decoy", the trap. (Plus the six
 *     Eamon përs 443-448, mïsn 909.)
 *   HAILING, the other 260 — mïsn 132 "Escort Merchant to <RST>" (78
 *     përs), the four "Refuel Trader" missions 141/650/651/652 (63), the
 *     cargo runs 135-139 (113), and the bounty 140 (3).
 *
 * This module is the PURE half — which mission a ship offers, whether it
 * may be offered right now, and whether its hail quote is broadcast. It
 * has no ECS or PIXI imports so the display plugins that trigger it
 * (hail, boarding, the status line) and the specs can all share one
 * answer.
 */

/** Where a përs's LinkMission is offered. */
export type ShipOfferTrigger = 'hail' | 'board';

/**
 * How this përs offers its LinkMission, or null when it has none.
 * përs Flags 0x0200 is the only thing that decides it.
 */
export function shipOfferTrigger(pers: PersData): ShipOfferTrigger | null {
    if (!pers.linkMission) {
        return null;
    }
    return pers.flags.offerMissionOnBoarding ? 'board' : 'hail';
}

/**
 * The four ENCOUNTER facts the përs QUOTE bits test, resolved by whoever
 * is looking at the world (the display plugins read them off synced
 * components; specs state them outright).
 *
 * These gate the HAIL QUOTE ONLY — never the offer. The Bible names each
 * of them for the quote in so many words (përs Flags, verbatim):
 *
 *   0x0004  "HailQuote only shown when ship has a grudge against the
 *            player"
 *   0x0008  "HailQuote only shown when ship likes player"
 *   0x0010  "Only show HailQuote when ship begins to attack the player"
 *   0x0020  "Only show HailQuote when ship is disabled"
 *
 * An earlier reading of this module applied them to the OFFER as well,
 * on the theory that they describe when the person is willing to talk at
 * all. The stock data says otherwise, decisively: all 78 përs behind
 * mïsn 132 ("Escort Merchant") and all 63 behind the four Refuel Trader
 * missions set 0x0008, and their government is Civvies (gövt 157), which
 * allies with nobody the player can belong to — so gating the offer on
 * those bits made every one of those 141 missions unobtainable while
 * leaving the quote (which does advertise them) on screen. Only 0x1000 /
 * 0x2000 / 0x4000 are worded as offer gates ("Don't offer if...").
 */
export interface ShipOfferGates {
    /** The përs ship is currently disabled (përs Flags 0x0020). */
    disabled: boolean;
    /** It is attacking the player (përs Flags 0x0010). */
    attackingPlayer: boolean;
    /** It holds a grudge against the player (përs Flags 0x0004). */
    holdsGrudge: boolean;
    /** Its government likes the player (përs Flags 0x0008). */
    likesPlayer: boolean;
}

/** What the përs gates its offer on, as facts the caller has resolved. */
export interface ShipOfferContext {
    /** The trigger that fired. */
    trigger: ShipOfferTrigger;
    /** The player already has this mission, or it is not offerable to
     * them right now (NCB / AvailRandom / cargo space). */
    missionAvailable: boolean;
    /** The PLAYER's ship class, for the three "no mission if..." bits. */
    playerShip: ShipData | undefined;
}

/**
 * Whether this përs will actually make its offer.
 *
 * THREE THINGS DECIDE IT, and no others: the përs has a LinkMission, the
 * trigger that fired is the one this përs uses (0x0200), and the mission
 * is available to this player right now. Everything else the Bible
 * attaches to a përs is about the quote (see ShipOfferGates) — with one
 * exception, the three "no mission if..." bits:
 *
 *   0x1000  "Don't offer if player is flying a wimpy freighter (aiType 1)"
 *   0x2000  "Don't offer if player is flying a beefy freighter (aiType 2)"
 *   0x4000  "Don't offer if player is flying a warship (aiType 3)"
 *
 * Note they are about the PLAYER'S ship, not the përs's — the Bible's way
 * of keeping a courier job away from a battleship — and are resolved from
 * the player's shïp InherentAI, whose 1/2/3 are exactly the aiTypes the
 * flags name. 4 (interceptor) is not mentioned by any of the three; it is
 * counted with the warships, since an interceptor is no more a freighter
 * than a warship is.
 */
export function shipOffers(pers: PersData, ctx: ShipOfferContext): boolean {
    if (!pers.linkMission || shipOfferTrigger(pers) !== ctx.trigger) {
        return false;
    }
    if (!ctx.missionAvailable) {
        return false;
    }
    const flags = pers.flags;
    const playerAi = ctx.playerShip?.inherentAI;
    if (playerAi !== undefined) {
        if (flags.noMissionIfWimpyTrader && playerAi === 1) {
            return false;
        }
        if (flags.noMissionIfBeefyTrader && playerAi === 2) {
            return false;
        }
        if (flags.noMissionIfWarship && playerAi >= 3) {
            return false;
        }
    }
    return true;
}

/**
 * ============================================================================
 * The HailQuote advertisement (përs HailQuote, STR# 7101)
 * ============================================================================
 *
 * The Bible's përs HailQuote: "The ID of a string in STR# resource 7101
 * to display at the bottom of the game screen (over the radio) when this
 * person is in the system." It is the person calling out to you — how
 * the Refuel Trader tells you they are out of fuel before you have
 * targeted anything — so it belongs on the bottom-left status line, not
 * in a dialog.
 *
 * WHICH BITS GATE IT — all six, and they gate NOTHING ELSE (Bible,
 * përs Flags, verbatim):
 *
 *   0x0004  "HailQuote only shown when ship has a grudge against the
 *            player"
 *   0x0008  "HailQuote only shown when ship likes player"
 *   0x0010  "Only show HailQuote when ship begins to attack the player"
 *   0x0020  "Only show HailQuote when ship is disabled"
 *   0x0080  "Only show quote once"
 *   0x0400  "Don't show quote when ship's LinkMission is not available"
 *
 * A përs with no LinkMission at all trivially has none available, so
 * 0x0400 silences them outright. Twelve stock përs are in exactly that
 * state (0x0400 set, LinkMission none — përs 223/229/250/375/381/442/
 * 502/508/562/568/610/624), so this is a real, and deliberate, silence.
 *
 * `missionAvailable` is what shipOffers already computes, so an
 * advertisement can never promise a job the hail would then not offer.
 */
export function showsHailQuote(pers: PersData, ctx: ShipOfferGates & {
    /** The përs's LinkMission is offerable to this player right now. */
    missionAvailable: boolean,
    /** This person's quote has already been shown this session. */
    alreadyShown: boolean,
}): boolean {
    if (!pers.hailQuote.trim()) {
        return false;
    }
    const flags = pers.flags;
    if (flags.hailOnlyOnce && ctx.alreadyShown) {
        return false;
    }
    if (flags.hailOnlyWhenMissionAvailable && !ctx.missionAvailable) {
        return false;
    }
    if (flags.hailOnlyWhenDisabled && !ctx.disabled) {
        return false;
    }
    if (flags.hailOnlyWhenAttacking && !ctx.attackingPlayer) {
        return false;
    }
    if (flags.hailOnlyWithGrudge && !ctx.holdsGrudge) {
        return false;
    }
    if (flags.hailOnlyWhenLikesPlayer && !ctx.likesPlayer) {
        return false;
    }
    return true;
}

/**
 * What accepting the offer does to the OFFERING SHIP itself, from the
 * përs flags. Applied sim-side against `offeredBy` (mission_accept).
 *
 *  - 0x0040 replaceWithSpecialShip, verbatim: "When LinkMission is
 *    accepted with a single SpecialShip, replace it with this ship while
 *    removing this one from play. This is generally only useful for
 *    escort and refuel-a-ship missions." That is how the Refuel Trader
 *    works — you hail a flying trader, and the ship you then go and board
 *    is the mission's own special ship, spawned disabled by its rescue
 *    goal, sitting where the përs was. All 63 Refuel Trader përs and all
 *    78 mïsn 132 përs set it.
 *
 *    The same paragraph pins the ship-class rule the spawner implements
 *    (mission_ship_spawn's ReplacementPlacement.preferShipId): "if the
 *    mission's SpecialShip düde type contains the përs ship's ship type
 *    in it, the SpecialShip that's created will be of the same type as
 *    the përs ship, regardless of the probabilities in the düde
 *    resource. This is to prevent a përs ship from accidentally morphing
 *    into another ship type before the player's eyes."
 *  - 0x0800 leavesAfterMissionAccepted, "Make ship leave after accepting
 *    its LinkMission": the person departs once you take the job. Stock
 *    users are the three bounty përs (131/132/133, mïsn 140) and the
 *    cargo-delivery përs of mïsn 135-139.
 *
 * Both remove the përs hull from play; they differ in what takes its
 * place, so they are reported separately rather than collapsed.
 */
export function shipOfferConsequence(pers: PersData):
    'replace' | 'leave' | 'stay' {
    if (pers.flags.replaceWithSpecialShip) {
        return 'replace';
    }
    if (pers.flags.leavesAfterMissionAccepted) {
        return 'leave';
    }
    return 'stay';
}
