import { readResourceFork, ResourceMap } from "resource_fork";

const runfiles = require(process.env['BAZEL_NODE_RUNFILES_HELPER'] as string) as typeof require;

describe("resourceFork", function() {
    let resources: ResourceMap;
    beforeEach(async () => {
      // pretend data fork is resource fork for compatability with other OSes
      const dataPath = runfiles.resolve('novajs/resource_fork/test.ndat');
      resources = await readResourceFork(dataPath, false);
    });

    describe("readResourceFork()", () => {
      it('gets the types of resources', () => {
        expect(resources.hasOwnProperty('wëap')).toBeTrue();
      });

      it('gets the names of resources', () => {
        expect(resources['wëap'][128].name).toEqual('blaster');;
      });

      it("gets data from resources", () => {
        var data = 'ff ff 00 1e 00 ea 00 7b ff ff 00 01 ff ff ff ff 00 00 ff ff 01 59 ff ff 00 00 00 00 00 00 00 00 ff ff 00 00 ff ff ff ff ff ff ff ff 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 ff ff 00 00 00 00 ff ff 00 00 00 00 ff ff ff ff ff ff 00 00 00 00 00 00 ff ff ff ff ff ff 00 00 00 00 00 00 00 00 00 00 00 00 00 00 ff ff 00 00 ff ff 00 00 00 00 ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff';
        expect(resources['wëap'][128].hexString).toEqual(data);
      });
    });
});

