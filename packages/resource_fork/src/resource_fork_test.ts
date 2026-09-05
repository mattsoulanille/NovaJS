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
    });
});
