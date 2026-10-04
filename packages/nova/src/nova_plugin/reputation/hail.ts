import { GovtData } from 'novadatainterface/govt_data';
import { Disposition, shipDisposition } from './iff_plugin.js';
import { LegalRecords } from './reputation.js';

/**
 * ============================================================================
 * Hailing — pure response / eligibility logic (EVN Bible)
 * ============================================================================
 *
 * Hailing a ship or planet opens a communications dialog. This module holds
 * the pure, deterministic decisions behind that dialog — which are computed
 * identically on the display (to show the right text and buttons) and in the
 * sim (to apply repairs / bribes) — with no PIXI or ECS dependencies so they
 * can be unit-tested and shared across both worlds.
 *
 * Bible citations (packages/nova/EVN_Bible.txt):
 *  - gövt Flags1 0x0400 "Can't hail ships of this govt" (cantBeHailed): the
 *    ship simply does not answer — no channel opens (shipAnswersHails, which
 *    also silences the krypt and the wraith, ruling #297).
 *  - HOSTILITY in the channel is the ship's IFF, not its govt's stance
 *    (ruling #297): the caller passes hostility.ts's isIffHostile.
 *  - gövt Flags1 0x0200 "Warships will take bribes" (warshipsTakeBribes),
 *    0x2000 "Freighters will take bribes" (freightersTakeBribes),
 *    0x8000 "Ships taking bribes demand a larger percentage ... and their
 *    planets always take bribes" (largerBribes), 0x0400/0x4000 planet bribes
 *    (planetsTakeBribes / largerBribes).
 *  - gövt Flags2 0x0001 "the request assistance / beg for mercy button is
 *    disabled and the govt is not talkative" (noAssistOrMercy).
 *  - gövt Flags2 0x0008 "don't send distress messages and don't respond with
 *    greetings when hailed" (noDistressMessages).
 *  - gövt Flags2 0x0010 "Roadside Assistance — always repair or refuel the
 *    player for free" (roadsideAssistance).
 *  - ränk Flags 0x0800 "Ships allied with the affiliated govt will always
 *    repair or refuel the player for free" (allied-repair): not applied here
 *    because per-player rank state is not yet modelled — a documented seam
 *    (see assistIsFree).
 *  - përs CommQuote (STR# 7100) is the comms-dialog greeting for a named
 *    person; resolved into PersData.commQuote and taking precedence.
 *  - OPENING A CHANNEL IS NOT A GREETING. hail/hail.png shows a freshly
 *    hailed Terrapin answering "Channel open." — STR# 3000's channel-open
 *    group (0-4) — with the Greetings button still unpressed; pressing it
 *    is what produces the greeting (hail/greetings.png, "Greetings."). So
 *    the dialog OPENS with channelOpenText and keeps the greeting in
 *    reserve for the button. Planet hails already work this way through
 *    STR# 3002's own channel-open group.
 *  - Generic (non-përs) ships greet with a random line from their
 *    government's greeting STR# (id 7000 + (govtId - 128), ten lines each;
 *    EVN Bible Appendix III), resolved at parse time into
 *    GovtData.commGreetings. greetingText picks one DETERMINISTICALLY (a hash
 *    of the encounter's stable id, never Math.random) so the client-side
 *    dialog agrees across peers and re-hails. A government with no greeting
 *    resource falls back to the stock generic greeting group (STR# 3000
 *    45-49, "Greetings." among them — which is exactly what the govt-less
 *    Terrapin on hail/greetings.png answers), and only then to a synthetic
 *    govt-appropriate line.
 *  - HOSTILE ships do not use their government's greetings at all: they
 *    answer from the global ship-comm table (STR# 3000 indices 10-14 — "What
 *    is it?" on hail/hail_hostile.png), as do the assistance answers
 *    (granted 75-79, busy 80-84, "you don't need help" 70-74). See
 *    HAIL_RESPONSE_TABLE below.
 */

/** Which of the two AI-type bribe flags applies to a ship of this aiType. */
export function shipTakesBribes(govt: GovtData | undefined,
    aiType: number | undefined): boolean {
    if (!govt) {
        return false;
    }
    if (govt.flags.largerBribes) {
        // Pirates: always take (larger) bribes regardless of ship kind.
        return true;
    }
    // aiType 1/2 = freighters, 3 = warship. Unknown aiType (independent /
    // player-spawned) uses the warship flag as the general "will bargain"
    // signal.
    if (aiType === 1 || aiType === 2) {
        return govt.flags.freightersTakeBribes;
    }
    return govt.flags.warshipsTakeBribes;
}

/**
 * The fraction of the player's cash a bribe costs. TUNABLE / ASSUMPTION: the
 * Bible only says "ships taking bribes will demand a larger percentage" for
 * largerBribes govts and gives no exact numbers. 10% is the ordinary demand;
 * pirate/largerBribes govts demand 30%. A pure function of the player's cash
 * and the flag, so the display and the sim agree without a random roll.
 */
export const BRIBE_FRACTION = 0.10;
export const BRIBE_FRACTION_LARGE = 0.30;
/** A bribe is never smaller than this (so a near-broke player still pays). */
export const BRIBE_MINIMUM = 500;

/**
 * The credits a bribe/mercy plea costs, given the player's current cash and
 * whether the govt demands larger bribes. Rounded down to a whole credit and
 * capped at what the player actually has. Pure and total.
 */
export function bribeAmount(playerCredits: number,
    largerBribes: boolean): number {
    const fraction = largerBribes ? BRIBE_FRACTION_LARGE : BRIBE_FRACTION;
    const demand = Math.max(BRIBE_MINIMUM, Math.floor(playerCredits * fraction));
    return Math.min(demand, Math.max(0, Math.floor(playerCredits)));
}

/**
 * The two hail traits a ship CLASS inherits from its inherent attributes
 * govt (ShipData.inheritedCantBeHailed / inheritedNoGreetings — gövt Flags
 * 0x0400 and Flags2 0x0008 both say "if a ship type has an inherent
 * attributes govt which includes this flag, all ships of that type will
 * inherit this property"). A ShipData satisfies this directly.
 */
export interface ShipHailTraits {
    inheritedCantBeHailed?: boolean;
    inheritedNoGreetings?: boolean;
}

/**
 * WHETHER A HAILED SHIP ANSWERS AT ALL. Matthew's ruling on #297: "Some ships
 * don't respond to hails at all (no hailing channel appears), like the krypt
 * pod and wraith." No channel opens for such a ship; the hail gets the
 * original's no-response line on the status line instead.
 *
 * Two data readings make a ship silent:
 *
 *  1. gövt Flags 0x0400 "Can't hail ships of this govt", on the ship's own
 *     government or inherited from its class's attributes govt. The Bible's
 *     explicit switch. In the stock data: Hyperioid (148), the Wraith of
 *     gövt 159, both Derelicts govts (160, 180) and the Cargo Drone Robots
 *     (184) — and every Wraith (Adult) nova:185 through its InherentGovt.
 *  2. A govt with NOTHING TO SAY AND NOTHING TO OFFER: Flags2 0x0001 (the
 *     request assistance / beg for mercy button is disabled and the govt is
 *     not talkative) together with Flags2 0x0008 (it doesn't respond with
 *     greetings when hailed), the latter on the govt or inherited. That is
 *     what the krypt pod and the wraith actually carry — the stock Krypt
 *     govts (140, 163) and the other two Wraith govts (138, 139) have
 *     Flags2 0x002b/0x0029/0x00ab and NO 0x0400 — and in the stock data
 *     the pair occurs nowhere else that 0x0400 does not already silence.
 *     0x0001 alone is NOT silence: the Dechtakar (gövt 142 Rimerta, Flags2
 *     0x0027) open a channel and simply offer no Request Assistance
 *     (ruling screenshot, "Hailing channel ready." / Greetings / Close).
 */
export function shipAnswersHails(govt: GovtData | undefined,
    ship?: ShipHailTraits): boolean {
    if (govt?.flags.cantBeHailed || ship?.inheritedCantBeHailed) {
        return false;
    }
    const noGreetings = !!govt?.flags2.noDistressMessages
        || !!ship?.inheritedNoGreetings;
    return !(govt?.flags2.noAssistOrMercy && noGreetings);
}

/** What a hailed ship's answer amounts to, driving the dialog contents. */
export type ShipHailResponse =
    /** The ship does not answer at all ({@link shipAnswersHails}). */
    | { kind: 'cantHail' }
    /**
     * IFF-hostile. `canBeg`: the channel offers Beg For Mercy in the
     * Request Assistance slot. `canBribe`: a plea is answered with a price
     * rather than a refusal.
     */
    | { kind: 'hostile', canBeg: boolean, canBribe: boolean }
    /** Ordinary answer: a greeting (possibly empty when suppressed). */
    | { kind: 'greeting', talkative: boolean };

/**
 * How a hailed ship responds to the player.
 *
 * `iffHostile` is THE SHIP'S IFF (hostility.ts's isIffHostile — exactly when
 * the target corners are red), NOT its government's stance: Matthew's ruling
 * on #297, "Hostility in the hailing channel should reflect the iff of that
 * ship, not the government stance ... Any ship that is iff hostile shows up
 * as hostile with the 'beg for mercy' button instead of 'request
 * assistance'." `aiType` selects the bribe flag.
 *
 * The Bible's mercy semantics (gövt flags):
 *  - Flags2 0x0001 noAssistOrMercy: "the request assistance / beg for mercy
 *    button is disabled" — no Beg For Mercy at all.
 *  - otherwise every IFF-hostile ship offers Beg For Mercy, and whether the
 *    plea buys anything is the bribe flags' business: 0x0200 warships /
 *    0x2000 freighters take bribes, 0x8000 (pirates) always do and demand
 *    more (shipTakesBribes). A ship that won't be bought answers the plea
 *    with a refusal ({@link mercyRefusedText}) and keeps fighting.
 */
export function shipHailResponse(govt: GovtData | undefined,
    iffHostile: boolean, aiType: number | undefined,
    ship?: ShipHailTraits): ShipHailResponse {
    if (!shipAnswersHails(govt, ship)) {
        return { kind: 'cantHail' };
    }
    if (iffHostile) {
        const canBeg = !govt?.flags2.noAssistOrMercy;
        const canBribe = canBeg && shipTakesBribes(govt, aiType);
        return { kind: 'hostile', canBeg, canBribe };
    }
    // noDistressMessages govts (and classes that inherit it) answer but
    // don't greet ("not talkative"); the noAssistOrMercy flag also marks a
    // govt as "not talkative".
    const talkative = !(govt?.flags2.noDistressMessages
        || ship?.inheritedNoGreetings
        || govt?.flags2.noAssistOrMercy);
    return { kind: 'greeting', talkative };
}

/**
 * Whether the player may ASK a hailed ship for fuel/repair assistance — i.e.
 * whether the comm dialog offers the button at all. It is offered to every
 * ship that would entertain the question: not hostile (politically or
 * behaviorally), not a cantBeHailed govt, and not a Flags2 noAssistOrMercy
 * govt ("the request assistance / beg for mercy button is disabled").
 *
 * DELIBERATELY NOT gated on whether the player needs help. Matthew: "it
 * should show request assistance even if there's no reason for you to request
 * it (they usually just tell you that you don't need help)" — the original
 * answers a pointless request from its own response group (STR# 3000 indices
 * 70-74, {@link noNeedResponseText}) with the channel left open, exactly as
 * it answers a busy ship's refusal. Need is judged in the ANSWER
 * (hail_plugin's applyHail, which grants nothing to a healthy player), not in
 * the offer.
 *
 * `iffHostile` is the ship's IFF (see shipHailResponse): an IFF-hostile ship
 * offers Beg For Mercy INSTEAD (ruling #297), so it never offers assistance,
 * even if its politics are neutral — otherwise a neutral-govt warship
 * shooting a disabled player would still offer to fly over and fully repair
 * them (the assistance exploit).
 *
 * `disposition` stays the GOVERNMENT stance, and a hostile one still refuses:
 * the ruling's "a ship of an unfriendly government may show as neutral when
 * hailed, but they will likely be rude and not offer assistance for free, or
 * at all" — a pirate the player has bought off reads neutral in the channel
 * but has no help to give.
 */
export function canRequestAssistance(opts: {
    disposition: Disposition,
    govt: GovtData | undefined,
    iffHostile?: boolean,
    /** The hailed ship's class, for the inherited no-hail traits. */
    ship?: ShipHailTraits,
    /**
     * ränk Flags 0x0400: "Player can always request battle assistance from
     * ships of the affiliated government". ALWAYS — so it overrides both the
     * politics and the govt's own noAssistOrMercy switch. It does not
     * override IFF hostility: a ship currently shooting at the player is not
     * going to answer, and letting the rank override that would reopen the
     * assistance exploit the iffHostile test closes. Nor does it make a
     * silent ship ({@link shipAnswersHails}) answer.
     */
    rankAlwaysAssists?: boolean,
}): boolean {
    if (opts.iffHostile || !shipAnswersHails(opts.govt, opts.ship)) {
        return false;
    }
    if (opts.rankAlwaysAssists) {
        return true;
    }
    if (opts.disposition === 'hostile') {
        return false;
    }
    if (opts.govt?.flags.cantBeHailed || opts.govt?.flags2.noAssistOrMercy) {
        return false;
    }
    return true;
}

/**
 * Whether the hailed ship is ENGAGED IN COMBAT right now, in which case it
 * refuses an assistance request ("I'm busy") and carries on fighting.
 *
 * THE SIGNAL IS THE GAME'S OWN, not a new flag: `npc.mode === 'attack'` with
 * a live target is exactly the condition NpcFireControl (npc_ai_plugin.ts)
 * requires before it will fire this ship's weapons, and the same one
 * FormationSystem treats as "engaged escorts fight". So "busy" means
 * precisely "shooting at someone" — which is what the playtest complaint was
 * about: a ship that turned to assist while still hosing its opponent.
 *
 * The legacy dev-enemy marker (ShootAllWeaponsComponent, npc_plugin.ts)
 * counts too: such a ship fires at everything unconditionally.
 *
 * Modes deliberately NOT counted: 'flee' (running, not shooting — and a
 * fleeing ship being talked into a rendezvous is not the bug), and any mode
 * without a target (nothing to fight).
 *
 * Pure and total, over synced state only (NpcComponent.mode,
 * TargetComponent.target, the marker), so the display dialog and the sim's
 * applyHail reach the same verdict on every peer — the same arrangement the
 * behavioral-hostility check already uses.
 */
export function shipIsFighting(opts: {
    npcMode: string | undefined,
    npcTarget: string | undefined,
    shootsAllWeapons?: boolean,
}): boolean {
    if (opts.shootsAllWeapons) {
        return true;
    }
    return opts.npcMode === 'attack' && opts.npcTarget !== undefined;
}

/**
 * The stock ship-comm response table (STR# 3000, "Ship Comm Strings", 190
 * entries), whose lines run in GROUPS OF FIVE interchangeable variants — the
 * original picks one at random per response. The groups this module answers
 * with, verbatim from the real Nova data:
 *
 *   [0-4]   channel:  "Channel open." / "Communications channel open." /
 *                     "Communications interlink established." / "Hailing
 *                     frequencies open." / "Hailing channel ready."
 *   [10-14] hostile:  "What is it you want?" / "What do you want?" /
 *                     "What is it?" / "What is it?" / "What?"
 *   [45-49] greeting: "Nice to meet you." / "Hello there." / "Greetings." /
 *                     "Hi there." / "Howdy."
 *   [70-74] no need:  "You're not in any trouble." / "You're in no danger." /
 *                     "You don't have any problems." / "It looks like you're
 *                     sitting pretty from here.  Try helping yourself." /
 *                     "There's no danger to you right now."
 *   [75-79] granted:  "All right, I'll help you." / "Sure, I'll help you
 *                     out." / "Help is on the way." / "I'll come and help
 *                     you." / "Hang on, I'm coming."
 *   [80-84] busy:     "I'm busy." / "I'm a little busy right now." / "I'm too
 *                     busy to help you." / "I have other business." / "I've
 *                     got other things to do."
 *   [135-139] mercy:  "Okay, I'll leave you alone." / "All right, I'll leave
 *                     you alone." (the group repeats those two) — what a ship
 *                     says once a beg-for-mercy bribe is paid.
 *
 * (Pinned by nova_plugin/ncb/string_table_integration_test.ts against the real
 * data, so a parser regression shows up there rather than as a wrong line in
 * the comm dialog. Each fallback below is its group's first line verbatim,
 * used only when the table cannot be loaded at all.)
 */
export const HAIL_RESPONSE_TABLE = 'nova:3000';
export const RESPONSE_GROUP_SIZE = 5;

/**
 * WHAT A SHIP SAYS THE MOMENT THE CHANNEL OPENS (STR# 3000 indices 0-4).
 *
 * hail/hail.png is the proof: a freshly hailed Terrapin's response well reads
 * "Channel open." while the Greetings button sits unpressed beside it, and
 * hail/greetings.png — the same ship, same frame — reads "Greetings." only
 * after that button has been pushed. Opening a channel is not a greeting, and
 * NovaJS used to answer the hail itself with the government greeting, leaving
 * the Greetings button with nothing of its own to say.
 *
 * The planet dialog has always worked this way through STR# 3002's own
 * channel-open group ({@link stellarChannelOpenText}); this is the ship-side
 * twin. A HOSTILE ship is the documented exception — it answers from the
 * hostile group instead (hail/hail_hostile.png opens on "What is it?").
 */
export const CHANNEL_OPEN_FIRST_INDEX = 0;
export const CHANNEL_OPEN_COUNT = RESPONSE_GROUP_SIZE;
export const CHANNEL_OPEN_FALLBACK = 'Channel open.';

/**
 * The stock GENERIC greeting group (STR# 3000 indices 45-49) — the greeting a
 * ship with no government greeting table of its own answers with. The
 * Terrapin on hail/greetings.png is govt-less and says "Greetings.", index 47
 * of this group.
 */
export const GENERIC_GREETING_FIRST_INDEX = 45;
export const GENERIC_GREETING_COUNT = RESPONSE_GROUP_SIZE;
export const GENERIC_GREETING_FALLBACK = 'Nice to meet you.';

/**
 * What a ship says once a beg-for-mercy bribe is PAID (STR# 3000 indices
 * 135-139, "Okay, I'll leave you alone."). The original's own wording for the
 * outcome, so the comm dialog can report the deal instead of slamming the
 * channel shut on the player — see the haggle page's Pay handler.
 */
export const MERCY_ACCEPTED_FIRST_INDEX = 135;
export const MERCY_ACCEPTED_COUNT = RESPONSE_GROUP_SIZE;
export const MERCY_ACCEPTED_FALLBACK = "Okay, I'll leave you alone.";

/**
 * A HOSTILE ship's answer to a hail. Global, not per-government: the per-govt
 * greeting resources (STR# 7000 + govtId - 128, resolved into
 * GovtData.commGreetings) hold only friendly greetings, so a hostile ship
 * answers from this shared group instead — hail/hail_hostile.png shows a
 * hostile Fed Destroyer answering "What is it?" (index 12/13).
 *
 * The neighbouring group at 15-19 ("Calling to beg for your life?") is the
 * original's TAUNT set, which belongs to a different moment (a mercy plea),
 * not to opening the channel.
 */
export const HOSTILE_RESPONSE_FIRST_INDEX = 10;
export const HOSTILE_RESPONSE_COUNT = RESPONSE_GROUP_SIZE;
export const HOSTILE_RESPONSE_FALLBACK = 'What is it you want?';

/** "You don't need help" — the answer to a pointless assistance request. */
export const NO_NEED_RESPONSE_FIRST_INDEX = 70;
export const NO_NEED_RESPONSE_COUNT = RESPONSE_GROUP_SIZE;
export const NO_NEED_RESPONSE_FALLBACK = "You're not in any trouble.";

/** "All right, I'll help you." — the answer when the errand is accepted. */
export const ASSIST_GRANTED_FIRST_INDEX = 75;
export const ASSIST_GRANTED_COUNT = RESPONSE_GROUP_SIZE;
export const ASSIST_GRANTED_FALLBACK = "All right, I'll help you.";

/** The BUSY refusal from a ship in the middle of a fight. */
export const BUSY_RESPONSE_FIRST_INDEX = 80;
export const BUSY_RESPONSE_COUNT = RESPONSE_GROUP_SIZE;
export const BUSY_RESPONSE_FALLBACK = "I'm busy.";

/**
 * A SHIP'S NO-RESPONSE GROUP (STR# 3000 indices 5-9): "No response." / "No
 * response to communication." / "No response detected." / "Sensors are
 * picking up only static." / "No response on this channel." — the ship-comm
 * table's own lines for a hail nobody answers, placed between the
 * channel-open group (0-4) and the hostile one (10-14). Shown on the
 * bottom-left status line in place of a channel for a ship that does not
 * answer ({@link shipAnswersHails}), the way STR# 2002's "No response." is
 * for a dead stellar.
 */
export const SHIP_NO_RESPONSE_FIRST_INDEX = 5;
export const SHIP_NO_RESPONSE_COUNT = RESPONSE_GROUP_SIZE;
export const SHIP_NO_RESPONSE_FALLBACK = 'No response.';

/**
 * A plea for mercy REFUSED (STR# 3000 indices 95-99): "In your dreams,
 * pal." / "Yeah, right!" / "No way." / "You wish." / "Not a chance." — the
 * answer an IFF-hostile ship whose government does not take bribes gives to
 * Beg For Mercy. ASSUMPTION: the table does not label its groups; this one
 * is the flat "no" among them (85-89 is a polite "I'd rather not", and the
 * 15-19 taunts answer the hail itself rather than a plea).
 */
export const MERCY_REFUSED_FIRST_INDEX = 95;
export const MERCY_REFUSED_COUNT = RESPONSE_GROUP_SIZE;
export const MERCY_REFUSED_FALLBACK = 'In your dreams, pal.';

/**
 * One line from a five-variant STR# 3000 group. The original rolls a random
 * variant; this picks one by `seed` (a hash of the ship's uuid, exactly as
 * greetingText does) so the line is stable per encounter, identical on every
 * peer, and draws no PRNG — these dialogs are client-side, and a Math.random
 * here would show two players different text for the same event. Blank
 * entries are skipped rather than answered with, and an entirely missing
 * group falls back to the pinned literal.
 */
function responseText(strings: readonly string[] | undefined, first: number,
    fallback: string, seed: number): string {
    const group: string[] = [];
    for (let i = 0; i < RESPONSE_GROUP_SIZE; i++) {
        const line = strings?.[first + i];
        if (line && line.trim() !== '') {
            group.push(line);
        }
    }
    if (group.length === 0) {
        return fallback;
    }
    return group[seed % group.length];
}

/**
 * The line a hailed ship OPENS the channel with (STR# 3000 indices 0-4), the
 * ship-side twin of {@link stellarChannelOpenText}. Unlike the stellar group
 * these lines are whole sentences — no name is appended.
 */
export function channelOpenText(strings: readonly string[] | undefined,
    seed = 0): string {
    return responseText(strings, CHANNEL_OPEN_FIRST_INDEX,
        CHANNEL_OPEN_FALLBACK, seed);
}

/**
 * The stock generic greeting group (STR# 3000 indices 45-49) as a LIST, for
 * greetingText to fall back on when the ship's government has no greeting
 * STR# of its own. A list rather than one line because greetingText owns the
 * seeded pick for every greeting source, so all of them shuffle together.
 * Blank entries are dropped; an unavailable table yields the pinned literal.
 */
export function genericGreetings(strings: readonly string[] | undefined):
    readonly string[] {
    const group: string[] = [];
    for (let i = 0; i < GENERIC_GREETING_COUNT; i++) {
        const line = strings?.[GENERIC_GREETING_FIRST_INDEX + i];
        if (line && line.trim() !== '') {
            group.push(line);
        }
    }
    return group.length > 0 ? group : [GENERIC_GREETING_FALLBACK];
}

/** A bribed ship's "Okay, I'll leave you alone." (STR# 3000 135-139). */
export function mercyAcceptedText(strings: readonly string[] | undefined,
    seed = 0): string {
    return responseText(strings, MERCY_ACCEPTED_FIRST_INDEX,
        MERCY_ACCEPTED_FALLBACK, seed);
}

/** A silent ship's status-line no-response (STR# 3000 indices 5-9). */
export function shipNoResponseText(strings: readonly string[] | undefined,
    seed = 0): string {
    return responseText(strings, SHIP_NO_RESPONSE_FIRST_INDEX,
        SHIP_NO_RESPONSE_FALLBACK, seed);
}

/** A refused plea for mercy (STR# 3000 indices 95-99). */
export function mercyRefusedText(strings: readonly string[] | undefined,
    seed = 0): string {
    return responseText(strings, MERCY_REFUSED_FIRST_INDEX,
        MERCY_REFUSED_FALLBACK, seed);
}

/** The busy refusal line for a hailed ship (STR# 3000 indices 80-84). */
export function busyResponseText(strings: readonly string[] | undefined,
    seed = 0): string {
    return responseText(strings, BUSY_RESPONSE_FIRST_INDEX,
        BUSY_RESPONSE_FALLBACK, seed);
}

/**
 * The "you don't need help" line for a hailed ship (STR# 3000 indices 70-74),
 * answering an assistance request from a player whose ship is fine.
 */
export function noNeedResponseText(strings: readonly string[] | undefined,
    seed = 0): string {
    return responseText(strings, NO_NEED_RESPONSE_FIRST_INDEX,
        NO_NEED_RESPONSE_FALLBACK, seed);
}

/** The acceptance line for a granted assistance request (indices 75-79). */
export function assistGrantedText(strings: readonly string[] | undefined,
    seed = 0): string {
    return responseText(strings, ASSIST_GRANTED_FIRST_INDEX,
        ASSIST_GRANTED_FALLBACK, seed);
}

/**
 * A hostile ship's answer to a hail (STR# 3000 indices 10-14), used in place
 * of the government greeting the friendly path draws on.
 */
export function hostileResponseText(strings: readonly string[] | undefined,
    seed = 0): string {
    return responseText(strings, HOSTILE_RESPONSE_FIRST_INDEX,
        HOSTILE_RESPONSE_FALLBACK, seed);
}

/**
 * Whether the assistance is free. Roadside-Assistance govts (Flags2 0x0010)
 * always repair/refuel for free, and so does an active ränk with Flags 0x0800
 * ("Ships allied with the affiliated govt will always repair or refuel the
 * player for free") affiliated with the hailed ship's government —
 * `rankFreeRepair`, from rank_logic.ts's ranksGiveFreeRepair.
 *
 * NARROWING: the Bible says ships ALLIED WITH the affiliated govt, not only
 * ships OF it. Allies are expressed through gövt class numbers rather than
 * govt ids (govt_data.ts's classes/allies), so honouring the wider reading
 * would mean resolving the whole ally graph at every hail; the caller passes
 * the same-govt answer, which is the case every stock rank with 0x0800 is
 * written for. Documented, not silent.
 *
 * Non-free assistance is currently also rendered for free (there is no
 * "charge for fuel" credit model yet); this helper still reports the
 * distinction so the dialog can word the offer, and so a future charge can
 * hook in here.
 */
export function assistIsFree(govt: GovtData | undefined,
    rankFreeRepair = false): boolean {
    return rankFreeRepair || !!govt?.flags2.roadsideAssistance;
}

/** Whether a hailed planet's government will take a bribe (hostile planets). */
export function planetTakesBribes(govt: GovtData | undefined): boolean {
    return !!govt && (govt.flags.planetsTakeBribes || govt.flags.largerBribes);
}

/**
 * The stock STELLAR-comm response table (STR# 3002, "Stellar Comm Strings",
 * 50 entries), the planet-side twin of STR# 3000, likewise in groups of five
 * interchangeable variants. The groups this module answers with, verbatim
 * from the real Nova data:
 *
 *   [0-4]   channel open: "Communications channel open to " /
 *           "Communications interlink established with " / "Hailing
 *           frequencies open to " / "Ready with hailing channel to " /
 *           "Channel open to "   (each ends with a SPACE; the stellar's name
 *           is appended — hail/hail_planet.png reads "Channel open to Earth.")
 *   [40-44] bribe offered: "We'll let you slip by the security barrier if you
 *           pay us." / "We'll let you pass through the patrols if you pay
 *           us." / "We'll let you defeat spaceport security if you pay us." /
 *           "You want in?  You'd better grease the hand that feeds you
 *           buddy." / "Pay us and we'll look the other way if you want to
 *           visit our spaceport."
 *   [30-34] bribe refused: "Yeah, you wish." / "No way. Leave immediately." /
 *           "No deal, cheapskate." / "Your greed has been noted. Go away." /
 *           "Apparently you don't want to port here after all."
 *
 * Group [25-26] is tribute accepted and [35-36] tribute released — the
 * domination seam, not modelled. Chosen deterministically by `seed` (a hash of
 * the stellar's uuid), like every other line here.
 */
export const STELLAR_RESPONSE_TABLE = 'nova:3002';

export const STELLAR_CHANNEL_OPEN_FIRST_INDEX = 0;
export const STELLAR_CHANNEL_OPEN_FALLBACK =
    'Communications channel open to ';

export const STELLAR_BRIBE_OFFER_FIRST_INDEX = 40;
export const STELLAR_BRIBE_OFFER_FALLBACK =
    "We'll let you slip by the security barrier if you pay us.";

export const STELLAR_BRIBE_REFUSED_FIRST_INDEX = 30;
export const STELLAR_BRIBE_REFUSED_FALLBACK = 'Yeah, you wish.';

/** "Channel open to " — the prefix the stellar's name is appended to. */
export function stellarChannelOpenText(strings: readonly string[] | undefined,
    seed = 0): string {
    return responseText(strings, STELLAR_CHANNEL_OPEN_FIRST_INDEX,
        STELLAR_CHANNEL_OPEN_FALLBACK, seed);
}

/** The port's price for looking the other way (STR# 3002 indices 40-44). */
export function stellarBribeOfferText(strings: readonly string[] | undefined,
    seed = 0): string {
    return responseText(strings, STELLAR_BRIBE_OFFER_FIRST_INDEX,
        STELLAR_BRIBE_OFFER_FALLBACK, seed);
}

/** A port that won't be bought (STR# 3002 indices 30-34). */
export function stellarBribeRefusedText(strings: readonly string[] | undefined,
    seed = 0): string {
    return responseText(strings, STELLAR_BRIBE_REFUSED_FIRST_INDEX,
        STELLAR_BRIBE_REFUSED_FALLBACK, seed);
}

/**
 * The stock misc-strings table (STR# 2002), which holds the traffic-control
 * lines. Used verbatim rather than paraphrased:
 *
 *   [52] "No response."
 *   [81] "Docking request denied."   [82] "Landing request denied."
 *   [95] "You are cleared to dock."  [98] "You are cleared to land."
 *   [172] "Forbidden"                [173] "Hostile"
 *
 * (Indices 96/97 and 93/94 are the headline and lower-case continuation forms
 * of the clearance, used after a name; the standalone sentences are what a
 * comm-dialog body wants.) The literals below are the pinned fallbacks and
 * are what status_bar_content's clearanceDeniedMessage already emits.
 */
export const MISC_STRING_TABLE = 'nova:2002';
/**
 * "No response." — what the original prints on the bottom-left STATUS LINE
 * when a hail goes unanswered, rather than opening a comm channel. Its
 * neighbour at 53 ("Unable to send hail - target ship is entering
 * hyperspace.") is the other hail-failure status line, which is what pins
 * this as the status-line group and not a comm-dialog body. Used for a hail
 * at an UNINHABITED stellar: there is no traffic control there to answer.
 */
export const NO_RESPONSE_INDEX = 52;
export const NO_RESPONSE_FALLBACK = 'No response.';
export const DOCKING_DENIED_INDEX = 81;
export const LANDING_DENIED_INDEX = 82;
export const CLEARED_TO_DOCK_INDEX = 95;
export const CLEARED_TO_LAND_INDEX = 98;
export const STELLAR_STATUS_FORBIDDEN_INDEX = 172;
export const STELLAR_STATUS_HOSTILE_INDEX = 173;

/** One STR# 2002 line, falling back to its pinned literal. */
export function miscString(strings: readonly string[] | undefined,
    index: number, fallback: string): string {
    const line = strings?.[index];
    return line && line.trim() !== '' ? line : fallback;
}

/**
 * A stable 32-bit hash of a string (FNV-1a). Used to pick a government
 * greeting deterministically from a ship's uuid, so the client-side dialog
 * chooses the same line on every peer and every re-hail (never Math.random).
 */
export function hashString(value: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        // 32-bit FNV prime multiply, kept in the unsigned 32-bit range.
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
}

/**
 * The greeting line the GREETINGS BUTTON produces — not what the channel
 * opens with (that is {@link channelOpenText}). Precedence: a përs ship's
 * resolved CommQuote (STR# 7100) wins; then a real line from the
 * government's greeting STR# (GovtData.commGreetings), chosen
 * deterministically by `seed` (a hash of the ship's uuid) so every peer
 * agrees; then the stock generic greeting group (STR# 3000 45-49, see
 * {@link genericGreetings}) for a ship whose government has no greeting
 * resource — or which has no government at all, like the Terrapin answering
 * "Greetings." on hail/greetings.png; and only if even that table is
 * unavailable, a synthetic govt-appropriate line. Returns '' when the govt is
 * not talkative (noDistressMessages / noAssistOrMercy) — the caller shows "no
 * response".
 */
export function greetingText(opts: {
    persCommQuote?: string,
    govtGreetings?: readonly string[],
    /** The stock generic group (STR# 3000 45-49), when it could be loaded. */
    genericGreetings?: readonly string[],
    govtCommName?: string,
    talkative: boolean,
    seed?: number,
}): string {
    if (!opts.talkative) {
        return '';
    }
    if (opts.persCommQuote && opts.persCommQuote.trim() !== '') {
        return opts.persCommQuote;
    }
    for (const source of [opts.govtGreetings, opts.genericGreetings]) {
        const greetings = (source ?? []).filter(line => line.trim() !== '');
        if (greetings.length > 0) {
            return greetings[(opts.seed ?? 0) % greetings.length];
        }
    }
    const who = opts.govtCommName && opts.govtCommName.trim() !== ''
        ? opts.govtCommName
        : 'this vessel';
    return `Greetings from ${who}. Fly safe, captain.`;
}

