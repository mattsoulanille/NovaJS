import { BaseData, getDefaultBaseData } from "./BaseData";
import { getDefaultShipData } from "./ShipData";
import { getDefaultSpaceObjectData, SpaceObjectData } from "./SpaceObjectData";

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


export type AmmoType = "unlimited" | ["energy", number] | ["outfit", string];

export interface SubmunitionType {
    id: string;
    count: number;
    theta: number; // Conical angle they fly out at
    limit: number; // Recursion limit for recursive submunitions
    fireAtNearest: boolean; // Set target to nearest ship
    subIfExpire: boolean; // Sub if the shot expires before the prox fuse is triggered
}


export interface WeaponDamage {
    [index: string]: number;
    shield: number;
    armor: number;
    ionization: number;
    ionizationColor: number;
    passThroughShield: number; // Factor of damage that passes through shield. 1 means all
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
    useFiringAnimation: boolean;
    fireSimultaneously: boolean;
    destroyShipWhenFiring: boolean;
    sound?: string;
    loopSound: boolean;
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
        useFiringAnimation: true,
        fireSimultaneously: false,
        destroyShipWhenFiring: false,
        loopSound: false,
    };
}

export interface NotBayWeaponData extends BaseWeaponData {
    damage: WeaponDamage;
    submunitions: Array<SubmunitionType>,
    oneAmmoPerBurst: boolean;
    shotDuration: number;
    primaryExplosion: string | null;
    secondaryExplosion: string | null;
    knockback: number;
    blastRadius: number;
    blastHurtsFiringShip: boolean,
    detonateWhenShotExpires: boolean,
    damageType: DamageType; // Should this be a set?
}

export function getDefaultNotBayWeaponData(): NotBayWeaponData {
    return {
        ...getDefaultBaseWeaponData(),
        damage: {
            shield: 1,
            armor: 1,
            ionization: 0,
            ionizationColor: 0xffffff,
            passThroughShield: 0,
        },
        submunitions: [],
        oneAmmoPerBurst: false,
        shotDuration: 7,
        primaryExplosion: null,
        secondaryExplosion: null,
        knockback: 0,
        blastRadius: 0,
        blastHurtsFiringShip: false,
        detonateWhenShotExpires: false,
        damageType: "normal",
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

export interface ProjectileWeaponData extends SpaceObjectData, NotBayWeaponData {
    type: "ProjectileWeaponData",
    guidance: ProjectileGuidanceType,
    proxRadius: number, // Proximity to something before it explodes
    proxSafety: number // Number of seconds after firing that the weapon won't explode
    trailParticles: ParticleConfig,
    hitParticles: ParticleConfig
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
        trailParticles: getDefaultParticles(),
        hitParticles: getDefaultParticles()
    };
}

export interface BeamWeaponData extends NotBayWeaponData {
    type: "BeamWeaponData",
    guidance: BeamGuidanceType,
    beamAnimation: BeamAnimation,
}

export function getDefaultBeamWeaponData(): BeamWeaponData {
    return {
        ...getDefaultNotBayWeaponData(),
        type: "BeamWeaponData",
        guidance: "beam",
        beamAnimation: getDefaultBeamAnimation()
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
