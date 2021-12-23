import "jasmine";
import { readResourceFork, ResourceMap } from "resourceforkjs";
import { SndResource } from "../../src/resource_parsers/SndResource";
import { defaultIDSpace } from "./DefaultIDSpace";
import { ima4, pcm8 } from "./expected_sounds";

const runfiles = require(process.env['BAZEL_NODE_RUNFILES_HELPER'] as string) as typeof require;

describe("SndResource", function() {
    let s1: SndResource;
    let s2: SndResource;
    let rf: ResourceMap;

    // Snds don't depend on other resources.
    const idSpace = defaultIDSpace;

    beforeEach(async function() {
        const dataPath = runfiles.resolve("novajs/nova_parse/test/resource_parsers/files/snd.ndat");
        rf = await readResourceFork(dataPath, false);

        const snds = rf['snd '];
        s1 = new SndResource(snds[128], idSpace);
        s2 = new SndResource(snds[129], idSpace);

    });
    it("Should parse the 8 bit pcm sound", function() {
        expect(s1.sound.rate).toEqual(48000);
        expect(s1.sound.samples.length).toEqual(8192);
        expect(s1.sound.samples).toEqual(
            pcm8
                .map((v) => (v - 127.5) / 127.5));
    });
    it("Should parse the ima4 compressed sound", function() {
        expect(s2.sound.rate).toEqual(48000);
        expect(s2.sound.samples.length).toEqual(8192);
        expect(s2.sound.samples.map((v) => v * (1 << 18))).toEqual(
            ima4
        );
    });
});
