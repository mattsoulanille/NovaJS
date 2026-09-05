import { ParsedSound, SndResource } from '../resource_parsers/snd_resource.js';

/**
 * The `snd ` resources are served to the browser as RIFF/WAVE, at the rate
 * and bit depth they are stored at.
 *
 * This used to be MP3, which cost three things the game could not afford:
 *
 *  - MP3 only supports a fixed grid of sample rates, so the 11127.27 Hz
 *    sounds — every weapon, explosion and interface sound in the stock game —
 *    were linearly interpolated onto the nearest legal rate (12000 Hz) first.
 *    A ~1.08x ratio is the worst case for linear interpolation: its gain
 *    sweeps with the fractional phase, averaging -3.5 dB at 4 kHz and -6.2 dB
 *    at 5.5 kHz across those sounds. That is the muffling.
 *  - The codec then took another 0.4-1.4 dB off the top on everything.
 *  - Worst of all, MP3 has encoder and decoder delay. Without a gapless
 *    playback path to strip it, every weapon and explosion sound started
 *    92 ms late (50 ms for the 22050 Hz ones), and every looping sound had
 *    that gap on each repeat.
 *
 * WAV keeps the original samples exactly, starts on the first sample, and
 * lets the browser's own windowed-sinc resampler take them to the
 * AudioContext rate — the one resampling step that is unavoidable, and the
 * one that is done well.
 *
 * The cost is size: the stock sound set is 17.5 MiB as WAV against 6.8 MiB
 * as MP3, all of it in the 178 ima4 sounds (the 8-bit ones are 0.69 MiB
 * either way). These are fetched per id, only when a sound actually plays,
 * and are cached by the browser, so it buys correctness cheaply.
 */
export async function SoundFileParse(sound: SndResource): Promise<ArrayBuffer> {
    let rate: number;
    let channels: number;
    let pcm: ParsedSound['pcm'];
    try {
        ({ rate, channels, pcm } = sound.sound);
    } catch (e) {
        console.warn(e);
        return buildWav(new Uint8Array(0), 8, 1, 8000);
    }
    return buildWav(pcm.data, pcm.bitsPerSample, channels, rate);
}

/**
 * Wraps PCM frames in a canonical 44-byte RIFF/WAVE header.
 *
 * WAV stores 8-bit samples unsigned and 16-bit samples signed, which is
 * exactly how the Mac sound formats store them, so the payload is a straight
 * copy in both cases. The sample rate field is an integer, so the Mac's
 * 11127.27 Hz becomes 11127 Hz — a 24 ppm (0.04 cent) pitch shift, far below
 * anything audible and the only concession WAV forces.
 */
export function buildWav(data: Uint8Array | Int16Array, bitsPerSample: 8 | 16,
    channels: number, rate: number): ArrayBuffer {
    const bytesPerFrame = channels * (bitsPerSample >> 3);
    const dataBytes = data.length * (bitsPerSample >> 3);
    const buffer = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buffer);
    const ascii = (offset: number, s: string) => {
        for (let i = 0; i < s.length; i++) {
            view.setUint8(offset + i, s.charCodeAt(i));
        }
    };
    ascii(0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    ascii(8, 'WAVE');
    ascii(12, 'fmt ');
    view.setUint32(16, 16, true);           // PCM fmt chunk size
    view.setUint16(20, 1, true);            // WAVE_FORMAT_PCM
    view.setUint16(22, channels, true);
    view.setUint32(24, Math.round(rate), true);
    view.setUint32(28, Math.round(rate) * bytesPerFrame, true); // byte rate
    view.setUint16(32, bytesPerFrame, true);
    view.setUint16(34, bitsPerSample, true);
    ascii(36, 'data');
    view.setUint32(40, dataBytes, true);
    if (bitsPerSample === 8) {
        new Uint8Array(buffer, 44).set(data as Uint8Array);
    } else {
        // Written a sample at a time rather than by typed-array copy so the
        // little-endian layout holds on a big-endian host too.
        for (let i = 0; i < data.length; i++) {
            view.setInt16(44 + i * 2, data[i], true);
        }
    }
    return buffer;
}
