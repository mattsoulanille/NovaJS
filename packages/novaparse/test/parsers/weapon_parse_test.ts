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
