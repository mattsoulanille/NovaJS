import { Resource } from "resource_fork";
import { BaseResource } from "./nova_resource_base.js";
import { Reader } from "./reader.js";
import { NovaResources } from "./resource_holder_base.js";

type ShipWeap = {
    id: number,
    count: number,
    ammo: number
};

type Outfit = {
    id: number,
    count: number,
};

/**
 * A ship class.
 *
 * Field layout follows ResForge's shïp template (1860 bytes, matching Nova's
 * own data exactly), documented in the EVN Bible pp. 53-58.
 */
class ShipResource extends BaseResource {
    /** PICT shown in the shipyard; always the ship's id mapped to 5000+. */
    pictID: number;
    /** The HUD target render, PICT 3000 + id - 128 (EVN Bible ~:2700). */
    targetPictID: number;
    /** dësc shown in the shipyard; always the ship's id mapped to 13000+. */
    descID: number;

    cargoSpace: number;
    shield: number;
    acceleration: number;
    speed: number;
    turnRate: number;
    energy: number;
    freeSpace: number;
    armor: number;
    shieldRecharge: number;
    /** Stock weapons: the four slots at offset 18 plus four more at 1742. */
    weapons: Array<ShipWeap>;
    maxGuns: number;
    maxTurrets: number;
    techLevel: number;
    cost: number;
    /** Frames between death and the final explosion. */
    deathDelay: number;
    armorRecharge: number;
    /** bööm id of the explosions shown during the death delay; null = none. */
    initialExplosion: number | null;
    /** bööm id of the final explosion; null = none. */
    finalExplosion: number | null;
    /** Whether the final explosion propagates sparks (stored as +1000). */
    finalExplosionSparks: boolean;
    displayOrder: number;
    mass: number;
    length: number;
    inherentAI: number;
    crew: number;
    strength: number;
    inherentGovt: number;
    flagsN: number;
    /** Decorative escape pods. */
    podCount: number;
    /** Default outfits: the four slots at offset 78 plus four more at 880. */
    outfits: Array<Outfit>;
    /** Frames per unit of energy regained. */
    energyRecharge: number;
    /** AI skill variance in percent. */
    skillVariation: number;
    flags2N: number;
    /** NCB test gating shipyard availability. */
    availabilityNCB: string;
    /** NCB test gating which ships appear for AIs. */
    appearOn: string;
    /** NCB set evaluated on purchase. */
    onPurchase: string;
    /** Deionization rate; 100 = 1 point per frame. */
    deionize: number;
    /** Maximum ionization. */
    ionization: number;
    /** shïp id of the ship type this one unlocks when boarded; -1 = none. */
    keyCarried: number;
    /** 64-bit flag set contributed while flying this ship. */
    contribute: bigint;
    /** 64-bit flags and'ed against the player's Contribute bits to buy. */
    require: bigint;
    buyRandom: number;
    hireRandom: number;
    /** NCB set evaluated when the player captures this ship. */
    onCapture: string;
    /** NCB set evaluated when this escort retires. */
    onRetire: string;
    shortName: string;
    commName: string;
    longName: string;
    /** Movie file shown in the shipyard. */
    movieFile: string;
    subtitle: string;
    flags3N: number;
    /** shïp id this escort can upgrade to; -1 = none. */
    escortUpgradeShip: number;
    escortUpgradeCost: number;
    escortSellValue: number;
    /** Escort category override (fighter/light/heavy...); -1 = by strength. */
    escortType: number;

    constructor(resource: Resource, idSpace: NovaResources) {
        super(resource, idSpace);
        const r = new Reader(this.data);

        this.pictID = this.id - 128 + 5000;
        this.targetPictID = this.id - 128 + 3000;
        this.descID = this.id - 128 + 13000;

        this.cargoSpace = r.int16();
        this.shield = r.int16();
        this.acceleration = r.int16();
        this.speed = r.int16();
        this.turnRate = r.int16();
        this.energy = r.int16();
        this.freeSpace = r.int16();
        this.armor = r.int16();
        this.shieldRecharge = r.int16();

        // Stock weapons: parallel arrays of 4 ids, 4 counts, 4 ammo counts.
        // Four more slots are stored the same way at offset 1742, read below.
        const weaponIds = r.array(4, () => r.int16(-1));
        const weaponCounts = r.array(4, () => r.int16());
        const weaponAmmo = r.array(4, () => r.int16());

        this.maxGuns = r.int16();
        this.maxTurrets = r.int16();
        this.techLevel = r.int16();
        this.cost = r.int32();
        this.deathDelay = r.int16();
        this.armorRecharge = r.int16();

        // bööm ids are stored 0-63; -1 means none.
        const maybeBoom = (n: number): number | null =>
            n === -1 ? null : n + 128;
        this.initialExplosion = maybeBoom(r.int16(-1));
        let finalExplosion = r.int16(-1);
        this.finalExplosionSparks = finalExplosion >= 1000;
        if (this.finalExplosionSparks) {
            finalExplosion -= 1000;
        }
        this.finalExplosion = maybeBoom(finalExplosion);

        this.displayOrder = r.int16();
        this.mass = r.int16();
        this.length = r.int16();
        this.inherentAI = r.int16();
        this.crew = r.int16();
        this.strength = r.int16();
        this.inherentGovt = r.int16(-1);
        this.flagsN = r.uint16();
        this.podCount = r.int16();

        // Default outfits: 4 ids then 4 counts; four more slots at 880.
        const outfitIds = r.array(4, () => r.int16(-1));
        const outfitCounts = r.array(4, () => r.int16());

        this.energyRecharge = r.int16();
        this.skillVariation = r.int16();
        this.flags2N = r.uint16();
        this.contribute = r.uint64();

        this.availabilityNCB = r.string(0xff);
        this.appearOn = r.string(0xff);
        this.onPurchase = r.string(0x100);

        this.deionize = r.int16();
        this.ionization = r.int16();
        this.keyCarried = r.int16(-1);

        outfitIds.push(...r.array(4, () => r.int16(-1)));
        outfitCounts.push(...r.array(4, () => r.int16()));
        this.outfits = [];
        for (let i = 0; i < outfitIds.length; i++) {
            if (outfitIds[i] >= 128) {
                this.outfits.push({ id: outfitIds[i], count: outfitCounts[i] });
            }
        }

        this.require = r.uint64();
        this.buyRandom = r.int16();
        this.hireRandom = r.int16();
        r.skip(0x44);                       // unused
        this.onCapture = r.string(0xff);
        this.onRetire = r.string(0xff);
        this.shortName = r.string(0x40);
        this.commName = r.string(0x20);
        this.longName = r.string(0x80);
        this.movieFile = r.string(0x20);

        weaponIds.push(...r.array(4, () => r.int16(-1)));
        weaponCounts.push(...r.array(4, () => r.int16()));
        weaponAmmo.push(...r.array(4, () => r.int16()));
        this.weapons = [];
        for (let i = 0; i < weaponIds.length; i++) {
            if (weaponIds[i] >= 128) {
                this.weapons.push({
                    id: weaponIds[i],
                    count: weaponCounts[i],
                    ammo: weaponAmmo[i],
                });
            }
        }

        this.subtitle = r.string(0x40);
        this.flags3N = r.uint16();
        this.escortUpgradeShip = r.int16(-1);
        this.escortUpgradeCost = r.int32();
        this.escortSellValue = r.int32();
        this.escortType = r.int16(-1);
    }
}

export { ShipResource };
