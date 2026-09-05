import { getDefaultTurretBlindSpots, TurretBlindSpots } from "./blind_spots.js";
import { getDefaultSpaceObjectData, getDefaultSpaceObjectPhysics, SpaceObjectData, SpaceObjectPhysics } from "./space_object_data.js";


export interface ShipPhysics extends SpaceObjectPhysics {
    freeMass: number;
    freeCargo: number;
    maxGuns: number;
    maxTurrets: number;
    // Hyperspace jump behavior (EVN Bible, shïp Flags/Flags2 and oütf
    // ModTypes 23/37):
    // Multiplier on the "normal" hyperspace jump speed (shïp Flags
    // 0x0001 = 75%, 0x0002 = 125%, 0x0004 = 150%).
    jumpSpeedMult: number;
    // shïp Flags2 0x0020, or the "fast jumping" outfit (ModType 37).
    canJumpWithoutSlowing: boolean;
    // Change to the no-jump zone's radius in pixels ("hyperspace dist
    // mod" outfits, ModType 23; the standard radius is 1000).
    jumpDistanceMod: number;
    // Fuel burned per second while the afterburner is engaged.
    // 0 means the ship has no afterburner.
    afterburner: number;
    // Number of EXTRA consecutive hyperspace jumps performed from a single
    // jump initiation ("multi-jump" outfits, ModType 32; summed across
    // outfits). 0 means a normal single jump.
    multiJump: number;
    // Whether the ship slowly regenerates hyperspace fuel on its own
    // ("auto-refueller" outfits, ModType 19). Granted if any outfit has it.
    autoRefuel: boolean;
    // Signed change to the number of days each hyperspace jump takes
    // ("hyperspace speed mod" outfits, ModType 22; summed across
    // outfits). Negative speeds jumps up; the effective per-jump time is
    // still floored at 1 day (see calendar.ts daysPerJump). 0 = no mod.
    hyperspaceSpeedMod: number;
}

export function getDefaultShipPhysics(): ShipPhysics {
    return {
        ...getDefaultSpaceObjectPhysics(),
        freeMass: 0,
        freeCargo: 0,
        maxGuns: 0,
        maxTurrets: 0,
        jumpSpeedMult: 1,
        canJumpWithoutSlowing: false,
        jumpDistanceMod: 0,
        afterburner: 0,
        multiJump: 0,
        autoRefuel: false,
        hyperspaceSpeedMod: 0,
    }
}

export interface ShipData extends SpaceObjectData {
    physics: ShipPhysics;
    /**
     * The shipyard browse picture: the thumbnail in the ship grid and the
     * preview beside it. A plain render of the ship.
     */
    pict: string;
    /**
     * The larger painted scene the shipyard's "More Info" dialog shows —
     * the ship staged against a station, planet or nebula, which is
     * different art from `pict` rather than a scaled copy of it (see the
     * shipyard/*_info.png reference screenshots).
     *
     * Null when the ship has no dedicated info picture, in which case the
     * dialog falls back to `pict`. Plug-ins routinely omit it.
     */
    infoPict: string | null;
    desc: string;
    outfits: { [index: string]: number }
    initialExplosion: string | null;
    finalExplosion: string | null;
    /**
     * shïp Explode2 + 1000 (EVN Bible ~:2445): "You can also add 1000 to
     * the value of this field in the same manner as the ExplodeType field
     * in the wëap resource" — and wëap ExplodType 1000-1063 (~:3159) is
     * "Explosion type 0-63, plus a random number of type-0 explosions
     * around it".
     *
     * So this is the id of the SPARKS explosion scattered around the final
     * fireball: explosion type 0, which is bööm 128 ("FAE Small" in the
     * stock data), resolved in the ship's own id space rather than assumed
     * to be `nova:128`. Null when Explode2 < 1000 (no sparks). 179 of the
     * 288 stock ships set the +1000 bit.
     *
     * This is the field the display's nested-explosion path wants;
     * `largeExplosion` below is a DIFFERENT mechanic that used to be
     * miswired into it.
     */
    finalExplosionSparks: string | null;
    /**
     * shïp DeathDelay >= 60 frames (EVN Bible ~:2427): "The ship
     * disintegrates for this number of frames and then disappears in a
     * huge explosion. The exact size of the resulting fireball is
     * proportional to the ship's mass," as against 0-59 which "disappears
     * in a single fireball".
     *
     * So this flag means ONE fireball, drawn big — nothing to do with the
     * `finalExplosionSparks` scatter above. 86 of the 288 stock ships
     * qualify (masses 90 to 10000 tons). See finalExplosionScale in
     * nova_plugin/ship_explosion.ts for the size, which is derived from
     * the same mass-proportional radius as the blast that damages.
     */
    largeExplosion: boolean;
    deathDelay: number;
    displayWeight: number;
    /**
     * 64-bit flag set contributed while flying this ship, as a hex
     * string (JSON-safe; decode with BigInt). Combined with outfit
     * Contribute sets and checked against Require sets.
     */
    contribute: string;
    /** 64-bit flag set required to buy this ship. Hex string. */
    require: string;
    /**
     * Control-bit test expression the player must PASS to purchase this
     * ship (shïp Availability, EVN Bible ~:2588): "The player will be
     * able to purchase this type of ship when the expression evaluates to
     * true. Leave blank if unused." Depending on Flags3 0x0100, a false
     * Availability either shows the ship greyed or hides it entirely.
     */
    availability: string;
    /**
     * shïp AppearOn (EVN Bible ~:2594): "Control bit test expression.
     * Ships of this type will not show up in dude resources if this
     * expression evaluates to false." A gate on NPC (düde) spawning, NOT
     * on the shipyard — that is `availability`. Namespaced per plug-in
     * like every other NCB string. 135 stock ships carry one: mostly
     * negated story bits (every Aur Cruiser variant, nova:247-255, is
     * `!b333`), plus positive-bit story variants (the Polaris cloaking
     * hulls nova:257-273, the `b8888` pirate variants nova:398-404).
     * Read by npc_spawn_plugin's buildNpcSpawnTable, which filters each
     * düde's ship list on it under the same shared-world constraint on
     * per-player bits that flët AppearOn has (see its module comment):
     * evaluated at genesis against an empty bit set.
     */
    appearOn: string;
    /**
     * shïp OnPurchase (EVN Bible ~:2598): "Control bit set expression",
     * run when the player BUYS a ship of this class at a shipyard. 171
     * stock hulls set `b8888` (which crön nova:222 and the second-hand
     * hulls' AppearOn test). Run by spaceport/shipyard.ts's buyShip after
     * the traded-in class's `onRetire`, each under its own writer prefix.
     */
    onPurchase: string;
    /**
     * shïp OnCapture (EVN Bible ~:2636): "evaluated when you capture a
     * ship of this type." Plumbed for the boarding lane; not run here.
     */
    onCapture: string;
    /**
     * shïp OnRetire (EVN Bible ~:2639): "evaluated when you sell a ship of
     * this type and/or replace it with a captured ship." A shipyard trade
     * sells the current hull, so buyShip runs the OLD class's onRetire
     * before the new class's onPurchase — stock nova:377 "Pegasus;rogue"
     * sets b4322 on purchase and clears it here.
     */
    onRetire: string;
    /**
     * shïp Flags 0x0008 (EVN Bible ~:2517): "Player ship takes advantage of
     * FuelRegen property". FuelRegen itself (~:2554) says "for the player
     * to be able to use this field, the 0x0008 flag must also be set (this
     * allows you to give enemy ships built-in fuel scoops but still make
     * the player have to buy his own)". So physics.energyRecharge is the
     * class's INHERENT regeneration for an AI pilot; a PLAYER-flown hull
     * only regenerates (or, for a negative FuelRegen, drains) on it when
     * this is true. Outfit scoops (ModType 18) are unaffected. See
     * nova_plugin/ship_plugin.ts's ShipFuelProvider. All 21 stock
     * regenerating classes set it; 13 plug-in classes do not.
     */
    playerFuelRegen: boolean;
    /**
     * shïp Holds < 0 (EVN Bible ~:2346): "Put a negative sign in front of
     * this value if you want to prevent the player from purchasing mass
     * expansions (e.g. a value of -100 would mean 100 tons of hold space
     * but no mass expansions allowed)". physics.freeCargo carries the
     * ABSOLUTE value; this carries the sign's meaning, read by
     * outfitter_rules' canBuyOutfit to refuse any outfit that takes cargo
     * space away (a negative ModType 2, e.g. stock oütf 190 Mass
     * Expansion). No stock ship sets it; six plug-in hulls do.
     */
    noMassExpansions: boolean;
    /**
     * The percent chance this ship is available for purchase on a given
     * day (shïp BuyRandom, EVN Bible ~:2630): "0 means this ship will
     * never be made available for purchase." The daily roll is a
     * deterministic hash of (game day, stellar, ship) so every client and
     * every reload of the same day agrees.
     */
    buyRandom: number;
    /**
     * shïp Flags3 0x0100 (~:2655): "Don't show ship in shipyard if
     * Availability is false." When clear, a false Availability still SHOWS
     * the ship greyed (purchase refused).
     */
    hideIfAvailabilityFalse: boolean;
    /**
     * shïp Flags3 0x0200 (~:2656): "Don't show ship in shipyard if
     * Require bits not met." When clear, unmet Require still SHOWS the
     * ship greyed.
     */
    hideIfRequireUnmet: boolean;
    /**
     * shïp Flags3 0x4000 (~:2657): when this ship is available for
     * sale, it suppresses every higher-numbered ship sharing its exact
     * DispWeight.
     */
    excludeEqualDisplayWeight: boolean;
    /**
     * The ship's combat strength rating (shïp Strength), used for the
     * govt MaxOdds fight-or-flee calculation. The Bible scales a ship's
     * effective strength between 30% and 100% of this by its current
     * shield level.
     */
    strength: number;
    /**
     * The ship class's inherent AI type (shïp InherentAI, 1 = wimpy
     * trader, 2 = brave trader, 3 = warship, 4 = interceptor), used
     * when a düde with AIType 0 spawns this ship.
     */
    inherentAI: number;
    /**
     * The ship class's inherent government as a global gövt id (shïp
     * InherentGovt), or null when it has none. Used by the mïsn
     * AvailShipType ship-govt ranges (2128+/3128+) to gate offers by
     * the government of the ship the player is flying.
     */
    inherentGovt: string | null;
    /**
     * The government whose ïntf status bar this ship class shows while the
     * PLAYER flies it, as a global gövt id (null when the class has none).
     *
     * This is a wider reading of the same InherentGovt field than
     * `inherentGovt` above: the Bible's status-bar rule fires on "a ship
     * whose inherent attributes govt OR inherent combat govt is equal to
     * this govt type" (gövt Interface), so all three encodings count —
     * 128-383 (both associations), 1128-1383 (attributes only) and
     * 2128-2383 (combat only), the last two carrying the govt id offset by
     * 1000/2000 (EVN Bible, shïp InherentGovt). `inherentGovt` deliberately
     * keeps its narrower 128-383 reading, because it feeds the mission
     * AvailShipType gate rather than the display.
     */
    interfaceGovt: string | null;
    /** Purchase price in credits (shïp Cost). */
    price: number;
    /**
     * Tech level: the ship appears at stellars whose TechLevel is at
     * least this (or whose SpecialTech matches it exactly).
     */
    techLevel: number;
    /**
     * Percent chance per day that this ship is available for hire as
     * an escort in the bar (shïp HireRandom); 0 = never for hire.
     */
    hireRandom: number;
    /**
     * Which escort-menu category the ship belongs to (shïp
     * EscortType): -1 auto, 0 fighter, 1 medium, 2 warship,
     * 3 freighter.
     */
    escortType: number;
    /**
     * The ship class an ESCORT of this type upgrades to (shïp UpgradeTo),
     * as a global ship id, or null when this class cannot be upgraded.
     *
     * EVN Bible ~:2661: "If an escort ship of this type can be upgraded,
     * this field holds the ID of the ship type that it can be upgraded to.
     * Set to 0 or -1 if this ship class can't be upgraded." BOTH sentinels
     * are normalized to null here, so consumers test one thing.
     */
    escortUpgradeShip: string | null;
    /**
     * What upgrading an escort of this class to {@link escortUpgradeShip}
     * costs (shïp EscUpgrdCost). Meaningless when escortUpgradeShip is null.
     */
    escortUpgradeCost: number;
    /**
     * Raw shïp EscSellValue: "The amount of cash the player gets for selling
     * off a captured escort of this type" (EVN Bible ~:2668). A value <= 0
     * means "default to 10% of the ship's original cost" — that rule lives in
     * spaceport/escort_fees.ts's escortSellValue, which is what callers should
     * use rather than reading this directly.
     */
    escortSellValue: number;
    /**
     * The short name shown in shipyard-style grids (shïp ShortName).
     * "\n" splits it into subtitle lines, e.g. "Viper\n- Fighter -".
     * Empty when unset; fall back to the resource name.
     */
    shortName: string;
    /**
     * The full class name (shïp Long Name): "The long string to display
     * when the player purchases a ship of this type or starts a new
     * pilot" (EVN Bible ~:2691). It is also what the shipyard's More Info
     * dialog prints on its name strip -- "Sigma Shipyards Alpha class
     * Shuttle", "Old Earth IDA Frigate" in the shipyard/*_info.png
     * reference screenshots -- rather than the resource name. Empty when
     * unset; fall back to the resource name.
     */
    longName: string;
    /**
     * The ship class's subtitle (shïp SubTitle), shown on the second line
     * of the status-bar target display beneath the ship/përs name, e.g.
     * "Heavy Fighter Class" under "Pirate Viper". Empty when unset.
     */
    subtitle: string;
    /**
     * The escort pilot description shown in the hire-escort dialog
     * (dësc id 14000 + shïp local id - 128); empty when the ship has
     * none.
     */
    pilotDesc: string;
    /**
     * The fraction of max armor at or below which the ship becomes
     * disabled. EVN Bible shïp Flags 0x0010: "Ship is disabled at 10%
     * armor instead of 33%" — so this is 0.10 when the flag is set and
     * 0.33 otherwise.
     */
    disableArmorFraction: number;
    /** Hull length in metres (shïp Length), shown in the ship info dialog. */
    length: number;
    /** Standard crew complement (shïp Crew), shown in the ship info dialog. */
    crew: number;
    /**
     * Free outfit space with the ship's stock outfits already installed
     * (the raw shïp FreeSpace), which is what the shipyard's ship info
     * dialog shows as "Space". physics.freeMass, by contrast, adds the
     * stock outfits' mass back in to give the empty-hull capacity.
     */
    freeSpace: number;
    /**
     * shïp Flags 0x1000/0x2000/0x4000 (EVN Bible ~:2527): "Ship's
     * turrets have a blind spot to the front/sides/rear". Applies to
     * every turret this ship mounts, on top of each weapon's own
     * wëap-level set (WeaponData.turretBlindSpots). 69 of the 411
     * ships across the stock data and the installed plug-ins set at
     * least one bit — the Fed Destroyer/Carrier and Aurora Cruiser
     * families are all rear-blind.
     */
    turretBlindSpots: TurretBlindSpots;
};

export function getDefaultShipData(): ShipData {
    return {
        ...getDefaultSpaceObjectData(),
        physics: getDefaultShipPhysics(),
        pict: "default",
        infoPict: null,
        desc: "default",
        outfits: {},
        initialExplosion: null,
        finalExplosion: null,
        finalExplosionSparks: null,
        largeExplosion: false,
        deathDelay: 1,
        displayWeight: 1,
        contribute: "0x0",
        require: "0x0",
        availability: "",
        appearOn: "",
        onPurchase: "",
        onCapture: "",
        onRetire: "",
        playerFuelRegen: false,
        noMassExpansions: false,
        buyRandom: 0,
        hideIfAvailabilityFalse: false,
        hideIfRequireUnmet: false,
        excludeEqualDisplayWeight: false,
        strength: 0,
        inherentAI: 1,
        inherentGovt: null,
        interfaceGovt: null,
        price: 0,
        techLevel: 0,
        hireRandom: 0,
        escortType: -1,
        escortUpgradeShip: null,
        escortUpgradeCost: 0,
        escortSellValue: 0,
        shortName: "",
        longName: "",
        subtitle: "",
        pilotDesc: "",
        disableArmorFraction: 0.33,
        length: 0,
        crew: 0,
        freeSpace: 0,
        turretBlindSpots: getDefaultTurretBlindSpots(),
    }
}
