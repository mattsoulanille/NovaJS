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
 * whether the comm dialog offers the button at all. Whether the ship then
 * HELPS is a separate question ({@link assistWillingness}).
 *
 * Matthew's ruling on #297 (2026-10-03): "The request assistance / beg for
 * mercy button should always be visible for ships that communicate (e.g.,
 * not Dechtakar / hyperioid). They just refuse to help you or make you
 * pay." So the button is offered to every ship that answers a hail and is
 * not IFF-hostile, WHATEVER its government thinks of the player — a ship of
 * an unfriendly government refuses or names a price when asked; it no
 * longer hides the button. Two kinds of ship do not "communicate":
 *
 *  - a silent ship ({@link shipAnswersHails}: the Hyperioid, the Krypt, the
 *    Wraith) opens no channel at all;
 *  - a gövt with Flags2 0x0001 — the Bible: "the request assistance / beg
 *    for mercy button is disabled and the govt is not talkative". That is
 *    the Dechtakar (gövt 142/189 Rimerta, Flags2 0x0027) of the ruling's
 *    example, whose channel the original opens with Greetings and Close
 *    only ("some don't have a 'request assistance' button (Polaris (often)
 *    and Dechtakar)", the first ruling on #297).
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
 */
export function canRequestAssistance(opts: {
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
    return !opts.govt?.flags2.noAssistOrMercy;
}

/**
 * HOW A SHIP THAT HAS BEEN ASKED FOR HELP RESPONDS, once the request is not
 * pointless (the player needs help) and the ship is not busy fighting:
 *
 *  - 'willing'  it comes over (STR# 3000 75-79, "All right, I'll help
 *               you.").
 *  - 'forPay'   it names a price (STR# 3000 140-144, "All right, I'll give
 *               you some help, but it'll cost you.") on the haggle page, and
 *               comes once paid.
 *  - 'unwilling' it refuses (STR# 3000 85-89, "I'd rather not.").
 *
 * Matthew's rulings on #297: "A ship of an unfriendly government may show as
 * neutral when hailed, but they will likely be rude and not offer assistance
 * for free, or at all", and "They just refuse to help you or make you pay."
 * So `disposition` — the GOVERNMENT's stance toward the player
 * (iff_plugin's shipDisposition), not the ship's IFF — decides: a ship whose
 * government is hostile to the player asks to be paid when that government
 * takes bribes from a ship of its kind (the same bribe flags Beg For Mercy
 * reads, {@link shipTakesBribes}) and refuses otherwise. Every other ship
 * answers as below.
 *
 * ränk 0x0400 ("Player can always request battle assistance from ships of
 * the affiliated government") overrides the politics for a WARSHIP of that
 * government: always willing ({@link rankBattleAssistance}). Not for a
 * TRADER: reference "H1 wave 17", finding 7 — a trader of the affiliated
 * govt, asked by a ränk 0x0400 holder under raider fire, said "Not a
 * chance." GUESS for warships (none met on the reference): they keep the
 * old always-willing answer.
 *
 * NOBODY ELSE HELPS FOR FREE, allies included. Measured on the original
 * (reference "W1 / C1 / H1 wave 16" and "H1 wave 17", H1):
 *
 *  - 'refuse'    a DISABLED pilot is turned down flat by traders and
 *                warships alike, from the STR# 3000 95-99 group ("Not a
 *                chance.", "Yeah, right!", "In your dreams, pal.";
 *                {@link disabledRefusalText}) — at record 0, at record
 *                +2000, and when his own hull is of a govt ALLIED with the
 *                hailed ship's (wave 17, finding 6: two Kit Shipping
 *                traders refused a Kit Fragile Ally pilot). So the old
 *                "allies help for free" guess is gone: a 'friendly'
 *                disposition answers like a neutral one.
 *  - 'sellFuel'  a pilot OUT OF FUEL is offered fuel for money, by
 *                traders and warships alike (wave 17, finding 4): a mood
 *                line and "Pay me N credits." with Lower Price / Accept
 *                Price ({@link fuelSaleTerms}, {@link fuelSalePrice},
 *                {@link lowerFuelPrice}); once paid the ship comes over and
 *                puts one jump of fuel in the tank ({@link FUEL_SALE_AMOUNT}).
 *                GUESS: an allied ship sells like a neutral one (only a
 *                disabled ally was measured).
 *
 * Free help stays where the data says it is free: a Roadside Assistance govt
 * (Flags2 0x0010) and a ränk 0x0800 holder ({@link assistIsFree}), and a
 * ränk 0x0400 holder asking a warship (above). GUESS: a disabled pilot who
 * is also out of fuel is refused (being disabled is the bigger need, and a
 * neutral ship would not repair him). The player's legal record is not read:
 * a +2000 record changed neither the refusal nor the fuel price nor the mood
 * (wave 17, findings 5 and 6), and wave 15 refused a +1000 pilot under fire
 * alike (the table's "Okay, since your reputation is so good." group
 * 160-164 is unused until a run shows when it is said).
 *
 * `need` is what the player needs help with ({@link assistNeed}); a request
 * with no need never reaches this function (the "You're not in any trouble."
 * answer comes first).
 *
 * Pure over synced state, so the dialog's answer and applyHail's outcome
 * agree on every peer.
 */
export type AssistWillingness =
    'willing' | 'forPay' | 'unwilling' | 'refuse' | 'sellFuel';

/** What a pilot asking for help needs: a repair, or only fuel. */
export type AssistNeed = 'disabled' | 'fuel';

export function assistWillingness(opts: {
    disposition: Disposition,
    govt: GovtData | undefined,
    aiType: number | undefined,
    rankAlwaysAssists?: boolean,
    /** {@link assistIsFree}: Roadside Assistance, or a ränk 0x0800. */
    free?: boolean,
    /** Defaults to 'disabled' (the stricter answer). */
    need?: AssistNeed,
}): AssistWillingness {
    if (opts.free
        || rankBattleAssistance(opts.rankAlwaysAssists, opts.aiType)) {
        return 'willing';
    }
    if (opts.disposition === 'hostile') {
        return shipTakesBribes(opts.govt, opts.aiType)
            ? 'forPay' : 'unwilling';
    }
    return opts.need === 'fuel' ? 'sellFuel' : 'refuse';
}

/** AI types 1 (wimpy trader) and 2 (brave trader): the freighters. */
export function isTraderAiType(aiType: number | undefined): boolean {
    return aiType === 1 || aiType === 2;
}

/**
 * Whether a ränk 0x0400 ("Player can always request battle assistance from
 * ships of the affiliated government", `rankAlwaysAssists`: ranksAllow-
 * Assistance for the hailed ship's govt) makes THIS ship help. Not a trader
 * (reference "H1 wave 17", finding 7: "Not a chance." from a trader of the
 * affiliated govt); GUESS: a warship (AI 3 / 4, or a ship with no AI type)
 * still does, as before — none was met on the reference.
 */
export function rankBattleAssistance(rankAlwaysAssists: boolean | undefined,
    aiType: number | undefined): boolean {
    return !!rankAlwaysAssists && !isTraderAiType(aiType);
}

/**
 * WHAT A STRANDED PILOT NEEDS, or undefined when his ship is fine: a disabled
 * ship needs a repair (whatever its fuel), one with less than a jump's worth
 * of fuel ({@link LOW_FUEL_THRESHOLD}) and room for more needs fuel. Pure, so
 * the dialog's answer and applyHail agree.
 */
export function assistNeed(disabled: boolean,
    fuel: { current: number, max: number } | undefined):
    AssistNeed | undefined {
    if (disabled) {
        return 'disabled';
    }
    return fuel && fuel.current < fuel.max
        && fuel.current < LOW_FUEL_THRESHOLD ? 'fuel' : undefined;
}

/** Under one jump's worth of fuel (ship/health_plugin's FUEL_PER_JUMP =
 * 100) counts as "out of fuel" for a request for help. */
export const LOW_FUEL_THRESHOLD = 100;

/**
 * How much fuel a neutral ship SELLS a stranded pilot: one jump's worth
 * (FUEL_PER_JUMP = 100), added to what is in the tank and capped at the
 * tank. Reference H1 wave 16: the fuel bar went from 0 to about 3% of a Kit
 * Lancer Heavy's 3000 within 30 s of Accept Price, i.e. about one jump (the
 * amount was read off the bar: low confidence).
 */
export const FUEL_SALE_AMOUNT = 100;

/**
 * A fuel seller's MOOD, drawn once per ship: it picks the line the ship
 * opens its offer with and the base of its price ({@link fuelSaleTerms}).
 */
export type FuelSaleMood = 'good' | 'neutral' | 'bad';

/** What a ship selling fuel asks before any haggling: its mood and base. */
export interface FuelSaleTerms {
    mood: FuelSaleMood;
    /** The first ask's price, in credits. */
    base: number;
}

/** What every repeated ask to the same ship adds to its price, and the
 * unit of every base (reference H1 wave 17, finding 1). */
export const FUEL_SALE_PRICE_STEP = 1000;

/**
 * THE SHIP'S MOOD AND BASE PRICE. Reference "H1 wave 17" (six ships, two
 * pilots, 1,000,000 credits each), findings 1, 2 and 5: every opening line
 * stayed the same for its ship, and went with the base —
 *
 *  - good mood ("You're in luck, I'm in a good mood today.", STR# 3000
 *    115-119): 1,000 (two ships);
 *  - neutral ("All right, I'll give you some help, but it'll cost you.",
 *    140-144): 2,000 or 3,000 (three ships: 3,000, 2,000, 3,000);
 *  - bad mood ("I'm in a bad mood today, so it's going to cost extra.",
 *    120-124): 3,000 (one ship);
 *
 * whatever the pilot's record (good and bad moods both at +2000).
 *
 * WHAT PICKS 2,000 OR 3,000 for a neutral ship was not settled by the
 * data (no ship type or record separates them). The rule here draws the
 * BASE first, 1,000 / 2,000 / 3,000 alike, and lets the base pick the
 * mood: 1,000 is a good mood, 2,000 neutral, 3,000 neutral or bad alike.
 * That reproduces every row (good only at 1,000, bad only at 3,000,
 * neutral at both) and the frequencies seen, 2 good : 3 neutral : 1 bad
 * of six (this rule's 1/3 : 1/2 : 1/6). GUESS for the draw itself.
 *
 * DETERMINISTIC without the PRNG: a salted hash of the ship's uuid, like
 * every comm line here, so the dialog (which must quote the price before
 * any record is applied) and applyHail (which charges it) agree on every
 * peer, and the ship keeps its mood for every pilot and every ask.
 */
export function fuelSaleTerms(shipUuid: string): FuelSaleTerms {
    const roll = hashString(`fuelSale:base:${shipUuid}`);
    const base = FUEL_SALE_PRICE_STEP * (1 + roll % 3);
    const mood: FuelSaleMood = base === FUEL_SALE_PRICE_STEP ? 'good'
        : base === 2 * FUEL_SALE_PRICE_STEP ? 'neutral'
            : hashString(`fuelSale:mood:${shipUuid}`) % 2 === 0
                ? 'neutral' : 'bad';
    return { mood, base };
}

/**
 * Where one pilot stands with one fuel seller (npc/hail_component's
 * FuelHaggle entry): how many of the ship's offers he has already
 * answered (`asks`), and whether the offer on the table right now is the
 * ship's 3/4 COUNTER rather than its asking price (`countered`).
 */
export interface FuelHaggleState {
    asks: number;
    countered: boolean;
}

/** A pilot who has not haggled with this ship yet. */
export const NO_FUEL_HAGGLE: FuelHaggleState =
    Object.freeze({ asks: 0, countered: false });

/** Asks are clamped here so the price stays an exact integer. */
const MAX_FUEL_ASKS = 1_000_000;

/**
 * The price on the table: the ship's base plus 1,000 for every offer the
 * pilot has already answered (reference H1 wave 17, finding 1: one ship
 * asked 3,000 / 4,000 / 5,000, another 2,000 / 3,000, another 1,000 /
 * 2,000), or the 3/4 counter to it ({@link fuelCounterPrice}) while one is
 * on the table. A +2000 record changed nothing (finding 5).
 */
export function fuelSalePrice(base: number, haggle: FuelHaggleState):
    number {
    const asks = Math.max(0, Math.min(MAX_FUEL_ASKS,
        Math.floor(haggle.asks) || 0));
    const asking = base + FUEL_SALE_PRICE_STEP * asks;
    return haggle.countered ? fuelCounterPrice(asking) : asking;
}

/**
 * Lower Price's counter-offer: 3/4 of the price, rounded DOWN to 100.
 * Reference H1 wave 17, finding 3: 4,000 -> 3,000, 2,000 -> 1,500, 5,000
 * -> 3,700, 1,000 -> 700, 3,000 -> 2,200 — all five counters fit exactly.
 * Integer arithmetic, so no float rounding can move a figure.
 */
export function fuelCounterPrice(price: number): number {
    return Math.floor((Math.floor(price) * 3) / 400) * 100;
}

/**
 * Of five FIRST Lower Price presses, this many get a counter rather than a
 * withdrawal: reference H1 wave 17 saw 5 counters in 13 first presses
 * (about 40%).
 */
export const FUEL_COUNTER_IN_FIVE = 2;

/**
 * WHAT LOWER PRICE DOES (reference H1 wave 17, finding 3): on the ship's
 * asking price it either COUNTERS with 3/4 of it ({@link fuelCounterPrice};
 * the popup stays, the new price on it) or WITHDRAWS the offer (STR# 3000
 * 155-159, "Ha ha ha. What a comedian." / "If that's the way you feel ..."
 * / "Fine, I guess you don't want my help."); on a counter it ALWAYS
 * withdraws (every second press did). A withdrawal ends that ask: the next
 * one costs 1,000 more.
 *
 * Which first press counters is a draw the reference could only count (5
 * of 13, no pattern by ship, mood, price or record): here a hash of the
 * ship, the pilot and the ask, so it is the same on every peer and in the
 * dialog that has to show it before the record is applied, never the
 * PRNG. Pure.
 */
export function lowerFuelPrice(haggle: FuelHaggleState, shipUuid: string,
    playerUuid: string):
    { haggle: FuelHaggleState, outcome: 'counter' | 'withdraw' } {
    if (!haggle.countered && fuelLowerPriceCounters(shipUuid, playerUuid,
        haggle.asks)) {
        return { haggle: { asks: haggle.asks, countered: true },
            outcome: 'counter' };
    }
    return { haggle: { asks: haggle.asks + 1, countered: false },
        outcome: 'withdraw' };
}

/** Whether the first Lower Price on ask number `asks` counters (see
 * {@link lowerFuelPrice}). */
export function fuelLowerPriceCounters(shipUuid: string, playerUuid: string,
    asks: number): boolean {
    return hashString(`fuelSale:lower:${shipUuid}:${playerUuid}:${asks}`)
        % 5 < FUEL_COUNTER_IN_FIVE;
}

/**
 * The haggle once Accept Price has been paid: that ask is over, so asking
 * the same ship again (fuelless once more) costs 1,000 more. GUESS: an
 * accepted offer counts as an ask like a withdrawn one (only withdrawn
 * offers were followed by another ask on the reference).
 */
export function fuelHaggleAfterAccept(haggle: FuelHaggleState):
    FuelHaggleState {
    return { asks: haggle.asks + 1, countered: false };
}

/**
 * The FURTHER-ALONG of two views of one haggle — the simulation's mirrored
 * entry and the dialog's own presses it has not mirrored back yet. Every
 * step moves forward (a counter, then the next ask), so the order is
 * asks first, then countered.
 */
export function laterFuelHaggle(a: FuelHaggleState | undefined,
    b: FuelHaggleState | undefined): FuelHaggleState {
    const progress = (h: FuelHaggleState) => h.asks * 2 + (h.countered ? 1 : 0);
    if (!a) {
        return b ?? NO_FUEL_HAGGLE;
    }
    if (!b) {
        return a;
    }
    return progress(b) > progress(a) ? b : a;
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
 *   [85-89] unwilling: "I'd rather not." / "Sorry, I'd rather not." / "I
 *                     don't think so." / "I think not." / "I don't think I
 *                     want to." — an unfriendly ship refusing to help.
 *   [113-114] escort: "Sorry sir, I'm just an escort." (twice) — someone
 *                     else's escort asked for help (ruling #332's
 *                     screenshot of the original).
 *   [135-139] mercy:  "Okay, I'll leave you alone." / "All right, I'll leave
 *                     you alone." (the group repeats those two) — what a ship
 *                     says once a beg-for-mercy bribe is paid.
 *   [140-144] for pay: "All right, I'll give you some help, but it'll cost
 *                     you." / "I'll help you out if you pay me." / ... — an
 *                     unfriendly ship that takes bribes, asked for help.
 *   [145-149] paid:   "Okay, I'm on my way." / "Hold on, I'll be right
 *                     there." / ... — that ship once paid.
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
 * THE SAME GROUP IS THE RUDE GREETING (ruling #297, 2026-10-03): a ship
 * whose GOVERNMENT is unfriendly to the player but which is not IFF-hostile
 * answers the Greetings button with one of these — "What is it you want?" /
 * "What do you want?" / "What is it?" / "What is it?" / "What?", entries
 * 11-15 of STR# 3000 in the maintainer's one-indexed resource viewer, i.e.
 * indices 10-14 here ({@link rudeGreetingText}).
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

/** "I'd rather not." — an 'unwilling' ship ({@link assistWillingness}). */
export const ASSIST_REFUSED_FIRST_INDEX = 85;
export const ASSIST_REFUSED_COUNT = RESPONSE_GROUP_SIZE;
export const ASSIST_REFUSED_FALLBACK = "I'd rather not.";

/**
 * "Sorry sir, I'm just an escort." — what someone else's escort says to a
 * request for help. Ruling #332's screenshot of the original: a Fed Viper
 * escort, hailed, answering Request Assistance with exactly this line. Only
 * TWO entries (113-114): the rest of the 110-114 run is "Sorry sir, I can't
 * help you." / "... can't do that." (twice), a different refusal.
 */
export const JUST_AN_ESCORT_FIRST_INDEX = 113;
export const JUST_AN_ESCORT_COUNT = 2;
export const JUST_AN_ESCORT_FALLBACK = "Sorry sir, I'm just an escort.";

/** "... but it'll cost you." — a 'forPay' ship's price, before paying. */
export const ASSIST_FOR_PAY_FIRST_INDEX = 140;
export const ASSIST_FOR_PAY_COUNT = RESPONSE_GROUP_SIZE;
export const ASSIST_FOR_PAY_FALLBACK =
    "All right, I'll give you some help, but it'll cost you.";

/** "Okay, I'm on my way." — a 'forPay' ship once paid, and a 'sellFuel'
 * ship once its price is accepted ("Hold on, I'll be right there.", index
 * 146, on the reference H1 wave 16 capture). */
export const ASSIST_PAID_FIRST_INDEX = 145;
export const ASSIST_PAID_COUNT = RESPONSE_GROUP_SIZE;
export const ASSIST_PAID_FALLBACK = "Okay, I'm on my way.";

/**
 * The line a fuel seller opens its offer with, by MOOD ({@link
 * fuelSaleTerms}), shown in the comm's response well above the "Pay me
 * ..." popup and the same for every ask to that ship. Reference H1 waves 16
 * and 17 (STR# 3000 0-based):
 *
 *   good    115-119 "You're in luck, I'm in a good mood today." (1,000)
 *   neutral 140-144 "All right, I'll give you some help, but it'll cost
 *                   you." / "I'll help you out if you pay me." (2,000-3,000;
 *                   the group an unfriendly ship's price opens with too,
 *                   {@link ASSIST_FOR_PAY_FIRST_INDEX})
 *   bad     120-124 "I'm in a bad mood today, so it's going to cost
 *                   extra." (3,000)
 */
export const FUEL_SALE_MOOD_FIRST_INDEX = 115;
export const FUEL_SALE_MOOD_COUNT = RESPONSE_GROUP_SIZE;
export const FUEL_SALE_MOOD_FALLBACK =
    "You're lucky - I'm in a good mood today.";
export const FUEL_SALE_BAD_MOOD_FIRST_INDEX = 120;
export const FUEL_SALE_BAD_MOOD_FALLBACK =
    "I'm in a bad mood today, so it's going to cost you.";

/**
 * "If that's the way you feel, then you can sit here forever." (STR# 3000
 * 155-159; 155, 156 and 157 on the reference H1 wave 16 / 17 captures) —
 * a ship whose price for fuel the player answered with Lower Price, when it
 * withdraws the offer ({@link lowerFuelPrice}). (150-154, "Die,
 * cheapskate!", is the pirate's answer to a lowered mercy price.)
 */
export const FUEL_OFFER_WITHDRAWN_FIRST_INDEX = 155;
export const FUEL_OFFER_WITHDRAWN_COUNT = RESPONSE_GROUP_SIZE;
export const FUEL_OFFER_WITHDRAWN_FALLBACK = 'Ha ha ha. What a comedian.';

/**
 * The haggle popup's demand, "Pay me 1,000 credits." (reference H1 wave 16),
 * built the way the original builds it out of STR# 2002: "Pay me" (index
 * 186), the price with thousands separators, "credits" (index 32), and a
 * full stop.
 */
export const PAY_ME_INDEX = 186;
export const PAY_ME_FALLBACK = 'Pay me';
export const CREDITS_WORD_INDEX = 32;
export const CREDITS_WORD_FALLBACK = 'credits';

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
 *
 * MEASURED for another moment ({@link underFireRefusalText}): a healthy
 * pilot under raider fire who asks a neutral ship for assistance is refused
 * from this group ("Yeah, right!", "No way."), whatever his record
 * (reference "W1 / C1 / H1 wave 15", H1). The mercy-plea use is still the
 * assumption above.
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
    fallback: string, seed: number, count = RESPONSE_GROUP_SIZE): string {
    const group: string[] = [];
    for (let i = 0; i < count; i++) {
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

/** An unwilling ship's refusal to help (STR# 3000 indices 85-89). */
export function assistRefusedText(strings: readonly string[] | undefined,
    seed = 0): string {
    return responseText(strings, ASSIST_REFUSED_FIRST_INDEX,
        ASSIST_REFUSED_FALLBACK, seed, ASSIST_REFUSED_COUNT);
}

/** Someone else's escort, asked for help (STR# 3000 indices 113-114). */
export function justAnEscortText(strings: readonly string[] | undefined,
    seed = 0): string {
    return responseText(strings, JUST_AN_ESCORT_FIRST_INDEX,
        JUST_AN_ESCORT_FALLBACK, seed, JUST_AN_ESCORT_COUNT);
}

/** A 'forPay' ship naming its terms (STR# 3000 indices 140-144). */
export function assistForPayText(strings: readonly string[] | undefined,
    seed = 0): string {
    return responseText(strings, ASSIST_FOR_PAY_FIRST_INDEX,
        ASSIST_FOR_PAY_FALLBACK, seed, ASSIST_FOR_PAY_COUNT);
}

/** A 'forPay' ship once paid (STR# 3000 indices 145-149). */
export function assistPaidText(strings: readonly string[] | undefined,
    seed = 0): string {
    return responseText(strings, ASSIST_PAID_FIRST_INDEX,
        ASSIST_PAID_FALLBACK, seed, ASSIST_PAID_COUNT);
}

/**
 * The RUDE greeting (STR# 3000 indices 10-14, "What is it you want?"): what
 * the Greetings button gets from a ship whose government is unfriendly to
 * the player but which is not IFF-hostile (ruling #297). The same group a
 * hostile ship opens its channel with — see HOSTILE_RESPONSE_FIRST_INDEX.
 */
export function rudeGreetingText(strings: readonly string[] | undefined,
    seed = 0): string {
    return hostileResponseText(strings, seed);
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

/**
 * The refusal a HEALTHY player under attack gets for Request Assistance
 * (STR# 3000 indices 95-99, the refused-plea group: "Yeah, right!", "No
 * way."). Measured on the original: a neutral warship and a neutral trader,
 * asked for help by a pilot under raider fire but far from disabled, both
 * answered from this group, with record 0 and with record +1000 and combat
 * rating 6400 alike; never "You're not in any trouble." (70-74) nor "I'd
 * rather not." (85-89). Reference "W1 / C1 / H1 wave 15", finding 8.
 */
export function underFireRefusalText(strings: readonly string[] | undefined,
    seed = 0): string {
    return responseText(strings, MERCY_REFUSED_FIRST_INDEX,
        MERCY_REFUSED_FALLBACK, seed);
}

/**
 * The refusal a DISABLED pilot gets from a ship that does not help for free
 * (STR# 3000 95-99, the same flat "no" group as {@link
 * underFireRefusalText}). Measured on the original: a neutral trader
 * answered "Not a chance." and a neutral warship "No way." to a disabled
 * pilot with record 0 (reference "W1 / C1 / H1 wave 16", H1 finding 5);
 * "Yeah, right!" and "Not a chance." at record +2000, and "In your dreams,
 * pal." / "Yeah, right!" from two traders of a govt ALLIED with the pilot's
 * hull (reference "H1 wave 17", finding 6). Nothing else happens: no ship
 * comes to repair him.
 */
export function disabledRefusalText(strings: readonly string[] | undefined,
    seed = 0): string {
    return responseText(strings, MERCY_REFUSED_FIRST_INDEX,
        MERCY_REFUSED_FALLBACK, seed);
}

/** A ship offering fuel for a price, in its mood (STR# 3000 115-119,
 * 140-144 or 120-124; see {@link FUEL_SALE_MOOD_FIRST_INDEX}). */
export function fuelSaleMoodText(strings: readonly string[] | undefined,
    mood: FuelSaleMood, seed = 0): string {
    switch (mood) {
        case 'good':
            return responseText(strings, FUEL_SALE_MOOD_FIRST_INDEX,
                FUEL_SALE_MOOD_FALLBACK, seed);
        case 'neutral':
            return assistForPayText(strings, seed);
        case 'bad':
            return responseText(strings, FUEL_SALE_BAD_MOOD_FIRST_INDEX,
                FUEL_SALE_BAD_MOOD_FALLBACK, seed);
    }
}

/** A price for help answered with Lower Price (STR# 3000 155-159). */
export function fuelOfferWithdrawnText(
    strings: readonly string[] | undefined, seed = 0): string {
    return responseText(strings, FUEL_OFFER_WITHDRAWN_FIRST_INDEX,
        FUEL_OFFER_WITHDRAWN_FALLBACK, seed);
}

/**
 * The haggle popup's demand line, "Pay me 1,000 credits.", from STR# 2002's
 * "Pay me" (186) and "credits" (32) (`miscStrings`, or their pinned
 * literals). The figure is grouped with commas as on the reference capture,
 * independent of the browser's locale.
 */
export function payMeText(miscStrings: readonly string[] | undefined,
    price: number): string {
    const payMe = miscString(miscStrings, PAY_ME_INDEX, PAY_ME_FALLBACK);
    const credits = miscString(miscStrings, CREDITS_WORD_INDEX,
        CREDITS_WORD_FALLBACK);
    const figure = Math.floor(price).toString()
        .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${payMe} ${figure} ${credits}.`;
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
 * Free help is what {@link assistWillingness} grants a non-hostile ship's
 * request with: without it a ship refuses a disabled pilot and sells a
 * fuelless one fuel (reference H1 waves 16 and 17), allies included.
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

