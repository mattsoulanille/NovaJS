import { Resource } from "resource_fork";
import { BaseResource } from "./nova_resource_base.js";
import { Reader } from "./reader.js";
import { NovaResources } from "./resource_holder_base.js";

/** A dude or përs spawn entry: resource id and percent chance. */
type SpawnChance = {
    id: number,
    /** Percent chance of appearing (dude) or being in the system (përs). */
    chance: number,
};

/**
 * A star system.
 *
 * Field layout follows ResForge's sÿst template (428 bytes, matching Nova's
 * own data exactly), documented in the EVN Bible pp. 63-64.
 */
class SystResource extends BaseResource {
    /** Position on the galactic map. */
    position: number[];
    /** sÿst ids reachable by hyperjump. */
    links: Set<number>;
    /** spöb ids present in the system. */
    spobs: number[];
    /** AI ship classes spawned here, with percent chances. */
    dudes: SpawnChance[];
    /**
     * Fleets spawned here through the DudeTypes table (entries -128 to
     * -383 reference flët -id), with percent chances.
     */
    fleets: SpawnChance[];
    /** Average number of AI ships in the system. */
    avgShips: number;
    /** Owning gövt id; -1 = independent. */
    govt: number;
    /** Nav buoy message: 'STR ' resource (this + 4000); -1 = no buoy. */
    messageBuoy: number;
    /** Number of asteroids (0-16). */
    asteroids: number;
    /** Sensor interference (0-100%). */
    interference: number;
    /** përs ships that may appear here, with percent chances. */
    persons: SpawnChance[];
    /** Background colour as 00RRGGBB (black if zero). */
    backgroundColor: number;
    /** How murky the system is, 0-100. */
    murk: number;
    /** Bitmask of which of the 16 röid types appear (bit 0 = röid 128). */
    asteroidTypes: number;
    /** NCB test controlling whether the system is visible. */
    visibility: string;
    /** flët id sent to defend the system; 0 or -1 = none (SystemParse decodes it). */
    reinforcementFleet: number;
    /** Frames the reinforcement fleet waits before jumping in. */
    reinforcementTime: number;
    /** Days before a destroyed reinforcement fleet is replenished. */
    reinforcementInterval: number;

    constructor(resource: Resource, idSpace: NovaResources) {
        super(resource, idSpace);
        const r = new Reader(this.data);

        this.position = [r.int16(), r.int16()];

        this.links = new Set(
            r.array(16, () => r.int16(-1)).filter(id => id >= 128));
        this.spobs = r.array(16, () => r.int16(-1)).filter(id => id >= 128);

        // DudeTypes: 128-639 is a düde id; -128 to -383 references
        // flët -id; -1 (or 0) is unused. See the EVN Bible's sÿst docs.
        const dudeIds = r.array(8, () => r.int16(-1));
        const dudeChances = r.array(8, () => r.int16());
        this.dudes = dudeIds.flatMap((id, i) =>
            id >= 128 ? [{ id, chance: dudeChances[i] }] : []);
        this.fleets = dudeIds.flatMap((id, i) =>
            id <= -128 ? [{ id: -id, chance: dudeChances[i] }] : []);

        this.avgShips = r.int16();
        this.govt = r.int16(-1);
        this.messageBuoy = r.int16(-1);
        this.asteroids = r.int16();
        this.interference = r.int16();

        const persIds = r.array(8, () => r.int16(-1));
        const persChances = r.array(8, () => r.int16());
        this.persons = persIds.flatMap((id, i) =>
            id >= 128 ? [{ id, chance: persChances[i] }] : []);

        this.backgroundColor = r.uint32();
        this.murk = r.int16();
        this.asteroidTypes = r.uint16();
        this.visibility = r.string(0x100);
        this.reinforcementFleet = r.int16(-1);
        this.reinforcementTime = r.int16();
        this.reinforcementInterval = r.int16();
    }
}

export { SystResource };
