import "jasmine";
import { readResourceFork, ResourceMap } from "resource_fork";
import { SndResource } from "../../src/resource_parsers/snd_resource.js";
import { defaultIDSpace } from "./default_id_space.js";
import { ima4, pcm8 } from "./expected_sounds.js";
import { ResourceBuilder } from "./resource_builder.js";

import { resolveFixture } from "../../test/fixtures.js";

/**
 * Builds a format-1 `snd ` resource carrying one immediate bufferCmd, so a
 * test can hand the parser an exact sampled sound header plus payload.
 */
function buildSnd(sampleHeader: (b: ResourceBuilder) => ResourceBuilder): SndResource {
    const b = new ResourceBuilder()
        .uint16(1)      // format 1
        .uint16(0)      // no data formats
        .uint16(1)      // one command
        .uint16(0x8000 | 81)  // bufferCmd, data offset (not pointer)
        .uint16(0)      // param1
        .uint32(14);    // param2: offset of the sampled sound header
    sampleHeader(b);
    return new SndResource(b.resource("snd ", 128), defaultIDSpace);
}

/** A standard (uncompressed 8-bit) sampled sound header. */
function stdSoundHeader(b: ResourceBuilder, rate: number, samples: number[]) {
    return b
        .uint32(0)              // samplePtr: 0 = data follows the header
        .uint32(samples.length) // length, in frames
        .uint32(Math.round(rate * (1 << 16)))  // sampleRate, Fixed 16.16
        .uint32(0).uint32(0)    // loopStart, loopEnd
        .uint8(0)               // encode: stdSH
        .uint8(60)              // baseFrequency
        .array(samples, (v) => b.uint8(v));
}

/** A compressed sampled sound header holding `packets` ima4 packets. */
function ima4SoundHeader(b: ResourceBuilder, rate: number, packets: number[][]) {
    b
        .uint32(0)              // samplePtr
        .uint32(1)              // numChannels
        .uint32(Math.round(rate * (1 << 16)))
        .uint32(0).uint32(0)    // loopStart, loopEnd
        .uint8(0xfe)            // encode: cmpSH
        .uint8(60)              // baseFrequency
        .uint32(packets.length) // numFrames, i.e. ima4 packets
        .skip(10)               // AIFFSampleRate (80-bit extended, unused)
        .uint32(0)              // markerChunk
        // An OSType, not a C string: four characters and no terminator.
        .array([...'ima4'].map((c) => c.charCodeAt(0)), (v) => b.uint8(v))
        .uint32(0)              // futureUse2
        .uint32(0)              // stateVars
        .uint32(0)              // leftOverSamples
        .int16(0)               // compressionID
        .int16(34)              // packetSize
        .int16(0)               // snthID
        .int16(16);             // sampleSize
    for (const packet of packets) {
        b.array(packet, (v) => b.uint8(v));
    }
    return b;
}

/**
 * One ima4 packet: a 2-byte preamble (9-bit predictor, 7-bit step index)
 * followed by 32 bytes holding 64 nibbles, low nibble first.
 */
function ima4Packet(predictor: number, stepIndex: number, nibbles: number[]): number[] {
    const header = ((predictor & 0xff80) | (stepIndex & 0x7f)) & 0xffff;
    const bytes = [header >> 8, header & 0xff];
    for (let i = 0; i < 64; i += 2) {
        bytes.push((nibbles[i] & 0xf) | ((nibbles[i + 1] & 0xf) << 4));
    }
    return bytes;
}

describe("SndResource", () => {
    let s1: SndResource;
    let s2: SndResource;
    let rf: ResourceMap;

    // Snds don't depend on other resources.
    const idSpace = defaultIDSpace;

    beforeEach(async () => {
        const dataPath = resolveFixture("resource_examples/snd.ndat");
        rf = await readResourceFork(dataPath, false);

        const snds = rf['snd '];
        s1 = new SndResource(snds[128], idSpace);
        s2 = new SndResource(snds[129], idSpace);

    });
    it("Should parse the 8 bit pcm sound", () => {
        expect(s1.sound.rate).toEqual(48000);
        expect(s1.sound.channels).toEqual(1);
        expect(s1.sound.samples.length).toEqual(8192);
        expect(s1.sound.samples).toEqual(
            // 0x80 is digital silence for an 8-bit Mac sound, so it must map
            // to exactly 0 -- centring on 127.5 instead leaves a small DC
            // offset on every sound in the game.
            pcm8.map((v) => (v - 128) / 128));
    });

    it("Should hand back the 8 bit sound's bytes untouched", () => {
        // The served asset is these bytes verbatim (WAV stores 8-bit samples
        // unsigned, exactly as the Mac format does), so any requantization
        // or filtering creeping into the parser shows up here.
        const pcm = s1.sound.pcm;
        expect(pcm.bitsPerSample).toEqual(8);
        expect(Array.from(pcm.data)).toEqual(pcm8);
    });

    it("Should parse the ima4 compressed sound", () => {
        expect(s2.sound.rate).toEqual(48000);
        expect(s2.sound.channels).toEqual(1);
        expect(s2.sound.samples.length).toEqual(8192);
        const pcm = s2.sound.pcm;
        expect(pcm.bitsPerSample).toEqual(16);
        expect(Array.from(pcm.data)).toEqual(ima4);
        expect(s2.sound.samples).toEqual(ima4.map((v) => v / 32768));
    });

    it("Should read the sample rate as unsigned Fixed 16.16", () => {
        // 11127.27 Hz -- the rate every stock combat and interface sound uses
        // -- is 0x2B75_45D1, whose top bit is clear, but 44100 Hz and up set
        // it, and reading the field signed would wrap them negative.
        const rate = 11127 + 17 / 64;
        expect(buildSnd((b) => stdSoundHeader(b, rate, [0x80, 0x80]))
            .sound.rate).toEqual(rate);
        expect(buildSnd((b) => stdSoundHeader(b, 48000, [0x80, 0x80]))
            .sound.rate).toEqual(48000);
    });

    it("Should saturate an ima4 predictor that runs past full scale", () => {
        // Nibble 7 is the largest positive step, so 64 of them in a row drive
        // the predictor far beyond 16 bits. IMA is a feedback coder and the
        // encoder assumed the decoder would clamp; one that doesn't never
        // recovers, and 88 of the 227 stock sounds decode past full scale
        // (snd 130 "Warp out" reaching 2.02x) without this.
        const up = buildSnd((b) => ima4SoundHeader(b, 22050,
            [ima4Packet(0, 40, new Array(64).fill(7))])).sound;
        const down = buildSnd((b) => ima4SoundHeader(b, 22050,
            [ima4Packet(0, 40, new Array(64).fill(0xf))])).sound;

        expect(up.pcm.data.length).toEqual(64);
        expect(Math.max(...Array.from(up.pcm.data))).toEqual(32767);
        expect(Math.min(...Array.from(down.pcm.data))).toEqual(-32768);
        for (const v of up.samples) {
            expect(v).toBeLessThan(1);
        }
        for (const v of down.samples) {
            expect(v).toBeGreaterThanOrEqual(-1);
        }
    });

    it("Should decode one ima4 packet per numFrames", () => {
        // `numFrames` in a compressed sound header counts packets, not
        // samples: 34 bytes in, 64 samples out.
        const packets = [
            ima4Packet(0, 0, new Array(64).fill(0)),
            ima4Packet(0, 0, new Array(64).fill(1)),
            ima4Packet(0, 0, new Array(64).fill(2)),
        ];
        expect(buildSnd((b) => ima4SoundHeader(b, 22050, packets))
            .sound.pcm.data.length).toEqual(3 * 64);
    });
});
