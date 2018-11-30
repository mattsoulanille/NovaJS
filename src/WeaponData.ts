import { BaseData, DefaultBaseData } from "./BaseData";
import { SpaceObjectProperties, SpaceObjectData, DefaultSpaceObjectData } from "./SpaceObjectData";
import { DefaultShipData } from "./ShipData";

type DamageType = "normal" | "pointDefense";


type ProjectileGuidanceType =
    "unguided" |
    "turret" |
    "guided" |
    "rocket" |
    "freefallBomb" |
    "frontQuadrant" |
    "rearQuadrant" |
    "pointDefense";

// I would use an enum but you can't union those
const ProjectileGuidanceSet: Set<string> = new Set(<Array<ProjectileGuidanceType>>[
    "unguided",
    "turret",
    "guided",
    "rocket",
    "freefallBomb",
    "frontQuadrant",
    "rearQuadrant",
    "pointDefense"
]);

type BeamGuidanceType =
    "beam" |
    "beamTurret" |
    "pointDefenseBeam";

const BeamGuidanceSet: Set<any> = new Set(<Array<BeamGuidanceType>>[
    "beam",
    "beamTurret",
    "pointDefenseBeam"
]);




type BayGuidanceType = "bay";

const BayGuidanceSet: Set<any> = new Set(<Array<BayGuidanceType>>["bay"]);

type GuidanceType =
    ProjectileGuidanceType |
    BeamGuidanceType |
    BayGuidanceType;


type ExitType =
    "center" |
    "gun" |
    "turret" |
    "guided" |
    "beam";


type BeamAnimation = {
    length: number,
    width: number,
    beamColor: number,
    coronaColor: number,
    coronaFalloff: number // Pixels of corona on each side
}

const DefaultBeamAnimation: BeamAnimation = {
    length: 100,
    width: 6,
    beamColor: 0xffffff,
    coronaColor: 0x8888ff,
    coronaFalloff: 4
}


type AmmoType = "unlimited" | ["energy", number] | ["outfit", string];

type SubmunitionType = {
    id: string,
    count: number,
    theta: number, // Conical angle they fly out at
    limit: number, // Recursion limit for recursive submunitions
    fireAtNearest: boolean, // Set target to nearest ship
    subIfExpire: boolean // Sub if the shot expires before the prox fuse is triggered
}


type WeaponDamageList = {
    [index: string]: number,
    shield: number,
    armor: number,
    ionization: number,
    passThroughShield: number // Factor of damage that passes through shield. 1 means all
}

type FireGroup = "primary" | "secondary" | "pointDefense";

interface BaseWeaponData extends BaseData {
    fireRate: number,
    shotSpeed: number,
    fireGroup: FireGroup,
    exitType: ExitType,
    accuracy: number,
    burstCount: number,
    burstReload: number,
    ammoType: AmmoType,
    useFiringAnimation: boolean,
    fireSimultaneously: boolean,
    destroyShipWhenFiring: boolean
}

const DefaultBaseWeaponData: BaseWeaponData = {
    ...DefaultBaseData,
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
}


interface NotBayWeaponData extends BaseWeaponData {
    oneAmmoPerBurst: boolean,
    ionizationColor: number,
    shotDuration: number,
    primaryExplosion: string | null,
    secondaryExplosion: string | null,
    knockback: number,
    damageType: DamageType // Should this be a set?
}

const DefaultNotBayWeaponData: NotBayWeaponData = {
    ...DefaultBaseWeaponData,
    oneAmmoPerBurst: false,
    ionizationColor: 0xffffff,
    shotDuration: 7,
    primaryExplosion: null,
    secondaryExplosion: null,
    knockback: 0,
    damageType: "normal",
}


type Particles = {
    count: number,
    velocity: number,
    lifeMin: number,
    lifeMax: number,
    color: number
}
const DefaultParticles: Particles = {
    count: 0,
    velocity: 0,
    lifeMin: 0,
    lifeMax: 0,
    color: 0
}

interface ProjectileWeaponData extends SpaceObjectData, NotBayWeaponData {
    type: "ProjectileWeaponData",
    guidance: ProjectileGuidanceType,
    turnRate: number,
    submunitions: Array<SubmunitionType>,
    proxRadius: number, // Proximity to something before it explodes
    proxSafety: number // Number of seconds after firing that the weapon won't explode
    trailParticles: Particles,
    hitParticles: Particles
}

// This extends SpaceObjectData since projectiles use sprites
const DefaultProjectileWeaponData: ProjectileWeaponData = {
    ...DefaultNotBayWeaponData,
    ...DefaultSpaceObjectData,
    type: "ProjectileWeaponData",
    guidance: "unguided",
    turnRate: 3,
    submunitions: [],
    proxRadius: 1,
    proxSafety: 0,
    trailParticles: DefaultParticles,
    hitParticles: DefaultParticles
}

interface BeamWeaponData extends NotBayWeaponData {
    type: "BeamWeaponData",
    beamAnimation: BeamAnimation,
}

const DefaultBeamWeaponData: BeamWeaponData = {
    ...DefaultNotBayWeaponData,
    type: "BeamWeaponData",
    beamAnimation: DefaultBeamAnimation
}

interface BayWeaponData extends BaseWeaponData {
    type: "BayWeaponData",
    shipID: string
}

const DefaultBayWeaponData: BayWeaponData = {
    ...DefaultBaseWeaponData,
    type: "BayWeaponData",
    shipID: DefaultShipData.id
}




type WeaponData = ProjectileWeaponData | BeamWeaponData | BayWeaponData;

export { WeaponData, DefaultBeamWeaponData, DefaultProjectileWeaponData, DefaultBayWeaponData, BeamWeaponData, ProjectileWeaponData, BayWeaponData, GuidanceType, BeamAnimation, Particles, DefaultParticles, DamageType, SubmunitionType, BaseWeaponData, DefaultBaseWeaponData, ExitType, FireGroup, NotBayWeaponData, DefaultNotBayWeaponData, ProjectileGuidanceType, ProjectileGuidanceSet, BeamGuidanceType, BeamGuidanceSet, BayGuidanceType, BayGuidanceSet }