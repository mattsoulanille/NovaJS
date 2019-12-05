import { WeapResource } from "../resource_parsers/WeapResource";
import { BaseParse } from "./BaseParse";
import { BaseData } from "novadatainterface/BaseData";
import { WeaponData, ProjectileWeaponData, BeamWeaponData, BaseWeaponData, NotBayWeaponData, DamageType, SubmunitionType, ProjectileGuidanceSet, GuidanceType, BeamGuidanceSet, BayGuidanceSet, ProjectileGuidanceType, BayWeaponData, BeamGuidanceType } from "novadatainterface/WeaponData";
import { FPS, TurnRateConversionFactor } from "./Constants";
import { SpaceObjectPhysics } from "novadatainterface/SpaceObjectData";
import { Animation, DefaultExitPoints, DefaultAnimation } from "novadatainterface/Animation";
import { DefaultShipData } from "novadatainterface/ShipData";



async function BaseWeaponParse(weap: WeapResource, _notFoundFunction: (m: string) => void, base: BaseData): Promise<BaseWeaponData> {

    // TODO: Implement ammo

    return {
        ...base,
        accuracy: weap.accuracy,
        ammoType: "unlimited",
        burstCount: weap.burstCount,
        burstReload: weap.burstReload,
        destroyShipWhenFiring: weap.ammoType === -999,
        exitType: weap.exitType,
        fireGroup: weap.fireGroup,
        fireRate: FPS / weap.reload,
        fireSimultaneously: weap.fireSimultaneously,
        shotSpeed: weap.speed,
        useFiringAnimation: weap.useFiringAnimation
    }
}


async function NotBayWeaponParse(weap: WeapResource, notFoundFunction: (m: string) => void, baseWeapon: BaseWeaponData): Promise<NotBayWeaponData> {


    let primaryExplosion = null;
    if (weap.explosion !== null) {
        let primaryExplosionResource = weap.idSpace.bööm[weap.explosion];
        if (primaryExplosionResource) {
            primaryExplosion = primaryExplosionResource.globalID;
        }
        else {
            notFoundFunction("Missing primary explosion " + weap.explosion + " for wëap id " + baseWeapon.id);
        }
    }

    let secondaryExplosion = null;
    if (weap.explosion128sparks) {
        let secondaryExplosionResource = weap.idSpace.bööm[128];
        if (secondaryExplosionResource) {
            secondaryExplosion = secondaryExplosionResource.globalID;
        }
        else {
            notFoundFunction("Missing secondary explosion 128 for wëap id " + baseWeapon.id);
        }
    }

    let damageType: DamageType;
    if (weap.fireGroup == "pointDefense") {
        damageType = "pointDefense";
    }
    else {
        damageType = "normal";
    }

    return {
        ...baseWeapon,
        oneAmmoPerBurst: weap.oneAmmoPerBurst,
        ionizationColor: weap.ionizeColor,
        shotDuration: weap.duration,
        primaryExplosion,
        secondaryExplosion,
        knockback: weap.impact,
        damageType,
    }
}


async function ProjectileWeaponParse(weap: WeapResource, notFoundFunction: (m: string) => void, baseWeapon: BaseWeaponData): Promise<ProjectileWeaponData> {
    var notBayBase = await NotBayWeaponParse(weap, notFoundFunction, baseWeapon);


    // Parse Submunition if it exists
    var submunitions: Array<SubmunitionType> = [];
    if (weap.submunition) {
        var subResource = weap.idSpace.wëap[weap.submunition.id];
        if (subResource) {
            submunitions.push({
                count: weap.submunition.count,
                fireAtNearest: weap.submunition.fireAtNearest,
                id: subResource.globalID,
                limit: weap.submunition.limit,
                subIfExpire: weap.submunition.subIfExpire,
                theta: weap.submunition.theta
            });
        }
        else {
            notFoundFunction("Missing submunition id " + weap.submunition.id + " for wëap " + notBayBase.id);
        }
    }


    if (!weap.graphic) {
        throw new Error("ProjectileWeapon " + baseWeapon.id + " had no graphic listed");
    }


    // Parse the weapon's animation (the projectile it fires)
    var animation: Animation;
    let spinResource = weap.idSpace.spïn[weap.graphic];
    if (spinResource) {
        let rledResource = spinResource.idSpace.rlëD[spinResource.spriteID];
        if (rledResource) {

            // There should be an animationFromSpin function
            // because spins will eventually allow picts to be used
            // instead of rleds
            animation = {
                exitPoints: DefaultExitPoints,
                id: baseWeapon.id,
                name: baseWeapon.name,
                prefix: baseWeapon.prefix,
                images: {
                    baseImage: {
                        id: rledResource.globalID,
                        imagePurposes: {
                            normal: { start: 0, length: rledResource.numberOfFrames }
                        }
                    }
                }
            }
        }
        else {
            notFoundFunction("Missing rlëD id " + spinResource.spriteID + " for spïn " + weap.graphic);
            animation = DefaultAnimation
        }
    }
    else {
        notFoundFunction("Missing spïn id " + weap.graphic + " for wëap " + notBayBase.id);
        animation = DefaultAnimation
    }


    // Verify that guidance is correct for a projectile-type weapon
    var guidance: ProjectileGuidanceType;
    if (!ProjectileGuidanceSet.has(weap.guidance)) {
        throw new Error("Wrong guidance type " + weap.guidance + " for ProjectileWeapon");
    }
    else {
        guidance = <ProjectileGuidanceType>weap.guidance;
    }

    // Get if the weapon is vulnerable to Point Defense
    var vulnerableTo: Array<DamageType>;
    if (weap.vulnerableToPD && guidance === "guided") {
        vulnerableTo = ["pointDefense"];
    }
    else {
        vulnerableTo = [];
    }


    return {
        ...notBayBase,
        type: "ProjectileWeaponData",
        guidance,
        submunitions,
        proxRadius: weap.proxRadius,
        proxSafety: weap.proxSafety / FPS,
        trailParticles: weap.trailParticles,
        hitParticles: weap.hitParticles,
        animation,
        vulnerableTo,
        physics: {
            acceleration: 0,
            armorRecharge: 0,
            deionize: 0,
            energy: 0,
            energyRecharge: 0,
            ionization: 0,
            mass: 0,
            shieldRecharge: 0,
            speed: weap.speed,
            turnRate: weap.turnRate * TurnRateConversionFactor,
            shield: 0,
            armor: weap.durability
        }
    }
}


async function BeamWeaponParse(weap: WeapResource, notFoundFunction: (m: string) => void, baseWeapon: BaseWeaponData): Promise<BeamWeaponData> {

    var notBayBase = await NotBayWeaponParse(weap, notFoundFunction, baseWeapon);

    var guidance: BeamGuidanceType;
    if (!BeamGuidanceSet.has(weap.guidance)) {
        throw new Error("Wrong guidance type " + weap.guidance + " for BeamWeapon");
    }
    else {
        guidance = <BeamGuidanceType>weap.guidance;
    }

    return {
        ...notBayBase,
        type: "BeamWeaponData",
        guidance,
        beamAnimation: {
            beamColor: weap.beamColor,
            coronaColor: weap.coronaColor,
            coronaFalloff: weap.coronaFalloff,
            length: weap.beamLength,
            width: weap.beamWidth
        }
    }
}

async function BayWeaponParse(weap: WeapResource, notFoundFunction: (m: string) => void, baseWeapon: BaseWeaponData): Promise<BayWeaponData> {

    var ship = weap.idSpace.shïp[weap.ammoType];
    var shipID: string;
    if (ship) {
        shipID = ship.globalID;
    }
    else {
        notFoundFunction("Missing shïp " + weap.ammoType + " for bay weapon " + baseWeapon.id);
        shipID = DefaultShipData.id;
    }

    return {
        ...baseWeapon,
        type: "BayWeaponData",
        shipID
    }
}


async function WeaponParse(weap: WeapResource, notFoundFunction: (m: string) => void): Promise<WeaponData> {
    var base: BaseData = await BaseParse(weap, notFoundFunction);

    var baseWeapon: BaseWeaponData = await BaseWeaponParse(weap, notFoundFunction, base);

    var guidanceType = weap.guidance;
    var parseFunc: (w: WeapResource, nff: (m: string) => void, baseWeapon: BaseWeaponData) => Promise<WeaponData>

    if (ProjectileGuidanceSet.has(weap.guidance)) {
        parseFunc = ProjectileWeaponParse;
    }
    else if (BeamGuidanceSet.has(weap.guidance)) {
        parseFunc = BeamWeaponParse;
    }
    else if (BayGuidanceSet.has(weap.guidance)) {
        parseFunc = BayWeaponParse;
    }
    else {
        throw new Error("Unknown guidance type " + weap.guidance + " for wëap id " + weap.globalID);
    }

    return await parseFunc(weap, notFoundFunction, baseWeapon);
}

export { WeaponParse };
