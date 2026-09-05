import { Resource } from "resource_fork";
import { NovaResources } from "./resource_holder_base.js";
import { BaseResource } from "./nova_resource_base.js";
import { Reader } from "./reader.js";
import { ParticleConfig, ExitType, FireGroup, GuidanceType } from "novadatainterface/weapon_data";

type BlindSpots = {
    front: boolean,
    side: boolean,
    back: boolean
}

type Submunition = {
    count: number,
    id: number,
    theta: number,
    limit: number,
    fireAtNearest: boolean,
    subIfExpire: boolean
}

type Jam = {
    infrared: number,
    radar: number,
    ethericWake: number,
    gravametric: number
}

/**
 * A weapon.
 *
 * Field layout follows ResForge's wëap template. The record is 134 bytes;
 * everything Nova's own data uses fits within that. The template is a keyed
 * union (KEYB on Weapon Type at offset 8): beam, projectile, homing and
 * carried-ship weapons reinterpret the bytes from offset 10 onwards. This
 * parser reads the superset of those layouts by absolute meaning, matching the
 * Beam/Projectile keyed variants, which together cover every field. Documented
 * in the EVN Bible pp. 65-70.
 *
 * The final 16 bytes (offsets 118-133) are Unused in the template; some
 * community plug-ins carry longer records, but no field lives past 118.
 */
class WeapResource extends BaseResource {
    /** Frames to reload; 30 = one shot/sec. */
    reload: number;
    /**
     * Frames a shot lives before petering out (EVN Bible "Count"); for beams,
     * frames the beam stays onscreen.
     */
    duration: number;
    armorDamage: number;
    shieldDamage: number;
    guidanceN: number;
    guidance: GuidanceType;
    /** Shot speed; 100 = 1 pixel per frame. */
    speed: number;
    ammoType: number;
    /** spïn id (3000+), or null if none. */
    graphic: number | null;
    /** Inaccuracy in degrees (always >= 0; negatives mean fixed-angle). */
    accuracy: number;
    firesAtFixedAngle: boolean;
    /** snd id (200+), or null if silent. */
    sound: number | null;
    impact: number;
    /** bööm id (128+), or null; sparks (raw 1000+) are folded out. */
    explosion: number | null;
    explosion128sparks: boolean;
    proxRadius: number;
    blastRadius: number;
    flags: number;
    spinShots: boolean;
    fireGroup: FireGroup;
    startSpinningOnFirstFrame: boolean;
    dontFireAtFastShips: boolean;
    loopSound: boolean;
    passThroughShields: boolean;
    fireSimultaneously: boolean;
    vulnerableToPD: boolean;
    hitsFiringShip: boolean;
    smallCicnSmoke: boolean;
    bigCicnSmoke: boolean;
    persistentCicnSmoke: boolean;
    turretBlindSpots: BlindSpots;
    flak: boolean;
    guidedFlags: number;
    passOverAsteroids: boolean;
    decoyedByAsteroids: boolean;
    confusedByInterference: boolean;
    turnsAwayIfJammed: boolean;
    cantFireWhileIonized: boolean;
    loseLockIfNotAhead: boolean;
    attackParentIfJammed: boolean;
    /** The eight cicn ids of the smoke set, or null if none. */
    cicnSmoke: number[] | null;
    decay: number;
    trailParticles: ParticleConfig;
    beamLength: number;
    beamWidth: number;
    /**
     * For spinning sprite weapons, frames between animation frames. Shares the
     * offset with beamWidth (the template's dual-purpose field).
     */
    spinRate: number;
    coronaFalloff: number;
    beamColor: number;
    coronaColor: number;
    lightningDensity: number;
    lightningAmplitude: number;
    proxSafety: number;
    flags2: number;
    spinBeforeProxSafety: boolean;
    spinStopOnLastFrame: boolean;
    proxIgnoreAsteroids: boolean;
    proxHitAll: boolean;
    submunition: Submunition | null;
    showAmmo: boolean;
    fireOnlyIfKeyCarried: boolean;
    npcCantUse: boolean;
    useFiringAnimation: boolean;
    planetType: boolean;
    hideIfNoAmmo: boolean;
    disableOnly: boolean;
    beamUnderShip: boolean;
    fireWhileCloaked: boolean;
    asteroidMiner: boolean;
    ionization: number;
    hitParticles: ParticleConfig;
    recoil: number;
    exitTypeN: number;
    exitType: ExitType;
    burstCount: number;
    burstReload: number;
    jam: Jam;
    jamVuln: Array<number>;
    flags3: number;
    oneAmmoPerBurst: boolean;
    translucent: boolean;
    cantFireUntilShotExpires: boolean;
    firesFromClosestToTarget: boolean;
    exclusive: boolean;
    durability: number;
    /** Guided-weapon turn rate (guidedTurn); ignored for other types. */
    turnRate: number;
    maxAmmo: number;
    ionizeColor: number;

    constructor(resource: Resource, idSpace: NovaResources) {
        super(resource, idSpace);
        const r = new Reader(this.data);

        // Nova stores colours as 0xAARRGGBB but with the alpha byte inverted
        // (0 = opaque). This undoes that so the top byte reads as normal alpha.
        const color32 = (raw: number): number => {
            const invertedAlpha = (raw >>> 24) & 0xff;
            // newAlpha = 0xff - invertedAlpha; delta = (newAlpha - invertedAlpha)
            // = 0xff - 2*invertedAlpha, applied to the top byte.
            const aCorrection = 0xff000000 - invertedAlpha * 0x02000000;
            return raw + aCorrection;
        };

        const maybeNull = (n: number, add: number): number | null =>
            n === -1 ? null : n + add;

        this.reload = r.int16();          // 0
        this.duration = r.int16();        // 2
        this.armorDamage = r.int16();     // 4
        this.shieldDamage = r.int16();    // 6

        // Guidance / weapon type (offset 8). Point-defense variants also force
        // the fire group.
        let fireGroup: FireGroup | null = null;
        this.guidanceN = r.int16();
        switch (this.guidanceN) {
            case -1:
                this.guidance = 'unguided';
                break;
            case 0:
                this.guidance = 'beam';
                break;
            case 1:
                this.guidance = 'guided';
                break;
            case 3:
                this.guidance = 'beamTurret';
                break;
            case 4:
                this.guidance = 'turret';
                break;
            case 5:
                // Freefall bombs are actually different from rockets.
                // They launch at 80% of the ship's velocity, according to
                // the nova bible.
                this.guidance = 'freefallBomb';
                break;
            case 6:
                this.guidance = 'rocket';
                break;
            case 7:
                this.guidance = 'frontQuadrant';
                break;
            case 8:
                this.guidance = 'rearQuadrant';
                break;
            case 9:
                this.guidance = 'pointDefense';
                fireGroup = "pointDefense";
                break;
            case 10:
                this.guidance = 'pointDefenseBeam';
                fireGroup = "pointDefense";
                break;
            case 99:
                this.guidance = 'bay';
                break;
            default:
                // Some community plug-ins use guidance values the EVN Bible
                // leaves undefined (e.g. 2). Don't let one weapon prevent the
                // whole plug-in from loading.
                console.warn(`wëap ${this.id} "${this.name}" has unknown `
                    + `guidance type ${this.guidanceN}; treating as unguided`);
                this.guidance = 'unguided';
        }

        this.speed = r.int16();           // 10
        this.ammoType = r.int16();        // 12
        this.graphic = maybeNull(r.int16(), 3000); // 14

        this.accuracy = r.int16();        // 16
        this.firesAtFixedAngle = this.accuracy < 0;
        this.accuracy = Math.abs(this.accuracy);

        this.sound = maybeNull(r.int16(), 200); // 18
        this.impact = r.int16();          // 20

        // Explosion (offset 22). Raw 1000-1063 means "explosion + sparks":
        // maybeNull adds 128, so raw sparks land at 1128+, which we detect and
        // fold back down to the base bööm id.
        this.explosion = maybeNull(r.int16(), 128);
        if (this.explosion !== null) {
            this.explosion128sparks = this.explosion >= 1128;
            if (this.explosion >= 1128) {
                this.explosion -= 1000;
            }
        } else {
            this.explosion128sparks = false;
        }

        this.proxRadius = r.int16();      // 24
        this.blastRadius = r.int16();     // 26

        this.flags = r.uint16();          // 28
        this.spinShots = (this.flags & 0x1) > 0;
        // fireGroup may already be set by a point-defense guidance type.
        if (!fireGroup) {
            fireGroup = (this.flags & 0x2) ? "secondary" : "primary";
        }
        this.fireGroup = fireGroup;
        this.startSpinningOnFirstFrame = (this.flags & 0x4) > 0;
        this.dontFireAtFastShips = (this.flags & 0x8) > 0;
        this.loopSound = (this.flags & 0x10) > 0;
        this.passThroughShields = (this.flags & 0x20) > 0;
        this.fireSimultaneously = (this.flags & 0x40) > 0;
        this.vulnerableToPD = (this.flags & 0x80) == 0; // NB: inverted
        this.hitsFiringShip = (this.flags & 0x100) == 0; // NB: inverted
        this.smallCicnSmoke = (this.flags & 0x200) > 0;
        this.bigCicnSmoke = (this.flags & 0x400) > 0;
        this.persistentCicnSmoke = (this.flags & 0x800) > 0;
        this.turretBlindSpots = {
            front: (this.flags & 0x1000) > 0,
            side: (this.flags & 0x2000) > 0,
            back: (this.flags & 0x4000) > 0
        };
        this.flak = (this.flags & 0x8000) > 0;

        this.guidedFlags = r.int16();     // 30
        this.passOverAsteroids = (this.guidedFlags & 0x1) > 0;
        this.decoyedByAsteroids = (this.guidedFlags & 0x2) > 0;
        this.confusedByInterference = (this.guidedFlags & 0x8) > 0;
        this.turnsAwayIfJammed = (this.guidedFlags & 0x10) > 0;
        this.cantFireWhileIonized = (this.guidedFlags & 0x20) > 0;
        this.loseLockIfNotAhead = (this.guidedFlags & 0x4000) > 0;
        this.attackParentIfJammed = (this.guidedFlags & 0x8000) > 0;

        // Smoke set (offset 32): a cicn index; each set is 8 consecutive cicns
        // starting at 1000. -1 means none.
        // Null-check the raw value before scaling: raw -1 means "no smoke",
        // and multiplying first (-1 * 8 = -8) would slip past the check.
        const smokeSet = maybeNull(r.int16(), 0);
        const smokeBase = smokeSet === null ? null : smokeSet * 8 + 1000;
        if (smokeBase !== null) {
            this.cicnSmoke = [];
            for (let i = smokeBase; i < smokeBase + 8; i++) {
                this.cicnSmoke.push(i);
            }
        } else {
            this.cicnSmoke = null;
        }

        this.decay = r.int16();           // 34

        // Trail particles (offsets 36-47).
        this.trailParticles = {
            count: r.int16(),             // 36
            velocity: r.int16(),          // 38
            lifeMin: r.int16(),           // 40
            lifeMax: r.int16(),           // 42
            color: color32(r.uint32()) % 0xff000000, // 44
        };

        this.beamLength = r.int16();      // 48
        // Offset 50 is Beam Width for beams and Animation Delay (frame time)
        // for spinning sprite weapons; both read the same two bytes.
        this.beamWidth = this.spinRate = r.int16(); // 50
        this.coronaFalloff = r.int16();   // 52
        this.beamColor = color32(r.uint32());  // 54
        this.coronaColor = color32(r.uint32()); // 58

        // Submunition (offsets 62-71).
        const subCount = r.int16();       // 62
        const subID = r.int16();          // 64
        const subTheta = r.int16();       // 66
        const subLimit = r.int16();       // 68
        this.proxSafety = r.int16();      // 70

        this.flags2 = r.int16();          // 72
        this.spinBeforeProxSafety = (this.flags2 & 0x1) == 0; // NB: inverted
        this.spinStopOnLastFrame = (this.flags2 & 0x2) > 0;
        this.proxIgnoreAsteroids = (this.flags2 & 0x4) > 0;
        this.proxHitAll = (this.flags2 & 0x8) > 0 || (this.guidance != "guided");

        this.submunition = null;
        if (subID >= 128 && subCount > 0) {
            this.submunition = {
                count: subCount,
                id: subID,
                theta: subTheta,
                limit: subLimit,
                fireAtNearest: (this.flags2 & 0x10) > 0,
                subIfExpire: (this.flags2 & 0x20) == 0 // NB: inverted
            };
        }

        this.showAmmo = (this.flags2 & 0x40) == 0; // NB: inverted
        this.fireOnlyIfKeyCarried = (this.flags2 & 0x80) > 0;
        this.npcCantUse = (this.flags2 & 0x100) > 0;
        this.useFiringAnimation = (this.flags2 & 0x200) > 0;
        this.planetType = (this.flags2 & 0x400) > 0;
        this.hideIfNoAmmo = (this.flags2 & 0x800) > 0;
        this.disableOnly = (this.flags2 & 0x1000) > 0;
        this.beamUnderShip = (this.flags2 & 0x2000) > 0;
        this.fireWhileCloaked = (this.flags2 & 0x4000) > 0;
        this.asteroidMiner = (this.flags2 & 0x8000) > 0;

        this.ionization = r.int16();      // 74

        // Hit particles (offsets 76-85). A single "duration" fills both min
        // and max life.
        const hitPartCount = r.int16();   // 76
        const hitPartLife = r.int16();    // 78
        const hitPartVel = r.int16();     // 80
        const hitPartColor = color32(r.uint32()) % 0xff000000; // 82
        this.hitParticles = {
            count: hitPartCount,
            lifeMin: hitPartLife,
            lifeMax: hitPartLife,
            velocity: hitPartVel,
            color: hitPartColor,
        };

        this.recoil = r.int16();          // 86
        if (this.recoil == -1) {
            this.recoil = 0;
        }

        this.exitTypeN = r.int16();       // 88
        switch (this.exitTypeN) {
            case 0:
                this.exitType = "gun";
                break;
            case 1:
                this.exitType = "turret";
                break;
            case 2:
                this.exitType = "guided";
                break;
            case 3:
                this.exitType = "beam";
                break;
            case -1:
            default:
                this.exitType = "center";
                break;
        }

        this.burstCount = r.int16();      // 90
        this.burstReload = r.int16();     // 92

        this.jam = {
            infrared: r.int16(),          // 94
            radar: r.int16(),             // 96
            ethericWake: r.int16(),       // 98
            gravametric: r.int16()        // 100
        };
        this.jamVuln = [this.jam.infrared, this.jam.radar,
                        this.jam.ethericWake, this.jam.gravametric];

        this.flags3 = r.int16();          // 102
        this.oneAmmoPerBurst = (this.flags3 & 0x1) > 0;
        this.translucent = (this.flags3 & 0x2) > 0;
        this.cantFireUntilShotExpires = (this.flags3 & 0x4) > 0;
        this.firesFromClosestToTarget = (this.flags3 & 0x10) > 0;
        this.exclusive = (this.flags3 & 0x20) > 0;

        // Offsets 104-107 are a 4-byte "Durability" field in the template,
        // stored as two int16s: durability then guidedTurn (turnRate).
        this.durability = r.int16();      // 104
        this.turnRate = r.int16();        // 106

        this.maxAmmo = r.int16();         // 108
        this.lightningDensity = r.int16();   // 110
        this.lightningAmplitude = r.int16(); // 112
        this.ionizeColor = color32(r.uint32()); // 114

        // Offsets 118-133 are Unused in the template.

        // The template is a KEYED UNION on Weapon Type (docs/tmpl/
        // tmpl_offsets.txt, wëap): the beam and carried-ship variants
        // reinterpret the record, and the byte ranges below are filler
        // (Fxxx) there — whatever the editor last left in them. Read as
        // projectile fields they are garbage: in the installed data 36
        // stock beams carry a non-zero prox/blast radius (Polaron Cannon
        // prox=3, Solar Lance prox=3, ...), 6 beams a trail particle count
        // of -1, and 4 plug-in bays (Planet Rico Swarmer Bay, Star Wars Mod
        // Tie Fighter / X Wing, Intelligent EMP Torpedo Combat Drone) an
        // exit type of gun/turret from the filler word at 88, which
        // launched their fighters from a gun port instead of the ship's
        // centre. Those ranges take the value an all-zero field parses to.
        const isBeam = this.guidance === 'beam' || this.guidance === 'beamTurret'
            || this.guidance === 'pointDefenseBeam';
        const isBay = this.guidance === 'bay';
        const noParticles = (): ParticleConfig =>
            ({ count: 0, velocity: 0, lifeMin: 0, lifeMax: 0, color: 0 });
        if (isBeam || isBay) {
            this.proxRadius = 0;          // 24-27: beam FLNG Radius / bay F008 Impact
            this.blastRadius = 0;
            this.trailParticles = noParticles(); // 36-47: F00C (beam), F028 (bay)
            this.submunition = null;      // 62-71: F00A (beam), F028 (bay)
            this.proxSafety = 0;
        }
        if (isBay) {
            // 20-27 F008 Impact; 32-71 F028 Smoke Set; 74-85 F00C Ionization
            // Charge; 88 FWRD Exit Type; 110-117 F008 Lightning.
            this.impact = 0;
            this.explosion = null;
            this.explosion128sparks = false;
            this.cicnSmoke = null;
            this.decay = 0;
            this.beamLength = 0;
            this.beamWidth = this.spinRate = 0;
            this.coronaFalloff = 0;
            this.beamColor = color32(0);
            this.coronaColor = color32(0);
            this.ionization = 0;
            this.hitParticles = noParticles();
            this.exitTypeN = -1;
            this.exitType = "center";
            this.lightningDensity = 0;
            this.lightningAmplitude = 0;
            this.ionizeColor = color32(0);
        }
        // The beam variant also marks 10 (Shot Speed), 14 (Graphic) and 32
        // (Smoke Set) as filler words; stock beams do hold junk there
        // (Polaron Cannon graphic=-8, Chiron Beam speed=-1). They are left
        // as read: BeamWeaponParse consumes none of them, and the beam
        // entry overrides the shotSpeed-based turret lead (beam_plugin),
        // so nothing downstream reads them for a beam either.
    }
}

export { WeapResource }
