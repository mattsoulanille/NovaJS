import "jasmine";
import { SystemParse } from "../../src/parsers/system_parse.js";
import { SystResource } from "../../src/resource_parsers/syst_resource.js";
import { getEmptyNovaResources, NovaResources } from "../../src/resource_parsers/resource_holder_base.js";
import { ResourceBuilder } from "../resource_parsers/resource_builder.js";

/** An id space stubbed with just the globalIDs the parser resolves. */
function makeIdSpace(): NovaResources {
    const idSpace = getEmptyNovaResources();
    const stub = (globalID: string) => ({ globalID }) as never;
    idSpace.sÿst[129] = stub("nova:129");
    idSpace.spöb[128] = stub("nova:128");
    idSpace.düde[130] = stub("nova:130");
    idSpace.gövt[128] = stub("nova:128");
    idSpace.përs[510] = stub("nova:510");
    idSpace.përs[511] = stub("nova:511");
    idSpace.flët[145] = stub("nova:145");
    return idSpace;
}

/**
 * A sÿst listing përs 510 (2%), 511 (15%), and a missing përs 512 (30%)
 * in its Person fields, with the given ReinfFleet / ReinfTime /
 * ReinfIntrval.
 */
function buildSyst(
    reinforcement: [number, number, number] = [-1, 0, 0]): ResourceBuilder {
    const b = new ResourceBuilder();
    b.int16(42).int16(-84)                                          // position
        .array([129, ...Array(15).fill(-1)], v => b.int16(v))       // links
        .array([128, ...Array(15).fill(-1)], v => b.int16(v))       // spobs
        .array([130, ...Array(7).fill(-1)], v => b.int16(v))        // dude ids
        .array([100, 0, 0, 0, 0, 0, 0, 0], v => b.int16(v))         // dude chances
        .int16(6)                                                   // avgShips
        .int16(128)                                                 // govt
        .int16(-1)                                                  // messageBuoy
        .int16(0)                                                   // asteroids
        .int16(0)                                                   // interference
        .array([510, 511, 512, ...Array(5).fill(-1)], v => b.int16(v)) // pers ids
        .array([2, 15, 30, 0, 0, 0, 0, 0], v => b.int16(v))         // pers chances
        .uint32(0)                                                  // background
        .int16(0)                                                   // murk
        .uint16(0)                                                  // asteroidTypes
        .string("", 0x100)                                          // visibility
        .int16(reinforcement[0])                                    // reinf fleet
        .int16(reinforcement[1])                                    // reinf time
        .int16(reinforcement[2])                                    // reinf interval
        .skip(0x10);                                                // unused
    return b;
}

function parseSystem(reinforcement?: [number, number, number]) {
    const resource = new SystResource(
        buildSyst(reinforcement).resource("sÿst", 128, "Test System"), makeIdSpace());
    resource.globalID = "nova:128";
    resource.prefix = "nova";
    return SystemParse(resource, () => { });
}

describe("SystemParse", () => {
    it("carries the BaseData fields", async () => {
        const system = await parseSystem();
        expect(system.id).toBe("nova:128");
        expect(system.name).toBe("Test System");
    });

    it("resolves the sÿst Person fields to global ids with their percent "
        + "chances, dropping people the id space doesn't have", async () => {
            const system = await parseSystem();
            expect(system.persons).toEqual([
                { id: "nova:510", chance: 2 },
                { id: "nova:511", chance: 15 },
                // përs 512 is not in the id space: dropped.
            ]);
        });

    it("stays JSON-serializable", async () => {
        const system = await parseSystem();
        expect(() => JSON.stringify(system)).not.toThrow();
    });

    it("resolves the reinforcement fleet with its delay and regeneration "
        + "interval (Sol: flët 145, 480 frames, 1 day)", async () => {
            const system = await parseSystem([145, 480, 1]);
            expect(system.reinforcements).toEqual({
                fleet: "nova:145", delayFrames: 480, regenerationDays: 1,
            });
        });

    it("keeps a ReinfIntrval of 0 (a fleet every day)", async () => {
        const system = await parseSystem([145, 300, 0]);
        expect(system.reinforcements!.regenerationDays).toBe(0);
    });

    it("has no reinforcements for ReinfFleet -1 or 0", async () => {
        expect((await parseSystem([-1, 0, 0])).reinforcements).toBeNull();
        // 198 stock systems store 0 here, the Bible's other "unused" value.
        expect((await parseSystem([0, 450, 3])).reinforcements).toBeNull();
    });

    it("drops an unresolvable reinforcement fleet with a warning", async () => {
        spyOn(console, "warn");
        expect((await parseSystem([999, 450, 3])).reinforcements).toBeNull();
        expect(console.warn).toHaveBeenCalledWith(
            jasmine.stringContaining("reinforcement fleet"));
    });
});
