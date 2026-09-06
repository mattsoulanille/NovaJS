import { isRez, parseResourceFork, readResourceFork, readRez, ResourceMap } from "./index.js";
import { buildResourceFork } from "./write.js";
import * as fs from 'fs';
import * as path from 'path';

const testdata = path.resolve(import.meta.dirname, '../testdata');
const rezPath = path.resolve(testdata, 'test.rez');
const ndatPath = path.resolve(testdata, 'test.ndat');


function testResourceFork(getResources: () => Promise<ResourceMap>) {
    describe('reading resource fork data', () => {
        let resources: ResourceMap
        beforeEach(async () => {
            resources = await getResources();
        });

        it('gets the types of resources', () => {
            expect(resources.hasOwnProperty('wëap')).toBeTrue();
        });

        it('gets the names of resources', () => {
            expect(resources['wëap'][128].name).toEqual('blaster');;
        });

        it("gets data from resources", () => {
            const data = 'ff ff 00 1e 00 ea 00 7b ff ff 00 01 ff ff ff ff 00 00 ff ff 01 59 ff ff 00 00 00 00 00 00 00 00 ff ff 00 00 ff ff ff ff ff ff ff ff 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 ff ff 00 00 00 00 ff ff 00 00 00 00 ff ff ff ff ff ff 00 00 00 00 00 00 ff ff ff ff ff ff 00 00 00 00 00 00 00 00 00 00 00 00 00 00 ff ff 00 00 ff ff 00 00 00 00 ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff';
            expect(resources['wëap'][128].hexString).toEqual(data);
        });
    });
}

describe("resourceFork", () => {
    describe("readResourceFork", () => {
        describe("reading .ndat", () => {
            testResourceFork(() => {
                // pretend data fork is resource fork for compatability with other OSes
                return readResourceFork(ndatPath, false);
            });
        })
        describe("reading .rez", () => {
            testResourceFork(() => {
                // .rez files store their data in the data fork.
                return readResourceFork(rezPath, false);
            });
        });
    });

    describe("isRez", () => {
        it("returns true for rez files", async () => {
            const rezFile = await fs.promises.readFile(rezPath);
            const rezView = new DataView(rezFile.buffer);
            expect(isRez(rezView)).toBeTrue();
        });

        it("returns false for other files", async () => {
            const file = await fs.promises.readFile(ndatPath);
            const dataView = new DataView(file.buffer);
            expect(isRez(dataView)).toBeFalse();
        });
    });

    describe('readRez', () => {
        testResourceFork(async () => {
            const rezFile = await fs.promises.readFile(rezPath);
            const rezView = new DataView(rezFile.buffer);
            return readRez(rezView);
        });
    });

    describe("buildResourceFork round trip", () => {
        it("reads back types, ids, names and data", () => {
            const fork = buildResourceFork([
                { type: "wëap", id: 128, name: "blaster", data: [1, 2, 3] },
                { type: "wëap", id: 300, data: [] },
                { type: "shïp", id: 128, name: "Shüttle", data: [9] },
            ]);
            const resources = parseResourceFork(fork);
            expect(Object.keys(resources).sort()).toEqual(["shïp", "wëap"]);
            expect(resources["wëap"][128].name).toEqual("blaster");
            expect(resources["wëap"][128].shortArray).toEqual([1, 2, 3]);
            expect(resources["wëap"][300].name).toEqual("");
            expect(resources["wëap"][300].data.byteLength).toEqual(0);
            expect(resources["shïp"][128].name).toEqual("Shüttle");
            expect(resources["shïp"][128].shortArray).toEqual([9]);
        });

        // Mac resource ids are signed shorts (ResID). Every Finder-decorated
        // plug-in carries a custom-icon icns -16455; read unsigned it came
        // back as 49081, and -1 as 65535.
        it("reads resource ids as signed 16-bit", () => {
            const fork = buildResourceFork([
                { type: "icns", id: -16455, data: [0] },
                { type: "icns", id: -1, data: [0] },
                { type: "icns", id: 32767, data: [0] },
            ]);
            const icns = parseResourceFork(fork)["icns"];
            expect(Object.keys(icns).map(Number).sort((a, b) => a - b))
                .toEqual([-16455, -1, 32767]);
            expect(icns[-16455].id).toEqual(-16455);
            expect(icns[-1].id).toEqual(-1);
            expect(icns[49081]).toBeUndefined();
        });

        /**
         * The whole map, not a sample of it: every type, every id, every
         * name (MacRoman and empty) and every byte comes back exactly as
         * written, across the full signed 16-bit id range and a payload
         * bigger than one resource-data length word's low half. This is
         * the contract the synthetic Nova data set (novaparse's
         * src/synthetic) is built on.
         */
        it("round-trips a whole ResourceMap exactly", () => {
            const bigPayload = Array.from({ length: 70000 },
                (_, i) => (i * 7 + 3) & 0xff);
            const specs = [
                { type: "sÿst", id: 128, name: "Thessaly Reach", data: [1, 2] },
                { type: "sÿst", id: 32767, name: "", data: [] },
                { type: "sÿst", id: -32768, name: "Ålesund–Æther", data: [255] },
                { type: "spöb", id: 128, name: "Port", data: [9, 8, 7] },
                { type: "rlëD", id: 1000, name: "Skiff sprite", data: bigPayload },
                { type: "STR#", id: 4000, data: [0, 1, 3, 65, 66, 67] },
                { type: "snd ", id: 200, name: "x", data: [0] },
            ];
            const parsed = parseResourceFork(buildResourceFork(specs));

            const asMap = (map: ResourceMap) => Object.fromEntries(
                Object.keys(map).sort().map(type => [type,
                    Object.values(map[type])
                        .sort((a, b) => a.id - b.id)
                        .map(r => ({ id: r.id, name: r.name, data: r.shortArray })),
                ]));
            const expected = Object.fromEntries(
                [...new Set(specs.map(s => s.type))].sort().map(type => [type,
                    specs.filter(s => s.type === type)
                        .sort((a, b) => a.id - b.id)
                        .map(s => ({ id: s.id, name: s.name ?? "", data: [...s.data] })),
                ]));
            expect(asMap(parsed)).toEqual(expected);
        });

        it("is deterministic: the same specs give the same bytes", () => {
            const specs = [
                { type: "wëap", id: 128, name: "blaster", data: [1, 2, 3] },
                { type: "shïp", id: 130, name: "Skiff", data: [4] },
            ];
            const a = new Uint8Array(buildResourceFork(specs));
            const b = new Uint8Array(buildResourceFork(specs));
            expect([...a]).toEqual([...b]);
        });

        it("refuses a resource type that is not four MacRoman bytes", () => {
            expect(() => buildResourceFork([{ type: "abc", id: 1, data: [] }]))
                .toThrowError(/must be 4 bytes/);
        });
    });
});
