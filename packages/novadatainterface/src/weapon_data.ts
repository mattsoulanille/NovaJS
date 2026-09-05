import { BaseData, getDefaultBaseData } from "./base_data.js";
import { getDefaultTurretBlindSpots, TurretBlindSpots } from "./blind_spots.js";
import { getDefaultShipData } from "./ship_data.js";
import { getDefaultSpaceObjectData, SpaceObjectData } from "./space_object_data.js";

export type DamageType = "normal" | "pointDefense" | "planetBuster";


export type ProjectileGuidanceType =
    "unguided" |
    "turret" |
    "guided" |
    "rocket" |
    "freefallBomb" |
    "frontQuadrant" |
    "rearQuadrant" |
    "pointDefense";

// I would use an enum but you can't union those
export const ProjectileGuidanceSet: Set<string> = new Set(<Array<ProjectileGuidanceType>>[
    "unguided",
    "turret",
    "guided",
    "rocket",
    "freefallBomb",
    "frontQuadrant",
    "rearQuadrant",
    "pointDefense"
]);

export type BeamGuidanceType =
    "beam" |
    "beamTurret" |
    "pointDefenseBeam";

export const BeamGuidanceSet: Set<any> = new Set(<Array<BeamGuidanceType>>[
    "beam",
    "beamTurret",
    "pointDefenseBeam"
]);


export type BayGuidanceType = "bay";

export const BayGuidanceSet: Set<any> = new Set(<Array<BayGuidanceType>>["bay"]);

export type GuidanceType =
    ProjectileGuidanceType |
    BeamGuidanceType |
    BayGuidanceType;


export type ExitType =
    "center" |
    "gun" |
    "turret" |
    "guided" |
    "beam";


export interface BeamAnimation {
    length: number;
    width: number;
    beamColor: number;
    coronaColor: number;
    coronaFalloff: number; // Pixels of corona on each side
    lightningDensity: number;
    lightningAmplitude: number;
}

export function getDefaultBeamAnimation(): BeamAnimation {
    return {
        length: 100,
        width: 6,
        beamColor: 0xffffff,
        coronaColor: 0x8888ff,
        coronaFalloff: 4,
        lightningDensity: 0,
        lightningAmplitude: 0,
    }
}


/**
 * What a weapon consumes per shot (EVN Bible wëap AmmoType):
 * - "unlimited": no ammo tracking (AmmoType -1; also bays and
 *   destroys-ship weapons, which handle their "ammo" separately).
 * - ["energy", n]: consumes n units of fuel per shot (AmmoType -1000
 *   and below; 10 raw units = 1 unit of fuel).
 * - ["weapon", id]: draws ammo from the supply of the weapon with this
 *   global id (AmmoType 0-255). Ammo outfits declare which weapon's
 *   supply they hold via OutfitData.ammoFor.
 */
export type AmmoType = "unlimited" | ["energy", number] | ["weapon", string];

export interface SubmunitionType {
    id: string;
    count: number;
    theta: number; // Conical angle they fly out at
    limit: number; // Recursion limit for recursive submunitions
    fireAtNearest: boolean; // Set target to nearest ship
    subIfExpire: boolean; // Sub if the shot expires before the prox fuse is triggered
}


/**
 * The colour an ionized ship shows when the weapon that ionized it left
 * its wëap IonizeColor field at zero.
 *
 * EVN Bible, wëap IonizeColor: "The color that a ship hit by this weapon
 * will appear after being sufficiently ionized (encoded the same as an
 * HTML color value). A value of 0 here will be interpreted as a default
 * bluish color. Using fairly bright colors here is probably the best, as
 * low-intensity colors tend to look odd when used as the ionization
 * color."
 *
 * The Bible names the default only as "a default bluish color" and gives
 * no value, and no reference capture of an ionized ship exists to measure
 * one from. So we adopt the stock Ion Cannon's OWN IonizeColor
 * (wëap nova:142 and nova:201, 0x34C2FF) — Nova's own designers' idea of
 * ion blue, and bright, as the Bible advises. Two stock weapons ride on
 * this default: Polaron Massive Torp. (nova:199) and Solar Lance
 * (nova:164) both ship IonizeColor 0.
 *
 * Resolving the sentinel matters: without it a zero field reaches the
 * display as pure black, and a multiply tint of 0x000000 blacks the hull
 * out entirely rather than colouring it.
 */
export const DEFAULT_IONIZE_COLOR = 0x34C2FF;

/**
 * Applies the IonizeColor zero sentinel (see DEFAULT_IONIZE_COLOR).
 *
 * The test is on the RGB nibbles alone: novaparse's weap_resource hands
 * colours back with the alpha byte un-inverted, so a raw field of zero
 * arrives as 0xFF000000, not 0.
 */
export function resolveIonizeColor(raw: number): number {
    return (raw & 0xFFFFFF) === 0 ? DEFAULT_IONIZE_COLOR : raw;
}

export interface WeaponDamage {
    shield: number;
    armor: number;
    /**
     * wëap Ionization: "The amount of ionization energy to add to the
     * ship that gets hit by this weapon" (EVN Bible). Only a POSITIVE
     * amount is an ionizing hit, and only an ionizing hit repaints the
     * victim's ionization colour.
     */
    ionization: number;
    /**
     * wëap IonizeColor, with the zero sentinel already resolved to
     * DEFAULT_IONIZE_COLOR — always a real, displayable colour. Recorded
     * on the victim by the sim's DamageSystem when this weapon lands an
     * ionizing hit, and read back by the display as the hull tint.
     */
    ionizationColor: number;
    passThroughShield: number; // Factor of damage that passes through shield. 1 means all
    knockback: number;
    /**
     * wëap Flags2 0x1000 "Weapon can disable but not destroy": armor
     * damage from this weapon clamps just above zero (see
     * DISABLE_ONLY_ARMOR_FLOOR in the sim), so an ion barrage can leave
     * a ship deeply disabled but never destroys it. Optional so
     * hand-built damage payloads (tests, blasts) default to lethal.
     */
    disableOnly?: boolean;
}

export type FireGroup = "primary" | "secondary" | "pointDefense";

export interface BaseWeaponData extends BaseData {
    reload: number;
    shotSpeed: number;
    fireGroup: FireGroup;
    exitType: ExitType;
    accuracy: number;
    burstCount: number;
    burstReload: number;
    ammoType: AmmoType;
    /**
     * For ammo-using weapons, the maximum ammo per instance of this
     * weapon. 0 = the ammo quantity is constrained by the ammo
     * outfit's Max field instead (so the ammo is freely buyable
     * without a launcher).
     */
    maxAmmo: number;
    useFiringAnimation: boolean;
    fireSimultaneously: boolean;
    destroyShipWhenFiring: boolean;
    /**
     * wëap Flags3 0x0010: "Weapon fires from whatever weapon exit point
     * is closest to the target". Otherwise the ship cycles through the
     * exit points of this weapon's `exitType` round-robin. Only two stock
     * weapons set it — nova:142 Ion Cannon and nova:201 "Ion
     * Cannon;non-weapon glow", both `exitType: "beam"` beam turrets.
     * Simulation state: the chosen exit point is where the shot/beam
     * spawns, so the selection must be deterministic on every peer.
     */
    firesFromClosestToTarget: boolean;
    /**
     * wëap Flags 0x1000/0x2000/0x4000: "Turreted weapon has a blind
     * spot to the front/sides/rear". Only meaningful for turreted
     * guidance types (see isTurretedGuidance); the stock data does set
     * these bits on a handful of non-turrets (nova:128 Light Blaster,
     * nova:146 Pulse Laser), where the original game ignores them.
     *
     * OR'ed with the firing ship's own ShipData.turretBlindSpots.
     */
    turretBlindSpots: TurretBlindSpots;
    sound?: string;
    loopSound: boolean;
    /**
     * wëap Inaccuracy below zero: "Fires to the side by this angle
     * (absolute value in degrees)" (EVN Bible ~:3139). `accuracy` above
     * holds the absolute value; this marks that it is a FIXED side angle
     * rather than a random spread. ResForge's wëap template labels the
     * negative range "Fixed (unguided only)" with the note "Needs
     * off-axis exits", which is how the side is chosen: the shot leans
     * toward the side of the ship its exit point is on (see
     * fixedAngleOffset in the sim). Only 'unguided' shots honour it, per
     * that template note; every other guidance keeps the random spread.
     * No stock combat weapon sets it; plug-ins do (More Blasters CHEAT
     * "Side Radar Missile", -90).
     */
    firesAtFixedAngle: boolean;
    /**
     * wëap Flags2 0x4000 "Weapon can be fired while cloaked". Without
     * it, a shot that actually leaves a cloaked ship drops its cloak
     * (WeaponsSystem); with it the ship stays hidden — the Polaris
     * cloak-and-strike weapons (Wraithii, the Polaron torpedoes).
     */
    fireWhileCloaked: boolean;
    /** wëap Seeker 0x0020 "Can't fire if ship is ionized". */
    cantFireWhileIonized: boolean;
    /**
     * wëap Flags3 0x0004 "Firing ship can't fire another shot of this
     * type until the previous one expires or hits something".
     */
    cantFireUntilShotExpires: boolean;
    /**
     * wëap Flags3 0x0020 "Weapon is exclusive - no other weapons on the
     * ship can fire while this weapon is firing or reloading".
     */
    exclusive: boolean;
    /** wëap Flags2 0x0100 "AI ships won't use this weapon". */
    npcCantUse: boolean;
    /**
     * wëap Flags 0x0008 "For guided weapons, don't fire at fast ships
     * (ships with turn rate > 30)". An AI rule: ResForge's template
     * names the bit "AI won't fire at ships with turn rate > 30".
     */
    dontFireAtFastShips: boolean;
    /**
     * wëap Flags2 0x0400 "Weapon is a planet-type weapon, and can only
     * hit planet-type ships or destroyable stellars". Carried but NOT
     * yet honoured by the simulation: the matching shïp Flags2 0x0400
     * ("Ship is a planet-type ship, and can only be hit by planet-type
     * weapons") is not parsed onto ShipData, and a gate that knows only
     * the weapon's half would make such a shot hit nothing at all. One
     * plug-in weapon carries it (extra-outfits:344).
     */
    planetType: boolean;
}

export function getDefaultBaseWeaponData(): BaseWeaponData {
    return {
        ...getDefaultBaseData(),
        reload: 1000,
        shotSpeed: 50,
        fireGroup: "primary",
        exitType: "gun",
        accuracy: 0,
        burstCount: 0,
        burstReload: 1000,
        ammoType: "unlimited",
        maxAmmo: 0,
        useFiringAnimation: true,
        fireSimultaneously: false,
        destroyShipWhenFiring: false,
        firesFromClosestToTarget: false,
        turretBlindSpots: getDefaultTurretBlindSpots(),
        loopSound: false,
        firesAtFixedAngle: false,
        fireWhileCloaked: false,
        cantFireWhileIonized: false,
        cantFireUntilShotExpires: false,
        exclusive: false,
        npcCantUse: false,
        dontFireAtFastShips: false,
        planetType: false,
    };
}

export interface NotBayWeaponData extends BaseWeaponData {
    damage: WeaponDamage;
    submunitions: Array<SubmunitionType>,
    oneAmmoPerBurst: boolean;
    shotDuration: number;
    /** The bööm named by wëap ExplodType (EVN Bible ~:3159). */
    primaryExplosion: string | null;
    /**
     * The SPARKS of wëap ExplodType 1000-1063: "Explosion type 0-63, plus
     * a random number of type-0 explosions around it" (~:3159). Always
     * explosion type 0 — bööm 128, "FAE Small" in the stock data — looked
     * up in the weapon's own id space, and null when the +1000 bit is
     * clear. ShipData.finalExplosionSparks is the shïp Explode2 + 1000
     * half of the same rule.
     */
    secondaryExplosion: string | null;
    blastRadius: number;
    blastHurtsFiringShip: boolean,
    detonateWhenShotExpires: boolean,
    damageType: DamageType; // Should this be a set?
    /** "Asteroid miner" flag: does 10x mass damage to asteroids. */
    asteroidMiner: boolean;
}

export function getDefaultNotBayWeaponData(): NotBayWeaponData {
    return {
        ...getDefaultBaseWeaponData(),
        damage: {
            shield: 1,
            armor: 1,
            ionization: 0,
            // Inert (ionization 0 never records a colour), but a real
            // colour rather than white keeps the default honest.
            ionizationColor: DEFAULT_IONIZE_COLOR,
            passThroughShield: 0,
            knockback: 0,
            disableOnly: false,
        },
        submunitions: [],
        oneAmmoPerBurst: false,
        shotDuration: 7,
        primaryExplosion: null,
        secondaryExplosion: null,
        blastRadius: 0,
        blastHurtsFiringShip: false,
        detonateWhenShotExpires: false,
        damageType: "normal",
        asteroidMiner: false,
    }
}


export interface ParticleConfig {
    count: number;
    velocity: number;
    lifeMin: number;
    lifeMax: number;
    color: number;
}

export function getDefaultParticles(): ParticleConfig {
    return {
        count: 0,
        velocity: 0,
        lifeMin: 0,
        lifeMax: 0,
        color: 0
    };
}

/**
 * A guided weapon's vulnerability to each of the four jamming types, from the
 * wëap resource's JamVuln1-4 fields. Each value is a percentage (0-100) read
 * straight from the resource; a ship's jamming strength of the matching type is
 * compared against it to decide whether a missile loses lock. The four types
 * mirror EV Nova's jamming taxonomy (EVN Bible, oütf ModTypes 33-36 and the
 * govt InhJam1-4 fields): infrared, radar, etheric wake, gravimetric.
 *
 * Ordered [type1, type2, type3, type4]. Nova's stock data assigns semantic
 * meaning to the slots by convention (1=IR, 2=radar, ...), but the engine only
 * cares about matching indices, so we keep them as a fixed-length array indexed
 * by jamming-type number.
 */
export type JammingVulnerabilities = readonly [number, number, number, number];

export function getDefaultJammingVulnerabilities(): JammingVulnerabilities {
    return [0, 0, 0, 0];
}

/**
 * The wëap "Seeker" flags that matter for jamming/guidance behaviour, decoded
 * from the guided-weapon flags word. See EVN Bible pp. 67 (Seeker field):
 *
 * - `passOverAsteroids` (0x0001): the missile flies over asteroids instead of
 *   colliding with them.
 * - `decoyedByAsteroids` (0x0002): the missile can be distracted onto asteroids
 *   (and, in our generalization, any decoy target). See the decoy hook.
 * - `confusedByInterference` (0x0008): the missile is additionally degraded by
 *   the current system's sensor interference (radar-type jamming).
 * - `turnsAwayIfJammed` (0x0010): when the missile loses lock to jamming, it
 *   veers away from its target rather than merely flying straight.
 * - `attackParentIfJammed` (0x8000): when jammed, the missile may retarget the
 *   ship that fired it.
 */
export interface SeekerFlags {
    passOverAsteroids: boolean;
    decoyedByAsteroids: boolean;
    confusedByInterference: boolean;
    turnsAwayIfJammed: boolean;
    attackParentIfJammed: boolean;
}

export function getDefaultSeekerFlags(): SeekerFlags {
    return {
        passOverAsteroids: false,
        decoyedByAsteroids: false,
        confusedByInterference: false,
        turnsAwayIfJammed: false,
        attackParentIfJammed: false,
    };
}

export interface ProjectileWeaponData extends SpaceObjectData, NotBayWeaponData {
    type: "ProjectileWeaponData",
    guidance: ProjectileGuidanceType,
    proxRadius: number, // Proximity to something before it explodes
    proxSafety: number // Number of seconds after firing that the weapon won't explode
    /**
     * Whether this shot collides with (and its proximity fuse triggers on) ANY
     * ship rather than only its target. Decoded from wëap Flags2 0x0008
     * ("Proximity detonator is triggered by ships other than the target (for
     * guided weapons)"); forced true for non-guided weapons, which have no
     * target restriction (see weap_resource.ts).
     */
    proxHitAll: boolean,
    trailParticles: ParticleConfig,
    hitParticles: ParticleConfig,
    /**
     * Vulnerability to each of the four jamming types (0-100%). Only meaningful
     * for guided weapons; ignored otherwise (matching the Bible: "Ignored if
     * the weapon is not a guided weapon").
     */
    jamVulnerabilities: JammingVulnerabilities,
    /** Decoded Seeker flags affecting jamming/guidance behaviour. */
    seeker: SeekerFlags,
    /**
     * wëap "Decay" field (read from the wëap.Projectile2 template): the
     * number of frames of flight after which the shot loses one point
     * each of mass (armor) and energy (shield) damage. EVN Bible (wëap
     * Decay): "Remove one point of mass & energy damage every time this
     * number of frames goes by" (1 frame = 1/30 sec); "-1 or 0: Ignored".
     * The parser clamps negatives to 0, so 0 means no decay.
     *
     * Projectile-only: beams read the same byte but use it for the visual
     * "shrink before disappearing" effect (a different Bible field), so
     * this is not plumbed onto BeamWeaponData. The sim applies it from
     * the shot's elapsed flight time in ProjectileCollisionSystem and
     * ProjectileBlastSystem (see decayDamage).
     */
    decay: number,
    /**
     * wëap "Falloff" field for sprite-based (projectile) weapons: the
     * rate at which the shot's sprite fades to transparency at the end
     * of its life. Read from the SAME byte the engine uses for beam
     * `coronaFalloff` (wëap offset 52), but repurposed for sprites per
     * the EVN Bible's Falloff note (Errata: "wëap Falloff field — Added
     * note about sprite-based weapons"):
     *
     *   "For sprite-based weapons, setting this field to a value of 1
     *    will cause the sprite to fade out over the final 32 frames of
     *    its life. Higher values will fade out faster."
     *
     * So a value of N > 0 fades the shot out over the final 32/N frames
     * of its flight (1 -> 32 frames, 2 -> 16, 3 -> ~10.7); 0 or negative
     * means no fade and the sprite renders at full alpha until it
     * expires. This is DISPLAY-ONLY (see ProjectileFadeSystem); it is
     * unrelated to `decay`, which erodes damage and not opacity —
     * stock Wraithii (nova:145) has decay 10 but falloff 0 (no fade),
     * and the Fusion Pulse Cannon / all railguns have falloff 2-3.
     * The parser clamps negatives to 0, so 0 means "no fade".
     */
    falloff: number,
    /**
     * How many 1/30-second frames elapse between sprite-frame advances
     * for a shot that spins continuously in flight, or 0 if this shot
     * does not spin.
     *
     * Decoded from wëap Flags 0x0001 plus the BeamWidth field. EVN Bible
     * (wëap Flags): "Spin the weapon's graphic continuously (rate of
     * frame advance is controlled by the BeamWidth field as detailed
     * below)", and (wëap BeamWidth): "For sprite-based weapons that spin
     * continuously, this field controls the time between frames, in
     * 30ths of a second."
     *
     * So the flag is the on/off switch and BeamWidth is the period. The
     * two are collapsed into one number because they are only ever
     * meaningful together: 0 means "does not spin" and any value >= 1 is
     * the frame period of a spinning shot. The parser only ever emits a
     * positive value when Flags 0x0001 is set, and clamps that value up
     * to 1 (a BeamWidth of 0 on a spinning weapon would otherwise mean a
     * zero-length frame period), so 0 is an unambiguous "no spin"
     * sentinel — the same 0-as-sentinel convention `falloff` and `decay`
     * use above.
     *
     * This changes what the shot's sprite FRAMES mean. Normally a
     * projectile's frames are ROTATION frames: the display picks one from
     * the shot's heading (see SpriteSheetSprite.rotation). For a spinning
     * shot they are instead an ANIMATION cycle played on a timer, and the
     * graphic carries no heading information at all — the original draws
     * the tumbling sprite unrotated regardless of which way the shot
     * flies. Stock nova:143 Fusion Pulse Cannon is the canonical example:
     * spinFrameInterval 1 over a 36-frame sheet, so a full tumble every
     * 36/30 = 1.2 seconds.
     *
     * DISPLAY-ONLY (see ProjectileSpinSystem). The simulation's
     * MovementState rotation is untouched, so aim, guidance, collision
     * and state hashes are unaffected.
     *
     * Not plumbed (no stock weapon exercises them, though
     * WeapResource already decodes all three): Flags 0x0004 "always start
     * on the first frame", Flags2 0x0001 "keep the graphic on the first
     * frame until ProxSafety expires", and Flags2 0x0002 "stop the
     * graphic on the last frame".
     */
    spinFrameInterval: number,
}

// This extends SpaceObjectData since projectiles use sprites
export function getDefaultProjectileWeaponData(): ProjectileWeaponData {
    return {
        ...getDefaultNotBayWeaponData(),
        ...getDefaultSpaceObjectData(),
        type: "ProjectileWeaponData",
        guidance: "unguided",
        proxRadius: 1,
        proxSafety: 0,
        // Non-guided weapons always hit any ship (see the field doc).
        proxHitAll: true,
        trailParticles: getDefaultParticles(),
        hitParticles: getDefaultParticles(),
        jamVulnerabilities: getDefaultJammingVulnerabilities(),
        seeker: getDefaultSeekerFlags(),
        decay: 0,
        falloff: 0,
        spinFrameInterval: 0,
    };
}

export interface BeamWeaponData extends NotBayWeaponData {
    type: "BeamWeaponData",
    guidance: BeamGuidanceType,
    beamAnimation: BeamAnimation,
    /**
     * wëap Decay, for a beam: "If Decay is greater than zero, the beam
     * will 'shrink' before it disappears from the screen" (EVN Bible
     * ~:3437). Its magnitude plays no part in the Bible's rules; only
     * "greater than zero" does. Clamped to 0 for none, like the
     * projectile `decay`.
     */
    decay: number,
    /**
     * How long the beam EXISTS, in ms — the Bible's "actual time the
     * beam will exist onscreen": `Count` frames, or, when `decay` is
     * positive, `Count + 16 - CoronaFalloff` frames (~:3416-3419, 3437-
     * 3439; clamped to no less than Count, since a CoronaFalloff above
     * 16 — the Bible's own ceiling for the field — would otherwise
     * shorten the beam below its Count). `shotDuration` stays the
     * beam's `Count` alone, and is how long it DAMAGES: the shrink tail
     * is the beam disappearing, not extra firing time — the stock Pulse
     * Laser's Reload 15 = Count 15 duty cycle would otherwise double.
     * The display shrinks the beam over the tail (beam_display_plugin).
     */
    onScreenDuration: number,
}

export function getDefaultBeamWeaponData(): BeamWeaponData {
    const base = getDefaultNotBayWeaponData();
    return {
        ...base,
        type: "BeamWeaponData",
        guidance: "beam",
        beamAnimation: getDefaultBeamAnimation(),
        decay: 0,
        onScreenDuration: base.shotDuration,
    };
}

export interface BayWeaponData extends BaseWeaponData {
    type: "BayWeaponData",
    guidance: BayGuidanceType,
    shipID: string,
}

export function getDefaultBayWeaponData(): BayWeaponData {
    return {
        ...getDefaultBaseWeaponData(),
        type: "BayWeaponData",
        guidance: "bay",
        shipID: getDefaultShipData().id
    };
}

export type WeaponData = ProjectileWeaponData | BeamWeaponData | BayWeaponData;
