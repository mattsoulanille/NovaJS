import { SpaceObjectData, getDefaultSpaceObjectData } from "./space_object_data.js";
import { DamageType } from "./weapon_data.js";

/**
 * A hypergate/wormhole transit endpoint, if this stellar is one.
 *
 * Populated from the spöb flags2 hypergate (0x1000) / wormhole (0x2000) bits
 * and the HyperLink1-8 fields (EVN Bible p. 61). See jump_gate_plugin.ts for
 * how transit resolves a destination from this.
 */
export interface GateData {
    kind: "hypergate" | "wormhole";

    /**
     * Global ids of the spöb resources this gate/wormhole connects to (its
     * defined HyperLink1-8 destinations, resolved to global ids; unset -1/0
     * links dropped). For a hypergate these are the choices the player is
     * offered. For a wormhole these are its exit(s); an empty list means the
     * wormhole has no defined links and connects to a random other link-less
     * wormhole (Bible p. 61 "random wormhole" behavior).
     */
    destinations: string[];

    /**
     * The angle (degrees, 0-359) at which ships emerge from the destination
     * gate/wormhole, from the spöb's CustSndID field (which serves this
     * purpose for hypergates/wormholes — Bible p. 60). null means "a random
     * direction" (any CustSndID outside 0-359); callers pick a seeded-random
     * angle so it stays deterministic.
     */
    emergenceAngle: number | null;
}

/**
 * A stellar's defence fleet: the ships it launches when attacked or when
 * the player tries to dominate it. From the spöb DefenseDude and DefCount
 * fields (EVN Bible, spöb resource; TMPL offsets 28 and 30).
 *
 * PARSED ONLY: nothing in the game launches defence fleets yet (see the
 * gameplay feature request, tracker issue #353).
 */
export interface PlanetDefenseFleet {
    /**
     * Global id of the düde that determines the defence ships'
     * characteristics (DefenseDude 128-639, resolved in the spöb's own id
     * space). DefenseDude -1 (or any id that does not resolve) means the
     * stellar has no defence fleet, and the whole PlanetData.defense is
     * null.
     */
    dude: string;
    /**
     * The TOTAL number of ships in the defence fleet, decoded from DefCount.
     * Always at least 1 (a DefCount that decodes to no ships makes the whole
     * PlanetData.defense null). The Bible's encoding:
     *
     *   below 1000   that many ships, launched all at once (waveSize null)
     *   1000 and up  launched in WAVES: "The last number in this field is the
     *                number of ships in each wave, and the first 3-4 numbers
     *                (minus 1 from the first digit) are the total number of
     *                ships". So 1082 is four waves of two ships (8 total),
     *                2005 is waves of five with 100 total, and the stock
     *                2206 is waves of six with 120 total.
     *
     * "Minus 1 from the first digit" is taken literally, so a five-digit
     * DefCount subtracts 1000, not 100: 32767 is 2276 ships in waves of 7,
     * which is exactly ResForge's documented maximum count of 2276
     * (docs/tmpl, "Defense Ship Count | max 2276"). Every stock DefCount is
     * four digits, where the two readings agree.
     */
    count: number;
    /**
     * Ships per wave (1-9), or null when the whole fleet launches at once:
     * a DefCount below 1000, or a wave-encoded DefCount whose last digit is
     * 0 (ResForge: "Defense Wave Size ... 0 = unlimited").
     */
    waveSize: number | null;
}

/**
 * A stellar's weapon (spöb Weapon, EVN Bible: "Stellars can have a single
 * projectile or missile type weapon, with unlimited ammunition").
 *
 * PARSED ONLY: stellars do not fire yet.
 */
export interface PlanetWeaponData {
    /**
     * Global wëap id (Weapon 128-383). Weapon 0 or -1 ("No weapon"), or an
     * id that does not resolve, makes the whole PlanetData.weapon null.
     */
    id: string;
    /**
     * spöb Flags2 0x0200: "If the stellar has a weapon, it will only fire
     * when provoked (i.e. only when the player is trying to dominate it)".
     * When false the stellar fires "any time an enemy ship is present".
     * (268 of the 411 stock spöbs set the bit but only 4 of those are
     * armed; on an unarmed stellar it means nothing, so it is only surfaced
     * here, alongside the weapon it qualifies.)
     */
    firesOnlyWhenProvoked: boolean;
}

/**
 * The domination fields of a stellar. In the original the player
 * dominates a stellar by demanding tribute and defeating its defence
 * fleet; a dominated stellar then pays tribute daily. Domination is
 * per-player state (admin1's ruling on #306, matching the original's pilot
 * file); none of it is in PlanetData, which only describes the stellar.
 *
 * PARSED ONLY: nothing in the game implements domination yet.
 */
export interface PlanetDominationData {
    /**
     * Credits paid per day while dominated, ALREADY DECODED: the spöb
     * Tribute field "-1 or 0  Default amount (1000 credits x Tech Level)",
     * "1 and up  This number of credits per day". Any non-positive Tribute
     * is treated as the default, so this is 1000 * techLevel there (0 for a
     * tech-0 stellar).
     */
    tribute: number;
    /**
     * spöb Flags2 0x0020: "Stellar is always dominated (all your base are
     * belong to us)". No stock stellar sets it. The Bible defines no
     * "can never be dominated" flag; what makes a stellar dominatable at
     * all is engine behaviour, not data (see feature request #353).
     */
    alwaysDominated: boolean;
    /**
     * NCB set expression "evaluated when the stellar is successfully
     * dominated by the player" (spöb OnDominate). Already namespaced to
     * physical control bits by novaparse's ncb_namespace. Empty if unused.
     */
    onDominate: string;
    /**
     * NCB set expression "evaluated when the stellar is released from
     * domination by the player" (spöb OnRelease). Namespaced like
     * onDominate. Empty if unused.
     */
    onRelease: string;
}

/**
 * The destruction and regeneration fields of a stellar. A stellar is
 * destroyed by planetary-type weapons wearing down its Strength, or by the
 * NCB set operator `Yxxx` ("destroy stellar ID xxx"); `Uxxx` regenerates
 * it (EVN Bible, control bits). Whether a stellar is destroyed is world
 * state, not data, and is not in PlanetData.
 *
 * PARSED ONLY: nothing in the game destroys or regenerates stellars yet.
 */
export interface PlanetDestructionData {
    /**
     * spöb Strength: "The amount of combined mass and energy damage this
     * stellar can take from planetary-type weapons before it is destroyed.
     * Set this to 0 or -1 for an invincible stellar." null when invincible
     * (any Strength <= 0). An invincible stellar can still be destroyed by
     * the Yxxx NCB operator, which is why the rest of this record is
     * populated regardless.
     */
    strength: number | null;
    /** spöb Flags2 0x0040: "Stellar starts the game destroyed". */
    startsDestroyed: boolean;
    /**
     * The sprite sheet shown while destroyed (spöb DeadType: "-1  Don't
     * display different graphic type when destroyed", "0-255  Display this
     * stellar graphic when destroyed"), resolved the same way the live
     * graphic is: spïn (1000 + DeadType) names the rlëD (falling back to the
     * spöb resource's linear approximation when there is no spïn). null for
     * DeadType -1 — keep the normal graphic — or when the graphic does not
     * resolve.
     */
    deadGraphic: string | null;
    /**
     * spöb Flags2 0x0080: "the stellar's graphic is animated after it's been
     * destroyed and static when it is not destroyed. The normal behavior is
     * the opposite of this".
     */
    animateOnlyWhenDestroyed: boolean;
    /**
     * Days a destroyed stellar stays destroyed before it regenerates by
     * itself (spöb DeadTime): 0 = "regenerates at the end of every day",
     * N > 0 = after N days, null = "never regenerates on its own" (DeadTime
     * -1; any negative is read the same way).
     */
    regenerationDays: number | null;
    /**
     * Global bööm id of the explosion shown when the stellar is destroyed
     * (spöb ExplodType 0-63 or 1000-1063 -> bööm 128-191), or null for
     * ExplodType -1 ("No explosion") or an explosion that does not resolve.
     */
    explosion: string | null;
    /**
     * Global id of the SPARKS explosion scattered around `explosion` when
     * ExplodType carries the +1000 bias ("Explosion type 0-63, plus a random
     * number of type-0 explosions around it"): explosion type 0, bööm 128,
     * resolved in the spöb's own id space exactly like
     * ShipData.finalExplosionSparks. null without the bias.
     */
    explosionSparks: string | null;
    /**
     * NCB set expression "evaluated when the stellar is destroyed" (spöb
     * OnDestroy), namespaced like PlanetDominationData.onDominate.
     */
    onDestroy: string;
    /**
     * NCB set expression "evaluated when the stellar automatically
     * regenerates" (spöb OnRegen), namespaced likewise.
     */
    onRegen: string;
}

/** spöb Flags decoded to the named booleans the game uses. */
export interface PlanetFlags {
    /** Can land/dock here (0x1). */
    canLand: boolean;
    /** Has commodity exchange (0x2). */
    hasCommodityExchange: boolean;
    /** Can outfit ship here (0x4). */
    hasOutfitter: boolean;
    /** Can buy ships here (0x8). */
    hasShipyard: boolean;
    /** Stellar is a station instead of a planet (0x10). */
    isStation: boolean;
    /** Stellar is uninhabited (0x20). */
    uninhabited: boolean;
    /** Has a bar (0x40). */
    hasBar: boolean;
    /** Can only land here once the stellar is destroyed (0x80). */
    landOnlyIfDestroyed: boolean;
    /**
     * This stellar's outfit shop "can buy any nonpermanent outfits the
     * player owns, regardless of tech level" (EVN Bible ~:2862).
     *
     * NOTE: this bit lives in the spöb **Flags2** field (0x0400), not the
     * Flags field the rest of this interface decodes — the Bible block that
     * documents it is the Flags2 block (the same one carrying hypergate
     * 0x1000 / wormhole 0x2000). It is surfaced here alongside the other
     * named booleans because it is a service property of the stellar.
     *
     * Without it, an outfitter only buys back what it would itself stock
     * (see outfitter_rules.ts sellableHere): the existence of this flag and
     * of the per-outfit 0x0800 "sell anywhere" flag is what establishes that
     * selling is tech-gated by default. Sirrusa is the canonical stock
     * example of a stellar that sets it.
     */
    buysAnyOutfit: boolean;
}

/**
 * A commodity exchange price tier, from the spöb Flags trade nibbles
 * (EVN Bible p. 59): each standard commodity trades at low (80%),
 * medium (100%), or high (125%) of its base price, or not at all.
 */
export type TradeTier = "low" | "med" | "high";

export interface PlanetData extends SpaceObjectData {
    landingPict: string;
    landingDesc: string;
    position: [number, number];

    /**
     * Transit endpoint metadata if this stellar is a hypergate or wormhole,
     * else null. A normal planet/station has no gate.
     */
    gate: GateData | null;

    /**
     * Fee deducted from the player's credits on landing (spöb Fee field,
     * Bible p. 61). Hook only: credits are not yet modeled, so nothing charges
     * this today. Hypergates in stock EV Nova charge no fee (all observed
     * gate/wormhole Fee = 0); kept so a future credits system can honor it.
     */
    landingFee: number;

    /** Global id of the owning gövt, or null for independent. */
    govt: string | null;

    /**
     * spöb MinStatus (EVN Bible, spöb section): "The point on your record in
     * the current system that you'll be denied landing clearance on this
     * stellar."
     *
     *   -32767          Ignored (player can always land)
     *   -1 to -32766    You can be this evil before they shun you
     *    0 to 32766     They have to like you this much before they let you land
     *    32767          Player can never land.
     *   "(Note that this field is ignored if the stellar is uninhabited)"
     *
     * A signed int16 at spöb offset 22 (novaparse/docs/tmpl). Interpreted by
     * nova_plugin/stellar_clearance.ts, which is the only thing that should
     * read it.
     */
    minStatus: number;
    /** Named spöb flag booleans (landability, services, habitation). */
    flags: PlanetFlags;
    /** Tech level, controlling default outfit/ship availability. */
    techLevel: number;
    /**
     * The stellar's special tech levels (spöb SpecialTech x8, EVN Bible
     * p. 63). Unlike techLevel, these do NOT admit everything at or below
     * them: only items and ships whose own TechLevel EXACTLY equals one of
     * these appear here. That is how a low-tech world stocks a few exotic
     * items, and how an item given an absurd TechLevel (the Bible's example
     * is 15000) can be made to appear at exactly one stellar.
     *
     * Unset slots are dropped at parse time (see planet_parse.ts), so this
     * holds only meaningful values and is usually empty. Order is not
     * significant; membership is all the rules test.
     */
    specialTech: number[];
    /**
     * The commodity exchange price tier for each standard commodity
     * (index 0 food, 1 industrial, 2 medical, 3 luxury, 4 metal,
     * 5 equipment), or null when the stellar won't trade in it. From
     * the upper spöb Flags nibbles (EVN Bible p. 59).
     */
    tradeTiers: (TradeTier | null)[];
    /**
     * The bar description (dësc id 10000 + spöb local id - 128), shown
     * in the spaceport bar dialog. Empty when the stellar has none.
     */
    barDesc: string;
    /**
     * The global PICT id of the bar description's Graphic (the bar
     * dësc's Graphic field), shown as an embedded image in the bar's
     * "Bar + pict" frame (PICT 8504). null when the bar has no picture.
     */
    barPict: string | null;

    /**
     * The spöb AnimDelay: frames between animation frames in 30ths of a
     * second (EVN Bible p. 61). 0 means unset. The display turns this into a
     * frame rate (30 / animationDelay) for continuously-animated stellars
     * such as wormholes.
     */
    animationDelay: number;

    /**
     * Global id of the ambient snd resource played on a loop while the
     * player is on this stellar's main spaceport screen (the spöb CustSndID
     * field, EVN Bible p. 60: "Which ambient sound to play"; -1 = none).
     * null when the stellar has no ambient sound. Note: for hypergates and
     * wormholes CustSndID is repurposed as the emergence angle (see `gate`),
     * so those never carry a spaceport ambient sound.
     */
    spaceportSound: string | null;

    /*
     * Stellar defence, weapons, domination, destruction, deadliness and
     * gravity (tracker issue #306). These are PARSED ONLY: nothing in the
     * game reads them yet — the gameplay is feature request #353 —
     * so they change neither the simulation nor the wire (PlanetData
     * crosses the wire as an id reference). Each sentinel is decoded here,
     * so consumers never see the raw -1 / 0 / 1000+ encodings.
     */

    /**
     * The defence fleet the stellar launches (spöb DefenseDude + DefCount,
     * wave encoding decoded), or null when it has none: DefenseDude -1, a
     * DefCount that decodes to no ships, or a düde that does not resolve.
     * 289 of the 411 stock stellars have one.
     */
    defense: PlanetDefenseFleet | null;

    /** The stellar's weapon, or null for an unarmed stellar. */
    weapon: PlanetWeaponData | null;

    /** Tribute, the always-dominated flag and the domination NCB hooks. */
    domination: PlanetDominationData;

    /** Strength, destroyed graphic, regeneration and the destruction NCB hooks. */
    destruction: PlanetDestructionData;

    /**
     * spöb Flags2 0x0100: "Stellar is deadly - all ships that touch it are
     * destroyed immediately". (Ships with shïp Flags 0x0020 ignore deadly
     * stellars and the oütf ModType 42 "resist deadly stellars" protects
     * against them — neither is parsed into this record.)
     */
    deadly: boolean;

    /**
     * spöb Gravity: "0 for none, positive for stellars that pull, negative
     * for stellars that push" (the Bible warns it "severely confuses the
     * AI"). Raw strength in the engine's own unspecified unit; every stock
     * stellar has 0.
     */
    gravity: number;
}

export function getDefaultPlanetFlags(): PlanetFlags {
    return {
        canLand: true,
        hasCommodityExchange: false,
        hasOutfitter: true,
        hasShipyard: true,
        isStation: false,
        uninhabited: false,
        hasBar: true,
        landOnlyIfDestroyed: false,
        buysAnyOutfit: false,
    };
}

export function getDefaultPlanetData(): PlanetData {
    return {
        ...getDefaultSpaceObjectData(),
        vulnerableTo: <Array<DamageType>>["planetBuster"],
        landingPict: "default",
        landingDesc: "default",
        position: [0, 0],
        gate: null,
        landingFee: 0,
        govt: null,
        // The Bible's "Ignored (player can always land)" sentinel: a default
        // PlanetData imposes no legal-status requirement, so every existing
        // fixture stays landable.
        minStatus: -32767,
        flags: getDefaultPlanetFlags(),
        techLevel: 0,
        specialTech: [],
        tradeTiers: [null, null, null, null, null, null],
        barDesc: "",
        barPict: null,
        animationDelay: 0,
        spaceportSound: null,
        defense: null,
        weapon: null,
        domination: {
            tribute: 0,
            alwaysDominated: false,
            onDominate: "",
            onRelease: "",
        },
        destruction: {
            strength: null,
            startsDestroyed: false,
            deadGraphic: null,
            animateOnlyWhenDestroyed: false,
            regenerationDays: 0,
            explosion: null,
            explosionSparks: null,
            onDestroy: "",
            onRegen: "",
        },
        deadly: false,
        gravity: 0,
    };
}
