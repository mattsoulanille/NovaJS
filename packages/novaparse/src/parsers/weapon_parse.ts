import { Animation, getDefaultAnimation, getDefaultExitPoints } from "novadatainterface/animation";
import { BaseData } from "novadatainterface/base_data";
import { NovaDataType } from "novadatainterface/nova_data_interface";
import { getDefaultShipData } from "novadatainterface/ship_data";
import { AmmoType, BaseWeaponData, BayGuidanceSet, BayWeaponData, BeamGuidanceSet, BeamGuidanceType, BeamWeaponData, DamageType, NotBayWeaponData, ProjectileGuidanceSet, ProjectileGuidanceType, ProjectileWeaponData, resolveIonizeColor, SubmunitionType, WeaponDamage, WeaponData } from "novadatainterface/weapon_data";
import { BLEND_MODES } from "novadatainterface/blend_modes";
import { WeapResource } from "../resource_parsers/weap_resource.js";
import { BaseParse } from "./base_parse.js";
import { FPS, ShipTurnRateConversionFactor } from "./constants.js";

export const WEAP_SPEED_FACTOR = 3 / 10;

function AmmoTypeParse(weap: WeapResource, notFoundFunction: (m: string) => void, base: BaseData): AmmoType {
    // For bay weapons the AmmoType field is the carried ship's id
    // (parsed into shipID by BayWeaponParse), so it names no ammo
    // source of its own. A bay's ammo is its FIGHTERS, and every stock
    // bay ships with an ammo oütf whose `ammoFor` is the bay weapon
    // itself (e.g. the "Viper" outfit for the "Viper Bay" weapon), so
    // point the bay at its own supply and the generic ammo machinery
    // (weapon_plugin hasAmmo/consumeAmmo, outfitter ammoCapacity)
    // handles fighters like any other magazine. MaxAmmo is the number
    // of fighters one bay holds.
    if (BayGuidanceSet.has(weap.guidance)) {
        return ["weapon", base.id];
    }
    if (weap.ammoType >= 0 && weap.ammoType <= 255) {
        // Draws ammo from the supply of wëap id 128 + AmmoType (usually
        // the weapon itself). Ammo outfits reference the same weapon
        // via their `ammoFor` field.
        const ammoWeapon = weap.idSpace.wëap[weap.ammoType + 128];
        if (!ammoWeapon) {
            notFoundFunction(`Missing wëap ${weap.ammoType + 128} for`
                + ` the ammo supply of wëap ${base.id}`);
            return "unlimited";
        }
        return ["weapon", ammoWeapon.globalID];
    }
    if (weap.ammoType <= -1000) {
        // 10 raw units = 1 unit of fuel per shot, e.g. -1005 is 0.5
        // units per shot.
        return ["energy", Math.abs(weap.ammoType + 1000) / 10];
    }
    // -1 (unlimited) and -999 (destroys ship; see destroyShipWhenFiring).
    return "unlimited";
}

async function BaseWeaponParse(weap: WeapResource, notFoundFunction: (m: string) => void, base: BaseData): Promise<BaseWeaponData> {
    // Parse the weapon's sound
    let sound: string | undefined;
    if (weap.sound !== null) {
        sound = weap.idSpace["snd "][weap.sound]?.globalID;
        if (!sound) {
            notFoundFunction(`Missing snd ${weap.sound} for wëap ${base.id}`);
        }
    }

    return {
        ...base,
        accuracy: weap.accuracy,
        ammoType: AmmoTypeParse(weap, notFoundFunction, base),
        maxAmmo: Math.max(weap.maxAmmo, 0),
        burstCount: Math.max(weap.burstCount, 0),
        burstReload: weap.burstReload / FPS * 1000,
        destroyShipWhenFiring: weap.ammoType === -999,
        exitType: weap.exitType,
        fireGroup: weap.fireGroup,
        reload: weap.reload / FPS * 1000,
        fireSimultaneously: weap.fireSimultaneously,
        shotSpeed: weap.speed * WEAP_SPEED_FACTOR,
        sound,
        loopSound: weap.loopSound,
        useFiringAnimation: weap.useFiringAnimation,
        // wëap Flags3 0x0010 (the Ion Cannons): fire from the exit point
        // closest to the target instead of cycling round-robin.
        firesFromClosestToTarget: weap.firesFromClosestToTarget,
        // wëap Flags 0x1000/0x2000/0x4000. The resource parser names the
        // rear sector `back`; everything downstream calls it `rear`, to
        // match the shïp-level set and the Bible's wording.
        turretBlindSpots: {
            front: weap.turretBlindSpots.front,
            sides: weap.turretBlindSpots.side,
            rear: weap.turretBlindSpots.back,
        },
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

    const damage: WeaponDamage = {
        shield: weap.shieldDamage,
        armor: weap.armorDamage,
        ionization: weap.ionization,
        // wëap IonizeColor, zero sentinel resolved here so nothing
        // downstream has to know about it (EVN Bible: "A value of 0 here
        // will be interpreted as a default bluish color"). Two stock
        // weapons need it — Polaron Massive Torp. and Solar Lance.
        ionizationColor: resolveIonizeColor(weap.ionizeColor),
        passThroughShield: weap.passThroughShields ? 1 : 0,
        knockback: weap.impact,
        // Flags2 0x1000 "Weapon can disable but not destroy".
        disableOnly: weap.disableOnly,
    }

    // Parse Submunition if it exists
    const submunitions: Array<SubmunitionType> = [];
    if (weap.submunition) {
        var subResource = weap.idSpace.wëap[weap.submunition.id];
        if (subResource) {
            submunitions.push({
                count: weap.submunition.count,
                fireAtNearest: weap.submunition.fireAtNearest,
                id: subResource.globalID,
                limit: weap.submunition.limit,
                subIfExpire: weap.submunition.subIfExpire,
                theta: weap.submunition.theta * 2 * Math.PI / 360,
            });
        }
        else {
            notFoundFunction("Missing submunition id " + weap.submunition.id + " for wëap " + baseWeapon.id);
        }
    }

    return {
        ...baseWeapon,
        submunitions,
        damage,
        oneAmmoPerBurst: weap.oneAmmoPerBurst,
        shotDuration: weap.duration * 1000 / FPS,
        primaryExplosion,
        secondaryExplosion,
        blastRadius: weap.blastRadius,
        blastHurtsFiringShip: weap.hitsFiringShip,
        detonateWhenShotExpires: weap.flak,
        damageType,
        asteroidMiner: weap.asteroidMiner,
    }
}


async function ProjectileWeaponParse(weap: WeapResource, notFoundFunction: (m: string) => void, baseWeapon: BaseWeaponData): Promise<ProjectileWeaponData> {
    var notBayBase = await NotBayWeaponParse(weap, notFoundFunction, baseWeapon);

    // Parse the weapon's animation (the projectile it fires)
    var animation: Animation;
    // A projectile with no Graphic (-1) is malformed, but it is a resource
    // that exists, and seven installed plug-in weapons are like this
    // (Extra Outfits' 324-326 and 332-334, More Blasters CHEAT 254). It
    // takes the same degraded path as a Graphic naming a spïn that is not
    // there — reported through notFoundFunction, default animation — so
    // one such weapon cannot fail the whole outfitter's warm-up. (It used
    // to throw, which GameDataAggregator masked with a placeholder; the
    // aggregator no longer does, see #47.)
    let spinResource = weap.graphic === null ? undefined : weap.idSpace.spïn[weap.graphic];
    if (weap.graphic === null) {
        notFoundFunction("wëap " + notBayBase.id + " lists no graphic (Graphic -1)");
        animation = getDefaultAnimation();
    }
    else if (spinResource) {
        let rledResource = spinResource.idSpace.rlëD[spinResource.spriteID];
        if (rledResource) {

            // There should be an animationFromSpin function
            // because spins will eventually allow picts to be used
            // instead of rleds
            animation = {
                exitPoints: getDefaultExitPoints(),
                blink: null, // Weapon graphics have no running lights.
                animationMode: null, // Weapon spin is a wëap flag, not shän.
                weapDecay: 0, // No weapon overlay outside shän ships.
                id: baseWeapon.id,
                name: baseWeapon.name,
                prefix: baseWeapon.prefix,
                writerPrefix: baseWeapon.writerPrefix,
                images: {
                    baseImage: {
                        id: rledResource.globalID,
                        dataType: NovaDataType.SpriteSheetImage,
                        blendMode: weap.translucent ? BLEND_MODES.ADD : BLEND_MODES.NORMAL,
                        frames: {
                            normal: { start: 0, length: rledResource.numberOfFrames }
                        }
                    }
                }
            }
        }
        else {
            notFoundFunction("Missing rlëD id " + spinResource.spriteID + " for spïn " + weap.graphic);
            animation = getDefaultAnimation()
        }
    }
    else {
        notFoundFunction("Missing spïn id " + weap.graphic + " for wëap " + notBayBase.id);
        animation = getDefaultAnimation()
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

    // Clamp jamming vulnerabilities to [0, 100]; the resource stores raw
    // percentages and stock data occasionally carries out-of-range values.
    const clampPct = (n: number) => Math.max(0, Math.min(100, n));
    const jamVulnerabilities: [number, number, number, number] = [
        clampPct(weap.jamVuln[0] ?? 0),
        clampPct(weap.jamVuln[1] ?? 0),
        clampPct(weap.jamVuln[2] ?? 0),
        clampPct(weap.jamVuln[3] ?? 0),
    ];

    return {
        ...notBayBase,
        type: "ProjectileWeaponData",
        guidance,
        proxRadius: weap.proxRadius,
        proxSafety: weap.proxSafety / FPS,
        proxHitAll: weap.proxHitAll,
        trailParticles: weap.trailParticles,
        hitParticles: weap.hitParticles,
        animation,
        vulnerableTo,
        jamVulnerabilities,
        seeker: {
            passOverAsteroids: weap.passOverAsteroids,
            decoyedByAsteroids: weap.decoyedByAsteroids,
            confusedByInterference: weap.confusedByInterference,
            turnsAwayIfJammed: weap.turnsAwayIfJammed,
            attackParentIfJammed: weap.attackParentIfJammed,
        },
        // wëap Decay: frames of flight per point of mass & energy damage
        // lost. The Bible treats -1 and 0 identically ("Ignored"), so clamp
        // negatives to 0; the sim applies it from the shot's flight time.
        decay: Math.max(weap.decay, 0),
        // wëap Falloff (sprite-based): the same byte as beam coronaFalloff,
        // repurposed per the Bible's Falloff sprite note to fade the shot's
        // sprite out over the final 32/falloff frames of its life. 0/negative
        // means no fade; clamp negatives so 0 is the "no fade" sentinel.
        falloff: Math.max(weap.coronaFalloff, 0),
        // wëap Flags 0x0001 ("Spin the weapon's graphic continuously")
        // plus the BeamWidth/SpinRate byte, which for a spinning sprite
        // weapon is "the time between frames, in 30ths of a second".
        // Collapsed into one number whose 0 means "does not spin"; clamp
        // a spinning weapon's period up to 1 frame so the display never
        // divides by a zero-length period (BeamWidth 0 is legal in the
        // template — it means "no center beam" for actual beams).
        spinFrameInterval: weap.spinShots ? Math.max(1, weap.spinRate) : 0,
        physics: {
            acceleration: 0,
            armorRecharge: 0,
            deionize: 0,
            energy: 0,
            energyRecharge: 0,
            ionization: 0,
            mass: 0,
            shieldRecharge: 0,
            speed: baseWeapon.shotSpeed,
            turnRate: weap.turnRate * ShipTurnRateConversionFactor,
            shield: 0,
            armor: weap.durability,
            inertialess: guidance === 'guided',
        }
    }
}


async function BeamWeaponParse(weap: WeapResource, notFoundFunction: (m: string) => void, baseWeapon: BaseWeaponData): Promise<BeamWeaponData> {
    const notBayBase = await NotBayWeaponParse(weap, notFoundFunction, baseWeapon);
    let guidance: BeamGuidanceType;
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
            lightningAmplitude: weap.lightningAmplitude,
            lightningDensity: weap.lightningDensity,
            beamColor: weap.beamColor,
            coronaColor: weap.coronaColor,
            coronaFalloff: weap.coronaFalloff,
            length: weap.beamLength,
            width: weap.beamWidth,
        }
    }
}

async function BayWeaponParse(weap: WeapResource, notFoundFunction: (m: string) => void, baseWeapon: BaseWeaponData): Promise<BayWeaponData> {
    const ship = weap.idSpace.shïp[weap.ammoType];
    let shipID: string;
    if (ship) {
        shipID = ship.globalID;
    }
    else {
        notFoundFunction("Missing shïp " + weap.ammoType + " for bay weapon " + baseWeapon.id);
        shipID = getDefaultShipData().id;
    }

    return {
        ...baseWeapon,
        type: "BayWeaponData",
        guidance: "bay",
        shipID
    }
}

export async function WeaponParse(weap: WeapResource, notFoundFunction: (m: string) => void): Promise<WeaponData> {
    const base: BaseData = await BaseParse(weap, notFoundFunction);
    const baseWeapon: BaseWeaponData = await BaseWeaponParse(weap, notFoundFunction, base);
    let parseFunc: (w: WeapResource, nff: (m: string) => void, baseWeapon: BaseWeaponData) => Promise<WeaponData>

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
