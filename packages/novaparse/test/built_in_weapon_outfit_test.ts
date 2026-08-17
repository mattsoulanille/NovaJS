import "jasmine";
import { getDefaultProjectileWeaponData, getDefaultBeamWeaponData, WeaponData } from "novadatainterface/weapon_data";
import {
    builtInAmmoOutfitId, builtInOutfitWeaponId, builtInWeaponOutfitId,
    makeBuiltInAmmoOutfit, makeBuiltInWeaponOutfit,
} from "../src/built_in_weapon_outfit.js";
import { NovaParse } from "../src/nova_parse.js";
import { resolveFixture } from "./fixtures.js";

function weapon(over: Partial<WeaponData> = {}): WeaponData {
    return {
        ...getDefaultProjectileWeaponData(),
        id: "myPlugin:236",
        prefix: "myPlugin",
        name: "Swarmer Discharge",
        ...over,
    } as WeaponData;
}

/**
 * A ship's stock armament is a list of wëap ids (EVN Bible ~:2382,
 * shïp WeapType); an oütf exists only so a weapon can be BOUGHT. NovaJS
 * derives a ship's weapons from its outfits, so a weapon that no oütf
 * provides used to vanish during parsing and the ship flew unarmed —
 * which is why the Planet Rico plug-in's Swarmer fighters never fired.
 * These are the implicit outfits that carry such a weapon instead.
 */
describe("built-in weapon outfits", () => {
    it("round-trips a weapon id through its implicit outfit id", () => {
        const id = builtInWeaponOutfitId("myPlugin:236");
        expect(builtInOutfitWeaponId(id))
            .toEqual({ kind: "weapon", weaponId: "myPlugin:236" });
    });

    it("round-trips an implicit ammunition id", () => {
        const id = builtInAmmoOutfitId("myPlugin:236");
        expect(builtInOutfitWeaponId(id))
            .toEqual({ kind: "ammo", weaponId: "myPlugin:236" });
    });

    it("keeps the two implicit kinds distinct", () => {
        expect(builtInWeaponOutfitId("myPlugin:236"))
            .not.toEqual(builtInAmmoOutfitId("myPlugin:236"));
    });

    // Every real oütf globalID is "<plug-in prefix>:<resource number>",
    // so a suffixed id cannot be one no matter what a plug-in is called.
    it("cannot collide with a real outfit id", () => {
        for (const id of ["nova:128", "Planet Rico:444", "a:b:1"]) {
            expect(builtInOutfitWeaponId(id)).toBeUndefined();
        }
    });

    it("grants exactly its one weapon, and nothing else", () => {
        const outfit = makeBuiltInWeaponOutfit(weapon());
        expect(outfit.weapons).toEqual({ "myPlugin:236": 1 });
        expect(outfit.name).toEqual("Swarmer Discharge");
        expect(outfit.prefix).toEqual("myPlugin");
        expect(outfit.ammoFor).toBeNull();
    });

    // It is part of the hull: the ship's mass budget already paid for it,
    // it was never bought, and — since the data defines no item for it —
    // the original gives the player no way to sell it either.
    it("is weightless, free, unsellable and marked built-in", () => {
        const outfit = makeBuiltInWeaponOutfit(weapon());
        expect(outfit.physics.freeMass).toBe(0);
        expect(outfit.price).toBe(0);
        expect(outfit.cantSell).toBeTrue();
        expect(outfit.builtIn).toBeTrue();
    });

    it("occupies the hardpoint kind its guidance implies", () => {
        expect(makeBuiltInWeaponOutfit(weapon({ guidance: "unguided" })))
            .toEqual(jasmine.objectContaining({ fixedGun: true, turret: false }));
        expect(makeBuiltInWeaponOutfit(weapon({ guidance: "turret" })))
            .toEqual(jasmine.objectContaining({ fixedGun: false, turret: true }));
        expect(makeBuiltInWeaponOutfit(weapon({ guidance: "pointDefense" })))
            .toEqual(jasmine.objectContaining({ fixedGun: false, turret: true }));
        expect(makeBuiltInWeaponOutfit({
            ...getDefaultBeamWeaponData(), id: "myPlugin:236",
            guidance: "beamTurret",
        })).toEqual(jasmine.objectContaining({ fixedGun: false, turret: true }));
    });

    // Ammo is counted by finding owned outfits whose ammoFor names the
    // weapon (nova_plugin/weapon_plugin.ts countAmmo), so a built-in
    // weapon that burns ammo needs a magazine as much as it needs a gun.
    it("makes a magazine that feeds its weapon", () => {
        const ammo = makeBuiltInAmmoOutfit(weapon());
        expect(ammo.ammoFor).toEqual("myPlugin:236");
        expect(ammo.weapons).toEqual({});
        expect(ammo.builtIn).toBeTrue();
        expect(ammo.physics.freeMass).toBe(0);
    });
});

describe("NovaParse built-in weapon outfits", () => {
    let np: NovaParse;
    beforeEach(() => {
        np = new NovaParse(resolveFixture("novaParseTestFilesystem"));
    });

    it("synthesizes the outfit for any weapon id on demand", async () => {
        const weaponData = await np.data.Weapon.get("nova:132");
        const outfit = await np.data.Outfit.get(
            builtInWeaponOutfitId("nova:132"));
        expect(outfit.id).toEqual(builtInWeaponOutfitId("nova:132"));
        expect(outfit.name).toEqual(weaponData.name);
        expect(outfit.weapons).toEqual({ "nova:132": 1 });
        expect(outfit.builtIn).toBeTrue();
    });

    it("synthesizes the matching magazine on demand", async () => {
        const outfit = await np.data.Outfit.get(
            builtInAmmoOutfitId("nova:132"));
        expect(outfit.ammoFor).toEqual("nova:132");
        expect(outfit.builtIn).toBeTrue();
    });

    // The outfitter stocks its shelves by enumerating ids.Outfit
    // (spaceport/outfitter.ts), so keeping implicit ids out of that list
    // is what stops a weapon the data never made purchasable from
    // becoming purchasable — or sellable back — on a captured hull.
    it("keeps implicit outfits out of the outfit id list", async () => {
        const ids = (await np.ids).Outfit;
        expect(ids).not.toContain(builtInWeaponOutfitId("nova:132"));
        expect(ids).not.toContain(builtInAmmoOutfitId("nova:132"));
        expect(ids.every(id => builtInOutfitWeaponId(id) === undefined))
            .toBeTrue();
    });

    it("still parses ordinary oütf resources", async () => {
        const outfit = await np.data.Outfit.get("nova:131");
        expect(outfit.builtIn).toBeFalse();
    });
});
