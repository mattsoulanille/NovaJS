import "jasmine";
import { getDefaultProjectileWeaponData, getDefaultBeamWeaponData, WeaponData } from "novadatainterface/weapon_data";
import {
    ammoSupplyWeaponId, builtInAmmoOutfitId, builtInOutfitWeaponId,
    builtInWeaponOutfitId, makeBuiltInAmmoOutfit, makeBuiltInWeaponOutfit,
    preferredAmmoOutfit,
} from "../src/built_in_weapon_outfit.js";
import { NovaParse } from "../src/nova_parse.js";
import { resolveFixture } from "./fixtures.js";
import { STOCK_DATA_MISSING, stockNovaParse } from "./stock_data.js";

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

/**
 * A weapon's AmmoType names the wëap whose SUPPLY it draws on, "usually"
 * itself but not always (EVN Bible ~:3117-3123), and stock uses that: the
 * Raven Turret (139) draws on the Raven Rocket (138), fed by oütf 143.
 * A built-in weapon's stock ammo load must become that supply's ammo
 * oütf, and only when none exists an implicit magazine feeding it.
 */
describe("built-in weapon ammo supply", () => {
    it("names a weapon's ammo supply, and none for unlimited or fuel ammo",
        () => {
            expect(ammoSupplyWeaponId(weapon({
                ammoType: ["weapon", "nova:138"],
            }))).toBe("nova:138");
            expect(ammoSupplyWeaponId(weapon({ ammoType: "unlimited" })))
                .toBeUndefined();
            expect(ammoSupplyWeaponId(weapon({ ammoType: ["energy", 0.5] })))
                .toBeUndefined();
        });

    it("makes the magazine feed the supply the weapon draws on", () => {
        const ammo = makeBuiltInAmmoOutfit(weapon({
            id: "myPlugin:139", ammoType: ["weapon", "myPlugin:138"],
        }));
        expect(ammo.id).toBe("myPlugin:139:builtInAmmo");
        expect(ammo.ammoFor).toBe("myPlugin:138");
    });

    it("prefers a stock-id oütf, then the lowest resource number", () => {
        // Stock's Radar Missile supply, in id-space order.
        expect(preferredAmmoOutfit(["nova:137", "nova:327", "nova:330"]))
            .toBe("nova:137");
        expect(preferredAmmoOutfit(["nova:327", "nova:137"]))
            .toBe("nova:137");
        // A plug-in's extra ammo item never displaces the stock one,
        // even with a lower number; a plug-in override of a stock id
        // (prefix nova) still counts as stock.
        expect(preferredAmmoOutfit(["nova:143", "Raven Rockets:130"]))
            .toBe("nova:143");
        expect(preferredAmmoOutfit(["b:140", "a:131", "c:131"]))
            .toBe("a:131");
        expect(preferredAmmoOutfit([])).toBeUndefined();
    });
});

describe("stock ship ammo loads", () => {
    let np: NovaParse;
    beforeAll(async () => {
        const stock = await stockNovaParse();
        if (stock) {
            np = stock;
        }
    });

    // Aurora Cruiser "Va Gjencha": a Storm Chaingun (161, drawing on the
    // Hail Chaingun 155's supply) and Raven Turrets (139, on 138's).
    it("load a redirected weapon's ammo as its supply's real oütf",
        async () => {
            if (!np) {
                pending(STOCK_DATA_MISSING);
                return;
            }
            const ship = await np.data.Ship.get("nova:249");
            expect(ship.outfits["nova:170"]).toBe(800);
            expect(ship.outfits["nova:143"]).toBe(60);
            expect(Object.keys(ship.outfits)
                .filter(id => builtInOutfitWeaponId(id)?.kind === "ammo"))
                .toEqual([]);
        });

    it("leave no implicit magazine on any stock hull", async () => {
        if (!np) {
            pending(STOCK_DATA_MISSING);
            return;
        }
        const ids = (await np.ids).Ship;
        const carrying: string[] = [];
        for (const id of ids) {
            const ship = await np.data.Ship.get(id);
            for (const outfit of Object.keys(ship.outfits)) {
                if (builtInOutfitWeaponId(outfit)?.kind === "ammo") {
                    carrying.push(`${id} ${outfit}`);
                }
            }
        }
        expect(carrying).toEqual([]);
    });

    // A save written before the fix owns the old magazine id; it now
    // feeds the supply the turret actually fires from.
    it("resolve a legacy magazine id to one feeding the supply", async () => {
        if (!np) {
            pending(STOCK_DATA_MISSING);
            return;
        }
        expect((await np.data.Outfit.get(builtInAmmoOutfitId("nova:139")))
            .ammoFor).toBe("nova:138");
    });
});
