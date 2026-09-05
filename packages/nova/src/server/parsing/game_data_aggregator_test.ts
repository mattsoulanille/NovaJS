import "jasmine";
import { GameDataInterface } from "novadatainterface/game_data_interface";
import { Gettable } from "novadatainterface/gettable";
import { MockGameData } from "novadatainterface/mock_game_data";
import { NovaDataType } from "novadatainterface/nova_data_interface";
import { NovaIDNotFoundError } from "novadatainterface/nova_id_not_found_error";
import { ShipData, getDefaultShipData } from "novadatainterface/ship_data";
import { GameDataAggregator } from "./game_data_aggregator.js";

/**
 * A source whose Ship gettable answers from `ships`, rejects an id in
 * `broken` with a plain Error, and rejects everything else with
 * NovaIDNotFoundError — NovaParse's contract for an id absent from the id
 * space, and FilesystemData's for an absent object file.
 */
function shipSource(ships: { [id: string]: ShipData },
    broken: string[] = []): GameDataInterface {
    const mock = new MockGameData();
    const ids = mock.ids.then(all => ({ ...all, Ship: Object.keys(ships) }));
    return {
        ids,
        data: {
            ...mock.data,
            Ship: new Gettable<ShipData>(async (id: string) => {
                if (broken.includes(id)) {
                    throw new Error("corrupt " + id);
                }
                if (id in ships) {
                    return ships[id];
                }
                throw new NovaIDNotFoundError("no ship " + id);
            }),
        },
    };
}

function ship(id: string): ShipData {
    return { ...getDefaultShipData(), id, name: "Ship " + id };
}

describe("GameDataAggregator unknown ids", () => {
    let warnings: string[];
    beforeEach(() => {
        warnings = [];
    });

    it("rejects with NovaIDNotFoundError when no source defines the id, "
        + "and says so once", async () => {
            const aggregator = new GameDataAggregator(
                [shipSource({}), shipSource({ "nova:128": ship("nova:128") })],
                w => warnings.push(w));
            await expectAsync(aggregator.data.Ship.get("nova:999999"))
                .toBeRejectedWithError(NovaIDNotFoundError, /nova:999999/);
            expect(warnings.length).toBe(1);
            expect(warnings[0]).toContain("nova:999999");
            // Not a placeholder: the miss is cached, and the good id works.
            expect(aggregator.data.Ship.isMissing("nova:999999")).toBeTrue();
            expect(aggregator.data.Ship.getCached("nova:999999")).toBeUndefined();
            expect((await aggregator.data.Ship.get("nova:128")).id).toBe("nova:128");
        });

    it("rejects with the real error when a source that has the id fails to load it",
        async () => {
            // The overlay lacks the id; the parsed source has it but its
            // parse blows up. That is a load failure (a 500), not a 404.
            const aggregator = new GameDataAggregator(
                [shipSource({}), shipSource({}, ["nova:130"])],
                w => warnings.push(w));
            await expectAsync(aggregator.data.Ship.get("nova:130"))
                .toBeRejectedWithError(Error, "corrupt nova:130");
            expect(aggregator.data.Ship.isMissing("nova:130")).toBeFalse();
            expect(warnings).toEqual([]);
        });

    it("still falls through to a later source when an earlier one fails "
        + "for another reason", async () => {
            const aggregator = new GameDataAggregator(
                [shipSource({}, ["nova:131"]), shipSource({ "nova:131": ship("nova:131") })],
                w => warnings.push(w));
            expect((await aggregator.data.Ship.get("nova:131")).name).toBe("Ship nova:131");
        });

    it("has() answers from the id lists without loading anything", async () => {
        const loads: string[] = [];
        const source = shipSource({ "nova:128": ship("nova:128") });
        const inner = source.data.Ship;
        source.data.Ship = new Gettable<ShipData>(async (id: string) => {
            loads.push(id);
            return inner.get(id);
        });
        const aggregator = new GameDataAggregator([source], w => warnings.push(w));
        // The constructor preloads every KNOWN Ship id; let that settle so
        // the count below is has()'s alone.
        await aggregator.preloadData;
        const loadsBefore = loads.length;
        expect(await aggregator.has(NovaDataType.Ship, "nova:128")).toBeTrue();
        expect(await aggregator.has(NovaDataType.Ship, "nova:999999")).toBeFalse();
        expect(await aggregator.has(NovaDataType.Outfit, "nova:128")).toBeFalse();
        expect(loads.length).toBe(loadsBefore);
        expect(loads).not.toContain("nova:999999");
    });
});
