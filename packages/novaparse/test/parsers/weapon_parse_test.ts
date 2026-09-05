import "jasmine";
import { BayWeaponData } from "novadatainterface/weapon_data";
import { WeaponParse } from "../../src/parsers/weapon_parse.js";
import { WeapResource } from "../../src/resource_parsers/weap_resource.js";

/**
 * A minimal bay wëap. In the real resource the AmmoType field holds the
 * carried shïp's id, which is why BayWeaponParse reads it as shipID —
 * and why a bay's ammo source has to be the bay weapon itself.
 */
function fakeBayWeap({ shipId = 128, maxAmmo = 4, id = "nova:150" }: {
    shipId?: number, maxAmmo?: number, id?: string,
} = {}): WeapResource {
    return {
        globalID: id,
        id,
        name: "Test Bay",
        prefix: "nova",
        guidance: "bay",
        guidanceN: 10,
        ammoType: shipId,
        maxAmmo,
        accuracy: 0,
        burstCount: 0,
        burstReload: 0,
        exitType: "center",
        fireGroup: "secondary",
        reload: 30,
        fireSimultaneously: false,
        speed: 0,
        sound: null,
        loopSound: false,
        useFiringAnimation: false,
        firesFromClosestToTarget: false,
        turretBlindSpots: { front: false, side: false, back: false },
        pictID: 0,
        descID: 0,
        idSpace: {
            "snd ": {},
            shïp: {
                [shipId]: { globalID: `nova:ship${shipId}` },
            },
            wëap: {},
            dësc: {},
        },
    } as unknown as WeapResource;
}

/**
 * A minimal unguided projectile wëap with no Graphic (-1), as Extra
 * Outfits' 324-326 / 332-334 and More Blasters CHEAT's 254 are.
 */
function fakeGraphiclessWeap(id = "extra-outfits:324"): WeapResource {
    return {
        globalID: id,
        id,
        name: "Invisible Shot",
        prefix: "extra-outfits",
        guidance: "unguided",
        guidanceN: -1,
        ammoType: -1,
        maxAmmo: 0,
        accuracy: 0,
        burstCount: 0,
        burstReload: 0,
        exitType: "gun",
        fireGroup: "primary",
        reload: 30,
        fireSimultaneously: false,
        speed: 500,
        duration: 60,
        sound: null,
        loopSound: false,
        useFiringAnimation: false,
        firesFromClosestToTarget: false,
        turretBlindSpots: { front: false, side: false, back: false },
        graphic: null,
        explosion: null,
        explosion128sparks: false,
        shieldDamage: 10,
        armorDamage: 5,
        ionization: 0,
        ionizeColor: 0,
        passThroughShields: false,
        impact: 0,
        disableOnly: false,
        submunition: null,
        blastRadius: 0,
        proxRadius: 0,
        proxSafety: 0,
        proxHitAll: true,
        trailParticles: { count: 0, velocity: 0, lifeMin: 0, lifeMax: 0, color: 0 },
        hitParticles: { count: 0, velocity: 0, lifeMin: 0, lifeMax: 0, color: 0 },
        vulnerableToPD: false,
        jamVuln: [0, 0, 0, 0],
        passOverAsteroids: false,
        decoyedByAsteroids: false,
        confusedByInterference: false,
        turnsAwayIfJammed: false,
        attackParentIfJammed: false,
        decay: 0,
        coronaFalloff: 0,
        spinShots: false,
        spinRate: 0,
        turnRate: 0,
        durability: 0,
        translucent: false,
        pictID: 0,
        descID: 0,
        idSpace: {
            "snd ": {},
            shïp: {},
            wëap: {},
            dësc: {},
            spïn: {},
            rlëD: {},
            bööm: {},
        },
    } as unknown as WeapResource;
}

describe("WeaponParse projectile with no graphic", () => {
    it("degrades to the default animation and reports it, instead of throwing",
        async () => {
            const reported: string[] = [];
            const weapon = await WeaponParse(fakeGraphiclessWeap(), m => reported.push(m));
            expect(weapon.type).toBe("ProjectileWeaponData");
            if (weapon.type === "ProjectileWeaponData") {
                expect(weapon.animation.images.baseImage.id).toBe("default");
                expect(weapon.damage.shield).toBe(10);
            }
            expect(reported.some(m => m.includes("extra-outfits:324")
                && m.toLowerCase().includes("graphic"))).toBeTrue();
        });
});

describe("WeaponParse bay ammo", () => {
    it("points a bay weapon's ammoType at its own supply, so the "
        + "generic ammo machinery spends fighters on launch", async () => {
            const bay = await WeaponParse(fakeBayWeap(), () => { });
            // NOT 'unlimited': a bay's ammo is its fighters, held by an
            // ammo oütf whose ammoFor is this same weapon id.
            expect(bay.ammoType).toEqual(["weapon", "nova:150"]);
        });

    it("keeps the carried ship id, which shares the AmmoType field",
        async () => {
            const bay = await WeaponParse(
                fakeBayWeap({ shipId: 173 }), () => { }) as BayWeaponData;
            expect(bay.type).toEqual("BayWeaponData");
            expect(bay.shipID).toEqual("nova:ship173");
            // The ship id and the ammo supply come from the same field
            // but mean different things; neither may clobber the other.
            expect(bay.ammoType).toEqual(["weapon", "nova:150"]);
        });

    it("parses MaxAmmo as the fighters one bay holds", async () => {
        // Stock nova bays run 2-6 (Anaconda Bay 2, Thunderhead 3,
        // Viper Bay 4, Manta Bay 6).
        const bay = await WeaponParse(
            fakeBayWeap({ maxAmmo: 6 }), () => { });
        expect(bay.maxAmmo).toEqual(6);
    });

    it("clamps a negative MaxAmmo to 0, the 'no launcher limit' "
        + "sentinel the outfitter reads", async () => {
            const bay = await WeaponParse(
                fakeBayWeap({ maxAmmo: -1 }), () => { });
            expect(bay.maxAmmo).toEqual(0);
        });

    it("reports a missing carried ship without breaking the ammo link",
        async () => {
            const notFound: string[] = [];
            const weap = fakeBayWeap();
            (weap as unknown as { idSpace: { shïp: {} } }).idSpace.shïp = {};
            const bay = await WeaponParse(
                weap, m => notFound.push(m)) as BayWeaponData;
            expect(notFound.length).toEqual(1);
            expect(bay.ammoType).toEqual(["weapon", "nova:150"]);
        });
});
