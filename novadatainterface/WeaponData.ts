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
}

export function getDefaultBeamAnimation(): BeamAnimation {
    return {
        length: 100,
        width: 6,
        beamColor: 0xffffff,
        coronaColor: 0x8888ff,
        coronaFalloff: 4
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


export interface WeaponDamageList {
    [index: string]: number;
    shield: number;
    armor: number;
    ionization: number;
    passThroughShield: number; // Factor of damage that passes through shield. 1 means all
}

export type FireGroup = "primary" | "secondary" | "pointDefense";

export interface BaseWeaponData extends BaseData {
    fireRate: number;
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
}

export function getDefaultBaseWeaponData(): BaseWeaponData {
    return {
        ...getDefaultBaseData(),
        fireRate: 5,
        shotSpeed: 50,
        fireGroup: "primary",
        exitType: "gun",
        accuracy: 0,
        burstCount: 1,
        burstReload: 1,
        ammoType: "unlimited",
        useFiringAnimation: true,
        fireSimultaneously: false,
        destroyShipWhenFiring: false,
    };
}

export interface NotBayWeaponData extends BaseWeaponData {
    oneAmmoPerBurst: boolean;
    ionizationColor: number;
    shotDuration: number;
    primaryExplosion: string | null;
    secondaryExplosion: string | null;
    knockback: number;
    damageType: DamageType; // Should this be a set?
}

export function getDefaultNotBayWeaponData(): NotBayWeaponData {
    return {
        ...getDefaultBaseWeaponData(),
        oneAmmoPerBurst: false,
        ionizationColor: 0xffffff,
        shotDuration: 7,
        primaryExplosion: null,
        secondaryExplosion: null,
        knockback: 0,
        damageType: "normal",
    }
}


export interface Particles {
    count: number;
    velocity: number;
    lifeMin: number;
    lifeMax: number;
    color: number;
}

export function getDefaultParticles(): Particles {
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
    submunitions: Array<SubmunitionType>,
    proxRadius: number, // Proximity to something before it explodes
    proxSafety: number // Number of seconds after firing that the weapon won't explode
    trailParticles: Particles,
    hitParticles: Particles
}

// This extends SpaceObjectData since projectiles use sprites
export function getDefaultProjectileWeaponData(): ProjectileWeaponData {
    return {
        ...getDefaultNotBayWeaponData(),
        ...getDefaultSpaceObjectData(),
        type: "ProjectileWeaponData",
        guidance: "unguided",
        submunitions: [],
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
    shipID: string
}

export function getDefaultBayWeaponData(): BayWeaponData {
    return {
        ...getDefaultBaseWeaponData(),
        type: "BayWeaponData",
        shipID: getDefaultShipData().id
    };
}

export type WeaponData = ProjectileWeaponData | BeamWeaponData | BayWeaponData;
