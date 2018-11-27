import { Resource } from "resourceforkjs";
import { NovaResources } from "../ResourceHolderBase";
import { BaseResource } from "./NovaResourceBase";

type ShipWeap = {
    id: number,
    count: number,
    ammo: number
};

type Outfit = {
    id: number,
    count: number,
}

class ShipResource extends BaseResource {
    pictID: number;
    cargoSpace: number;
    shield: number;
    acceleration: number;
    speed: number;
    turnRate: number;
    energy: number;
    freeSpace: number;
    armor: number;
    shieldRecharge: number;
    descID: number;
    weapons: Array<ShipWeap>;
    maxGuns: number;
    maxTurrets: number;
    techLevel: number;
    cost: number;
    deathDelay: number;
    armorRecharge: number;
    initialExplosion: number | null;
    finalExplosion: number | null;
    finalExplosionSparks: boolean;
    displayOrder: number;
    mass: number;
    length: number;
    inherentAI: number;
    crew: number;
    strength: number;
    inherentGovt: number;
    flagsN: number;
    podCount: number;
    outfits: Array<Outfit>;
    energyRecharge: number;
    skillVariation: number;
    flags2N: number;
    availabilityNCB: string;
    appearOn: string;
    onPurchase: string;
    deionize: number;
    ionization: number;
    keyCarried: number;
    contribute: number[];
    require: number[];
    buyRandom: number;
    hireRandom: number;
    onCapture: string;
    onRetire: string;
    subtitle: string;
    shortName: string;
    commName: string;
    longName: string;
    escortType: number;

    constructor(resource: Resource, idSpace: NovaResources) {
        super(resource, idSpace);

        var d = this.data;
        this.pictID = this.id - 128 + 5000;

        this.cargoSpace = d.getInt16(0);
        this.shield = d.getInt16(2);
        this.acceleration = d.getInt16(4);
        this.speed = d.getInt16(6);
        this.turnRate = d.getInt16(8);
        this.energy = d.getInt16(10);
        this.freeSpace = d.getInt16(12);
        this.armor = d.getInt16(14);
        this.shieldRecharge = d.getInt16(16);

        this.descID = this.id - 128 + 13000;

        //stock weapons
        this.weapons = [];
        for (var i = 0; i < 4; i++) {
            this.weapons[i] = {
                id: d.getInt16(18 + 2 * i),
                count: d.getInt16(26 + 2 * i),
                ammo: d.getInt16(34 + 2 * i)
            };
        }
        // Additional weapons are stored way down the resource
        for (var i = 4; i < 8; i++) {
            this.weapons[i] = {
                id: d.getInt16(1742 + 2 * i - 8),
                count: d.getInt16(1750 + 2 * i - 8),
                ammo: d.getInt16(1758 + 2 * i - 8)
            };
        }

        this.maxGuns = d.getInt16(42);
        this.maxTurrets = d.getInt16(44);
        this.techLevel = d.getInt16(46);
        this.cost = d.getInt16(50);
        this.deathDelay = d.getInt16(52);
        this.armorRecharge = d.getInt16(54);

        var maybeNull = function(n: number, a: number): number | null {
            if (n == -1)
                return null;
            return n + a;
        };

        this.initialExplosion = maybeNull(d.getInt16(56), 128);
        this.finalExplosion = maybeNull(d.getInt16(58), 128);
        this.finalExplosionSparks = false;
        if (this.finalExplosion && this.finalExplosion >= 1000) {
            this.finalExplosion -= 1000;
            this.finalExplosionSparks = true;
        }

        this.displayOrder = d.getInt16(60);

        this.mass = d.getInt16(62);
        this.length = d.getInt16(64);
        this.inherentAI = d.getInt16(66);
        this.crew = d.getInt16(68);
        this.strength = d.getInt16(70);

        this.inherentGovt = d.getInt16(72);
        this.flagsN = d.getInt16(74);

        this.podCount = d.getInt16(76);
        this.outfits = [];
        for (var i = 0; i < 4; i++) {
            this.outfits[i] = {
                id: d.getInt16(78 + 2 * i),
                count: d.getInt16(86 + 2 * i)
            };
        }
        // More outfits
        for (var i = 0; i < 4; i++) {
            this.outfits[i + 4] = {
                id: d.getInt16(880 + 2 * i),
                count: d.getInt16(888 + 2 * i)
            };
        }


        this.energyRecharge = d.getInt16(94);
        this.skillVariation = d.getInt16(96);
        this.flags2N = d.getInt16(98);

        var getString = function(start: number, length: number): string {
            var s = "";
            for (var i = start; i < start + length; i++) {
                if (0 != d.getUint8(i))
                    s += String.fromCharCode(d.getUint8(i));
            }
            return s;
        };

        this.availabilityNCB = getString(108, 255);

        this.appearOn = getString(363, 255);
        this.onPurchase = getString(618, 255);
        this.deionize = d.getInt16(874);
        this.ionization = d.getInt16(876);
        this.keyCarried = d.getInt16(878);

        this.contribute = [d.getUint32(896), d.getUint32(900)];
        this.require = [d.getUint32(896), d.getUint32(900)];
        this.buyRandom = d.getInt16(904);
        this.hireRandom = d.getInt16(906);

        this.onCapture = getString(908, 255);
        this.onRetire = getString(1163, 255);
        this.subtitle = getString(1766, 64);
        this.shortName = getString(1486, 64);
        this.commName = getString(1550, 32);
        this.longName = getString(1582, 132);

        this.escortType = d.getInt16(1829);
    }
}


export { ShipResource }
