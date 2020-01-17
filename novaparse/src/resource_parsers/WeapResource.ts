import { Resource } from "resourceforkjs";
import { NovaResources } from "./ResourceHolderBase";
import { BaseResource } from "./NovaResourceBase";
import { Particles, ExitType, FireGroup, GuidanceType } from "../../../novadatainterface/WeaponData";

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

class WeapResource extends BaseResource {
    reload: number;
    duration: number;
    armorDamage: number;
    shieldDamage: number;
    guidanceN: number;
    guidance: GuidanceType;
    speed: number;
    ammoType: number;
    graphic: number | null;
    accuracy: number;
    firesAtFixedAngle: boolean;
    sound: number | null;
    impact: number;
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
    cicnSmoke: number[] | null;
    decay: number;
    trailParticles: Particles;
    beamLength: number;
    beamWidth: number;
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
    hitParticles: Particles;
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
    turnRate: number;
    maxAmmo: number;
    ionizeColor: number;
    count: number;

    constructor(resource: Resource, idSpace: NovaResources) {
        super(resource, idSpace);
        var d = this.data;

        this.reload = d.getInt16(0);
        this.duration = d.getInt16(2);
        this.armorDamage = d.getInt16(4);
        this.shieldDamage = d.getInt16(6);

        var fireGroup: FireGroup | null = null;

        this.guidanceN = d.getInt16(8);
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
                throw new Error("Unknown guidance type " + this.guidanceN);
        }


        var maybeNull = function(n: number, a: number): number | null {
            if (n == -1)
                return null;
            return n + a;
        };

        this.speed = d.getInt16(10);

        this.ammoType = d.getInt16(12);


        this.graphic = maybeNull(d.getInt16(14), 3000);

        this.accuracy = d.getInt16(16);
        this.firesAtFixedAngle = this.accuracy < 0;
        this.accuracy = Math.abs(this.accuracy);

        this.sound = maybeNull(d.getInt16(18), 200);

        this.impact = d.getInt16(20);

        this.explosion = maybeNull(d.getInt16(22), 128);
        if (this.explosion !== null) {
            this.explosion128sparks = this.explosion >= 1128;
            if (this.explosion >= 1128) {
                this.explosion -= 1000;
            }
        }
        else {
            this.explosion128sparks = false;
        }

        this.proxRadius = d.getInt16(24);

        this.blastRadius = d.getInt16(26);

        this.flags = d.getUint16(28);
        //flags
        this.spinShots = (this.flags & 0x1) > 0;

        // May have already been set by GuidanceType
        if (!fireGroup) {
            if (this.flags & 0x2) {
                fireGroup = "secondary";
            } else {
                fireGroup = "primary";
            }
        }
        this.fireGroup = fireGroup;

        this.startSpinningOnFirstFrame = (this.flags & 0x4) > 0;
        this.dontFireAtFastShips = (this.flags & 0x8) > 0;
        this.loopSound = (this.flags & 0x10) > 0;
        this.passThroughShields = (this.flags & 0x20) > 0;
        this.fireSimultaneously = (this.flags & 0x40) > 0;
        this.vulnerableToPD = (this.flags & 0x80) == 0;//NB: inverted
        this.hitsFiringShip = (this.flags & 0x100) == 0;//NB: inverted
        this.smallCicnSmoke = (this.flags & 0x200) > 0;
        this.bigCicnSmoke = (this.flags & 0x400) > 0;
        this.persistentCicnSmoke = (this.flags & 0x800) > 0;

        this.turretBlindSpots = {
            front: (this.flags & 0x1000) > 0,
            side: (this.flags & 0x2000) > 0,
            back: (this.flags & 0x4000) > 0
        };

        this.flak = (this.flags & 0x8000) > 0;
        //endflags

        this.guidedFlags = d.getInt16(30);
        //seeker
        this.passOverAsteroids = (this.guidedFlags & 0x1) > 0;
        this.decoyedByAsteroids = (this.guidedFlags & 0x2) > 0;
        this.confusedByInterference = (this.guidedFlags & 0x8) > 0;
        this.turnsAwayIfJammed = (this.guidedFlags & 0x10) > 0;
        this.cantFireWhileIonized = (this.guidedFlags & 0x20) > 0;
        this.loseLockIfNotAhead = (this.guidedFlags & 0x4000) > 0;
        this.attackParentIfJammed = (this.guidedFlags & 0x8000) > 0;
        //endseeker


        var doCicnSmoke = maybeNull(d.getInt16(32) * 8, 1000);
        if (doCicnSmoke !== null) {
            var tmp: Array<number> = [];
            for (var i = doCicnSmoke; i < doCicnSmoke + 8; i++) {
                tmp.push(i);
            }
            this.cicnSmoke = tmp;
        }
        else {
            this.cicnSmoke = null;
        }


        this.decay = d.getInt16(34);

        var getColor32 = function(n: number) {
            /*	c =+ (255-d.getInt8(n))<<24;//a inverted 'cause nova has it as 0
            c =+ d.getInt8(n+1)<<16;//r
            c =+ d.getInt8(n+2)<<8;//g
            c =+ d.getInt8(n+3);//b*/
            //times 2 bc newa - a = max - 2a when newa = max - a
            var aCorrection = 0xff000000 - d.getInt8(n) * 0x02000000;
            return d.getUint32(n) + aCorrection; // fix alpha
        }

        this.trailParticles = {
            count: d.getInt16(36),
            velocity: d.getInt16(38),
            lifeMin: d.getInt16(40),
            lifeMax: d.getInt16(42),
            color: getColor32(44)
        };

        this.beamLength = d.getInt16(48);
        this.beamWidth = d.getInt16(50);
        this.spinRate = d.getInt16(50);
        this.coronaFalloff = d.getInt16(52);
        this.beamColor = getColor32(54);
        this.coronaColor = getColor32(58);
        this.lightningDensity = d.getInt16(110);
        this.lightningAmplitude = d.getInt16(112);


        this.proxSafety = d.getInt16(70);

        this.flags2 = d.getInt16(72);
        //flags2
        this.spinBeforeProxSafety = (this.flags2 & 0x1) == 0;// NB: inverted
        this.spinStopOnLastFrame = (this.flags2 & 0x2) > 0;
        this.proxIgnoreAsteroids = (this.flags2 & 0x4) > 0;
        this.proxHitAll = (this.flags2 & 0x8) > 0 || (this.guidance != "guided");

        this.submunition = null;
        let subID = d.getInt16(64);
        let subCount = d.getInt16(62);
        if (subID >= 128 && subCount > 0) {
            this.submunition = {
                count: subCount,
                id: subID,
                theta: d.getInt16(66),
                limit: d.getInt16(68),
                fireAtNearest: (this.flags2 & 0x10) > 0,
                subIfExpire: (this.flags2 & 0x20) == 0// NB: inverted
            };
        }




        this.showAmmo = (this.flags2 & 0x40) == 0;// NB: inverted
        this.fireOnlyIfKeyCarried = (this.flags2 & 0x80) > 0;
        this.npcCantUse = (this.flags2 & 0x100) > 0;
        this.useFiringAnimation = (this.flags2 & 0x200) > 0;
        this.planetType = (this.flags2 & 0x400) > 0;
        this.hideIfNoAmmo = (this.flags2 & 0x800) > 0;
        this.disableOnly = (this.flags2 & 0x1000) > 0;
        this.beamUnderShip = (this.flags2 & 0x2000) > 0;
        this.fireWhileCloaked = (this.flags2 & 0x4000) > 0;
        this.asteroidMiner = (this.flags2 & 0x8000) > 0;
        //endflags2

        this.ionization = d.getInt16(74);

        var hitParticleLife = d.getInt16(78);
        this.hitParticles = {
            count: d.getInt16(76),
            lifeMin: hitParticleLife,
            lifeMax: hitParticleLife,
            velocity: d.getInt16(80),
            color: getColor32(82),

        };

        this.recoil = d.getInt16(86);
        if (this.recoil == -1)
            this.recoil = 0;

        this.exitTypeN = d.getInt16(88);

        switch (this.exitTypeN) {
            case -1:
                this.exitType = "center";
                break;
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
            default:
                this.exitType = "center"
                break;
        }


        this.burstCount = d.getInt16(90);

        this.burstReload = d.getInt16(92);

        this.jam = {
            infrared: d.getInt16(94),
            radar: d.getInt16(96),
            ethericWake: d.getInt16(98),
            gravametric: d.getInt16(100)
        };
        this.jamVuln = [this.jam.infrared, this.jam.radar, this.jam.ethericWake, this.jam.gravametric];


        this.flags3 = d.getInt16(102);
        //flags3
        this.oneAmmoPerBurst = (this.flags3 & 0x1) > 0;
        this.translucent = (this.flags3 & 0x2) > 0;
        this.cantFireUntilShotExpires = (this.flags3 & 0x4) > 0;
        this.firesFromClosestToTarget = (this.flags3 & 0x10) > 0;
        this.exclusive = (this.flags3 & 0x20) > 0;
        //endflags3

        this.durability = d.getInt16(104);

        this.turnRate = d.getInt16(106);

        this.maxAmmo = d.getInt16(108);

        //lightning density and amplitude take 110 and 112

        this.ionizeColor = getColor32(114);

        this.count = d.getInt16(118);

    }
}

export { WeapResource }

