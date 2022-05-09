import { isRez, readResourceFork, readRez, ResourceMap } from "resource_fork";
import * as fs from 'fs';

const runfiles = require(process.env['BAZEL_NODE_RUNFILES_HELPER'] as string) as typeof require;


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

describe("resourceFork", function() {
    describe("readResourceFork", () => {
        describe("reading .ndat", () => {
            testResourceFork(() => {
                // pretend data fork is resource fork for compatability with other OSes
                const dataPath = runfiles.resolve('novajs/resource_fork/test.ndat');
                return readResourceFork(dataPath, false);
            });
        })
        describe("reading .rez", () => {
            testResourceFork(() => {
                const dataPath = runfiles.resolve('novajs/resource_fork/test.rez');
                return readResourceFork(dataPath, false);
            });
        });
    });

    describe("isRez", () => {
        it("returns true for rez files", async () => {
            const rezPath = runfiles.resolve('novajs/resource_fork/test.rez');
            const rezFile = await fs.promises.readFile(rezPath);
            const rezView = new DataView(rezFile.buffer);
            expect(isRez(rezView)).toBeTrue();
        });

        it("returns false for other files", async () => {
            const filePath = runfiles.resolve('novajs/resource_fork/test.ndat');
            const file = await fs.promises.readFile(filePath);
            const dataView = new DataView(file.buffer);
            expect(isRez(dataView)).toBeFalse();
        });
    });

    describe('readRez', () => {
        testResourceFork(async () => {
            const rezPath = runfiles.resolve('novajs/resource_fork/test.rez');
            const rezFile = await fs.promises.readFile(rezPath);
            const rezView = new DataView(rezFile.buffer);
            return readRez(rezView);
        });
    });
});
