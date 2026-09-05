import "jasmine";
import { SoundFileParse } from "../../src/parsers/sound_file_parse.js";
import { SndResource } from "../../src/resource_parsers/snd_resource.js";
import { defaultIDSpace } from "../resource_parsers/default_id_space.js";
import { ResourceBuilder } from "../resource_parsers/resource_builder.js";

/** The rate every stock combat and interface sound is stored at. */
const NOVA_RATE = 11127 + 17 / 64;

/** Builds a format-1 `snd ` resource holding one 8-bit sampled sound. */
function buildSnd(rate: number, samples: number[]): SndResource {
    const b = new ResourceBuilder()
        .uint16(1)              // format 1
        .uint16(0)              // no data formats
        .uint16(1)              // one command
        .uint16(0x8000 | 81)    // bufferCmd, data offset
        .uint16(0)
        .uint32(14)             // offset of the sampled sound header
        .uint32(0)              // samplePtr
        .uint32(samples.length)
        .uint32(Math.round(rate * (1 << 16)))
        .uint32(0).uint32(0)    // loopStart, loopEnd
        .uint8(0)               // encode: stdSH
        .uint8(60);             // baseFrequency
    b.array(samples, (v) => b.uint8(v));
    return new SndResource(b.resource("snd ", 128), defaultIDSpace);
}

/** An 8-bit unsigned sine at `freq`, `frames` long. */
function tone(freq: number, rate: number, frames: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < frames; i++) {
        out.push(Math.round(128 + 100 * Math.sin(2 * Math.PI * freq * i / rate)));
    }
    return out;
}

interface Wav {
    audioFormat: number;
    channels: number;
    rate: number;
    byteRate: number;
    blockAlign: number;
    bitsPerSample: number;
    /** Samples normalized to [-1, 1), whatever the stored depth. */
    samples: number[];
    /** The raw bytes of the data chunk. */
    data: Uint8Array;
}

function readWav(buffer: ArrayBuffer): Wav {
    const view = new DataView(buffer);
    const tag = (offset: number, length: number) => {
        let s = "";
        for (let i = 0; i < length; i++) {
            s += String.fromCharCode(view.getUint8(offset + i));
        }
        return s;
    };
    expect(tag(0, 4)).toEqual("RIFF");
    expect(view.getUint32(4, true)).toEqual(buffer.byteLength - 8);
    expect(tag(8, 4)).toEqual("WAVE");
    expect(tag(12, 4)).toEqual("fmt ");
    expect(view.getUint32(16, true)).toEqual(16);
    expect(tag(36, 4)).toEqual("data");

    const bitsPerSample = view.getUint16(34, true);
    const dataBytes = view.getUint32(40, true);
    expect(dataBytes).toEqual(buffer.byteLength - 44);

    const samples: number[] = [];
    if (bitsPerSample === 8) {
        for (let i = 0; i < dataBytes; i++) {
            samples.push((view.getUint8(44 + i) - 128) / 128);
        }
    } else {
        for (let i = 0; i < dataBytes; i += 2) {
            samples.push(view.getInt16(44 + i, true) / 32768);
        }
    }
    return {
        audioFormat: view.getUint16(20, true),
        channels: view.getUint16(22, true),
        rate: view.getUint32(24, true),
        byteRate: view.getUint32(28, true),
        blockAlign: view.getUint16(32, true),
        bitsPerSample,
        samples,
        data: new Uint8Array(buffer, 44),
    };
}

/**
 * The magnitude of the DFT of `samples` at `freq`, relative to a full-scale
 * sine (so an untouched unit-amplitude tone comes back as its own amplitude).
 * Hann-windowed, which keeps a non-integer number of cycles from smearing
 * into a false rolloff.
 */
function magnitudeAt(samples: number[], rate: number, freq: number): number {
    let re = 0;
    let im = 0;
    let windowSum = 0;
    for (let i = 0; i < samples.length; i++) {
        const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / samples.length);
        const phase = 2 * Math.PI * freq * i / rate;
        re += samples[i] * w * Math.cos(phase);
        im -= samples[i] * w * Math.sin(phase);
        windowSum += w;
    }
    return 2 * Math.sqrt(re * re + im * im) / windowSum;
}

describe("SoundFileParse", () => {
    it("Should emit a WAV at the sound's own rate and depth", async () => {
        const samples = tone(1000, NOVA_RATE, 4096);
        const wav = readWav(await SoundFileParse(buildSnd(NOVA_RATE, samples)));

        expect(wav.audioFormat).toEqual(1);     // WAVE_FORMAT_PCM
        expect(wav.channels).toEqual(1);
        expect(wav.bitsPerSample).toEqual(8);
        // The header's rate field is an integer; 11127.27 Hz rounds to
        // 11127 Hz, a 24 ppm (0.04 cent) shift.
        expect(wav.rate).toEqual(11127);
        expect(wav.blockAlign).toEqual(1);
        expect(wav.byteRate).toEqual(11127);
    });

    it("Should carry 8-bit samples through byte for byte", async () => {
        // No resampling, no requantization, no codec: the data chunk of an
        // 8-bit sound is the resource's own bytes.
        const samples = tone(4800, NOVA_RATE, 2048);
        const wav = readWav(await SoundFileParse(buildSnd(NOVA_RATE, samples)));
        expect(Array.from(wav.data)).toEqual(samples);
    });

    it("Should keep the passband flat right up to the source's Nyquist", async () => {
        // The regression this pins: sounds used to be linearly interpolated
        // from 11127.27 Hz onto MP3's nearest legal rate (12000 Hz), and at
        // a ratio that close to 1:1 linear interpolation is a low-pass whose
        // gain sweeps with the fractional phase -- measured at -3.5 dB at
        // 4 kHz and -6 dB at 5.5 kHz, which is audibly muffled. Every tone
        // below the source's Nyquist (5563 Hz) must now come back at the
        // amplitude it went in at.
        const amplitude = 100 / 128;
        const tolerance = 0.5;  // dB
        for (const freq of [200, 1000, 2000, 3000, 4000, 5000, 5500]) {
            const wav = readWav(await SoundFileParse(
                buildSnd(NOVA_RATE, tone(freq, NOVA_RATE, 8192))));
            const measured = magnitudeAt(wav.samples, wav.rate, freq);
            const db = 20 * Math.log10(measured / amplitude);
            expect(Math.abs(db))
                .withContext(`${freq} Hz is ${db.toFixed(2)} dB off`)
                .toBeLessThan(tolerance);
        }
    });

    it("Should preserve an impulse rather than smearing it", async () => {
        // A single-sample impulse is the sharpest thing a source can hold;
        // any interpolation or filtering in the path spreads it across
        // neighbours. Digital silence is 0x80.
        const samples = new Array(64).fill(0x80);
        samples[32] = 0xff;
        const wav = readWav(await SoundFileParse(buildSnd(NOVA_RATE, samples)));

        expect(wav.samples.length).toEqual(64);
        for (let i = 0; i < 64; i++) {
            expect(wav.samples[i]).toEqual(i === 32 ? 127 / 128 : 0);
        }
    });

    it("Should emit an empty WAV for a sound it cannot parse", async () => {
        const unparseable = new SndResource(
            new ResourceBuilder().uint16(9).uint16(0).resource("snd ", 128),
            defaultIDSpace);
        const wav = readWav(await SoundFileParse(unparseable));
        expect(wav.samples.length).toEqual(0);
    });
});
