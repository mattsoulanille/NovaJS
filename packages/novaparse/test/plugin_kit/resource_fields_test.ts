import "jasmine";
import { Resource } from "resource_fork";
import {
    FieldKind, patchResource, RESOURCE_FIELDS, RESOURCE_SIZES,
} from "../../src/plugin_kit/resource_fields.js";
import { DudeResource } from "../../src/resource_parsers/dude_resource.js";
import { GovtResource } from "../../src/resource_parsers/govt_resource.js";
import { JunkResource } from "../../src/resource_parsers/junk_resource.js";
import { MisnResource } from "../../src/resource_parsers/misn_resource.js";
import { OutfResource } from "../../src/resource_parsers/outf_resource.js";
import { PersResource } from "../../src/resource_parsers/pers_resource.js";
import { ShipResource } from "../../src/resource_parsers/ship_resource.js";
import { SpobResource } from "../../src/resource_parsers/spob_resource.js";
import { SystResource } from "../../src/resource_parsers/syst_resource.js";
import { WeapResource } from "../../src/resource_parsers/weap_resource.js";
import { getEmptyNovaResources } from "../../src/resource_parsers/resource_holder_base.js";

function kindSize(kind: FieldKind): number {
    const str = /^str(\d+)$/.exec(kind);
    if (str) return Number(str[1]);
    const arr = /^i16x(\d+)$/.exec(kind);
    if (arr) return 2 * Number(arr[1]);
    return { i16: 2, u16: 2, i32: 4, u32: 4, u64: 8 }[kind as "i16"];
}

function resource(type: string, bytes: Uint8Array): Resource {
    return new Resource(type, 1000, "Test", new DataView(bytes.buffer));
}

/** Blank resource with every id-list field set to -1, as the game expects. */
function blank(type: string): Uint8Array {
    return new Uint8Array(RESOURCE_SIZES[type]).fill(0xff);
}

describe("plugin_kit resource fields", () => {
    for (const [type, table] of Object.entries(RESOURCE_FIELDS)) {
        it(`${type}: fields lie inside the template and never overlap`, () => {
            const size = RESOURCE_SIZES[type];
            const owner = new Array<string | null>(size).fill(null);
            for (const [name, [at, kind]] of Object.entries(table)) {
                const end = at + kindSize(kind);
                expect(end).withContext(`${type}.${name}`).toBeLessThanOrEqual(size);
                for (let i = at; i < end; i++) {
                    expect(owner[i]).withContext(`${type}.${name} overlaps ${owner[i]}`).toBeNull();
                    owner[i] = name;
                }
            }
        });

        it(`${type}: setting a field changes only that field's bytes`, () => {
            for (const [name, [at, kind]] of Object.entries(table)) {
                const base = new Uint8Array(RESOURCE_SIZES[type]);
                const n = /^i16x(\d+)$/.exec(kind);
                const value = kind.startsWith("str") ? "x"
                    : n ? new Array(Number(n[1])).fill(7) : 7;
                const out = patchResource(type, base, { [name]: value });
                const end = at + kindSize(kind);
                out.forEach((b, i) => {
                    if (i < at || i >= end) {
                        expect(b).withContext(`${type}.${name} touched byte ${i}`).toBe(0);
                    }
                });
            }
        });
    }

    it("shïp fields read back through ShipResource", () => {
        const ship = new ShipResource(resource("shïp", patchResource("shïp", blank("shïp"), {
            cargo: 11, shield: 222, accel: 333, speed: 444, turn: 15, fuel: 600,
            armor: 77, mass: 88, flags: 0, flags2: "0x0040", strength: 42, crew: 9,
            cost: 123456, appearOn: "b123", longName: "Probe Hull", subtitle: "sub",
            weapons: [300, -1, -1, -1], weaponCounts: [2, 0, 0, 0], weaponAmmo: [5, 0, 0, 0],
            weapons2: [-1, -1, -1, -1], outfits: [-1, -1, -1, -1], outfits2: [-1, -1, -1, -1],
            maxGuns: 3, maxTurrets: 4, ai: 3, govt: 128, escortType: 2,
        })), getEmptyNovaResources());
        expect(ship.cargoSpace).toBe(11);
        expect(ship.shield).toBe(222);
        expect(ship.acceleration).toBe(333);
        expect(ship.speed).toBe(444);
        expect(ship.turnRate).toBe(15);
        expect(ship.energy).toBe(600);
        expect(ship.armor).toBe(77);
        expect(ship.mass).toBe(88);
        expect(ship.flags2N).toBe(0x40);
        expect(ship.strength).toBe(42);
        expect(ship.crew).toBe(9);
        expect(ship.cost).toBe(123456);
        expect(ship.appearOn).toBe("b123");
        expect(ship.longName).toBe("Probe Hull");
        expect(ship.subtitle).toBe("sub");
        expect(ship.maxGuns).toBe(3);
        expect(ship.maxTurrets).toBe(4);
        expect(ship.inherentAI).toBe(3);
        expect(ship.inherentGovt).toBe(128);
        expect(ship.escortType).toBe(2);
        expect(ship.weapons.length).toBe(1);
        expect(ship.weapons[0].count).toBe(2);
        expect(ship.weapons[0].ammo).toBe(5);
    });

    it("wëap fields read back through WeapResource", () => {
        const weap = new WeapResource(resource("wëap", patchResource("wëap", blank("wëap"), {
            reload: 30, duration: 45, armorDamage: 500, shieldDamage: 600, guidance: 1,
            speed: 1500, ammoType: -1, inaccuracy: 3, flags: 0, flags2: 0, flags3: 0,
            guidedTurn: 25, maxAmmo: 12, durability: 4, burstCount: 0, burstReload: 0,
            ionization: 0, recoil: 0, exitType: -1, proxSafety: 0, beamLength: 0,
        })), getEmptyNovaResources());
        expect(weap.reload).toBe(30);
        expect(weap.duration).toBe(45);
        expect(weap.armorDamage).toBe(500);
        expect(weap.shieldDamage).toBe(600);
        expect(weap.guidanceN).toBe(1);
        expect(weap.speed).toBe(1500);
        expect(weap.accuracy).toBe(3);
        expect(weap.turnRate).toBe(25);
        expect(weap.maxAmmo).toBe(12);
        expect(weap.durability).toBe(4);
    });

    it("oütf fields read back through OutfResource", () => {
        const outf = new OutfResource(resource("oütf", patchResource("oütf", blank("oütf"), {
            displayWeight: 5, mass: 6, techLevel: 7, modType: 1, modVal: 300, max: 2,
            flags: 0, cost: 99999, modType2: -1, modType3: -1, modType4: -1,
            contribute: 0, require: 0, availability: "", onPurchase: "b7",
            shortName: "Probe Gun", lcName: "probe gun", lcPlural: "probe guns",
            itemClass: 0, scanMask: 0, buyRandom: 100,
        })), getEmptyNovaResources());
        expect(outf.mass).toBe(6);
        expect(outf.techLevel).toBe(7);
        expect(outf.max).toBe(2);
        expect(outf.cost).toBe(99999);
        expect(outf.onPurchase).toBe("b7");
        expect(outf.outfitterName).toBe("Probe Gun");
        expect(outf.lcPlural).toBe("probe guns");
        expect(outf.availableRandom).toBe(100);
    });

    it("sÿst, spöb, gövt, düde, mïsn, jünk and përs read back", () => {
        const ids = getEmptyNovaResources();
        const syst = new SystResource(resource("sÿst", patchResource("sÿst", blank("sÿst"), {
            x: 10, y: -20, links: new Array(16).fill(-1), spobs: [2000, ...new Array(15).fill(-1)],
            dudes: new Array(8).fill(-1), dudeProbs: new Array(8).fill(0), avgShips: 3,
            govt: -1, asteroids: 0, interference: 0, persons: new Array(8).fill(-1),
            personProbs: new Array(8).fill(0), murk: 0, asteroidTypes: 0, visibility: "",
        })), ids);
        expect(syst.position).toEqual([10, -20]);
        expect(syst.spobs).toEqual([2000]);
        expect(syst.avgShips).toBe(3);

        const spob = new SpobResource(resource("spöb", patchResource("spöb", blank("spöb"), {
            x: -5, y: 6, type: 3, flags: "0x00000001", techLevel: 9, govt: 128,
            minStatus: -100, landingFee: 50, gravity: 0, weapon: -1, strength: 0,
        })), ids);
        expect(spob.position).toEqual([-5, 6]);
        expect(spob.flags).toBe(1);
        expect(spob.techLevel).toBe(9);
        expect(spob.government).toBe(128);
        expect(spob.minStatus).toBe(-100);
        expect(spob.landingFee).toBe(50);

        const govt = new GovtResource(resource("gövt", patchResource("gövt", blank("gövt"), {
            flags: 0, flags2: 0, killPenalty: 100, crimeTol: 50, initialRec: 0, maxOdds: 100,
            classes: [1000, -1, -1, -1], allies: [1001, -1, -1, -1], enemies: [1002, -1, -1, -1],
            commName: "Probe", mediumName: "Probe Corps", scanMask: 0, require: 0,
        })), ids);
        expect(govt.killPenalty).toBe(100);
        expect(govt.crimeTol).toBe(50);
        expect(govt.commName).toBe("Probe");
        expect(govt.mediumName).toBe("Probe Corps");

        const dude = new DudeResource(resource("düde", patchResource("düde", blank("düde"), {
            ai: 3, govt: 1000, flags: 0, infoTypes: 0,
            ships: [800, ...new Array(15).fill(-1)], probs: [100, ...new Array(15).fill(0)],
        })), ids);
        expect(dude.aiType).toBe(3);
        expect(dude.govt).toBe(1000);
        expect(dude.ships).toEqual([{ id: 800, probability: 100 }]);

        const misn = new MisnResource(resource("mïsn", patchResource("mïsn", blank("mïsn"), {
            availStel: 2000, availLoc: 1, availRandom: 100, shipCount: 1, shipDude: 1000,
            shipGoal: 3, shipBehav: 1, shipSyst: -1, payVal: 1000, onAccept: "b5",
            acceptButton: "Go",
        })), ids);
        expect(misn.availStel).toBe(2000);
        expect(misn.availLoc).toBe(1);
        expect(misn.shipGoal).toBe(3);
        expect(misn.shipBehav).toBe(1);
        expect(misn.payVal).toBe(1000);
        expect(misn.onAccept).toBe("b5");
        expect(misn.acceptButton).toBe("Go");

        const junk = new JunkResource(resource("jünk", patchResource("jünk", blank("jünk"), {
            soldAt: [2000, ...new Array(7).fill(-1)], boughtAt: [2001, ...new Array(7).fill(-1)],
            basePrice: 1000, flags: 0, scanMask: 0, lcName: "probes", abbrev: "Prb",
            buyOn: "", sellOn: "",
        })), ids);
        expect(junk.basePrice).toBe(1000);
        expect(junk.abbrev).toBe("Prb");
        expect(junk.lcName).toBe("probes");

        const pers = new PersResource(resource("përs", patchResource("përs", blank("përs"), {
            linkSystem: 2000, govt: 1000, ai: 3, ship: 800, credits: 77, flags: 0,
            activeOn: "", subtitle: "Probe",
        })), ids);
        expect(pers.linkSystem).toBe(2000);
        expect(pers.shipType).toBe(800);
        expect(pers.credits).toBe(77);
        expect(pers.subtitle).toBe("Probe");
    });

    it("accepts raw @offset:kind fields and rejects unknown names", () => {
        const out = patchResource("shïp", new Uint8Array(10), { "@6:i16": 300 });
        expect(new DataView(out.buffer).getInt16(6)).toBe(300);
        expect(out.length).toBe(RESOURCE_SIZES["shïp"]);
        expect(() => patchResource("shïp", new Uint8Array(0), { topSpeed: 1 }))
            .toThrowError(/unknown shïp field/);
        expect(() => patchResource("shïp", new Uint8Array(0), { weapons: [1, 2] }))
            .toThrowError(/exactly 4/);
    });
});
