import { BaseResource } from "./nova_resource_base.js";
import { NovaResources } from "./resource_holder_base.js";
import { Resource } from "resource_fork";


class Reader {
    //buf: Buffer;
    constructor(public dat: DataView, public i = 0) { }
    /*if (dat instanceof Buffer) {
            this.buf = dat;
        } else {
            this.buf = Buffer.from(dat.buffer.slice(dat.byteOffset, dat.byteOffset + dat.byteLength));
        }
    }*/
    copy(): Reader {
        return new Reader(this.dat, this.i);
    }
    skip(n: number) {
        this.i += n; return this;
    }
    static sizes = { b: 8, h: 16, i: 32, B: 8, H: 16, I: 32 };
    static signedness = { b: 'I', h: 'I', i: 'I', B: 'Ui', H: 'Ui', I: 'Ui' };
    read(p: 'b' | 'h' | 'i' | 'B' | 'H' | 'I'): number {
        const r = ((this.dat as any)[`get${Reader.signedness[p]}nt${Reader.sizes[p]}`] as (p: number) => number)(this.i);
        this.i += Reader.sizes[p] >> 3;
        return r;
    }
    readStr(n: number): string {
        let r: string;
        for (r = ""; r.length < n; r += String.fromCharCode(this.read('B'))) { }
        return r;
    }
    /*read(p?: string) {
        if (!p) {
            p = "B";
        }
        const d = sizeOf(p);
        const r = unpackFrom(p, this.buf, true, this.i);
        this.i += d;
        return r
    }*/
}

/** An ima4 packet is 34 bytes in: a 2-byte preamble plus 64 nibbles. */
const IMA4_SAMPLES_PER_PACKET = 64;
const ima_index_table = [
    -1, -1, -1, -1, 2, 4, 6, 8,
    -1, -1, -1, -1, 2, 4, 6, 8];
const ima_step_table = [
    7, 8, 9, 10, 11, 12, 13, 14, 16, 17,
    19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
    50, 55, 60, 66, 73, 80, 88, 97, 107, 118,
    130, 143, 157, 173, 190, 209, 230, 253, 279, 307,
    337, 371, 408, 449, 494, 544, 598, 658, 724, 796,
    876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066,
    2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358,
    5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899,
    15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767];
/**
 * Decodes one 34-byte QuickTime IMA4 packet into 64 signed 16-bit samples.
 *
 * This follows the IMA/DVI ADPCM reference exactly, in integer arithmetic:
 * `diff = step/8 + (mag&4 ? step : 0) + (mag&2 ? step/2 : 0) + (mag&1 ?
 * step/4 : 0)`, each term truncated toward zero, and the predictor CLAMPED
 * to the signed 16-bit range after every nibble.
 *
 * The clamp is not cosmetic. IMA is a feedback coder: the encoder chose each
 * nibble against a predictor it knew would saturate, so a decoder that lets
 * the predictor run past full scale never comes back — it drifts for the rest
 * of the packet. Before this was clamped, 88 of the 227 stock sounds decoded
 * past full scale (snd 130 "Warp out" peaked at 2.02x, with 17% of its
 * samples over), which then clipped hard on the way out.
 */
function* read_ima4(r: Reader): IterableIterator<number> {
    const c = r.read("h");
    let si = c & 0x7f;
    let p = c - si;
    if (si > 88) { si = 88; }
    for (let i = 0; i < 32; i++) {
        const b = r.read("B");
        for (let ni = 0; ni < 2; ni++) {
            const v = ni ? b >> 4 : b & 0xf;
            const step = ima_step_table[si];
            let diff = step >> 3;
            if (v & 4) { diff += step; }
            if (v & 2) { diff += step >> 1; }
            if (v & 1) { diff += step >> 2; }
            if (v & 8) { p -= diff; } else { p += diff; }
            if (p > 32767) { p = 32767; } else if (p < -32768) { p = -32768; }
            si += ima_index_table[v];
            if (si > 88) { si = 88; } else if (si < 0) { si = 0; }
            yield p;
        }
    }
}
type CompressedHeaderSample = Sample & {
    r: Reader,
    ptr: number,
    length: number,
    rate: number,
    loop: [number, number],
    encoding: number,
    baseFreq: number,
    nchannels: number,

    format: string,
    statVars: number,
    leftOverSamples: number,
    compressionID: number,
    packetSize: number,
    snthID: number,
    AIFFRate: bigint,
    markerChunk: number,
    future2: number,
    sampleSize: number,

    data: Reader,
}
function isCompressedHeader(s: Sample): s is CompressedHeaderSample {
    return s.encoding === 0xfe;
}
class Sample {
    r: Reader;
    ptr: number;
    length: number;
    rate: number;
    loop: [number, number];
    encoding: number;
    baseFreq: number;
    nchannels: number;

    AIFFRate?: bigint;
    markerChunk?: number;
    instrumentChunk?: number;
    AESRecording?: number;
    sampleSize?: number;
    future1?: number;
    future2?: number;
    future3?: number;
    future4?: number;

    format?: string;
    statVars?: number;
    leftOverSamples?: number;
    compressionID?: number;
    packetSize?: number;
    snthID?: number;

    data: Reader;
    constructor(r: Reader) {
        this.r = r.copy();
        this.ptr = r.read("I");
        if (this.ptr !== 0) {
            throw new Error(`non immediate pointer not supported (expected 0, got ${this.ptr})`);
        }
        this.length = r.read("I");
        this.rate = r.read("I") / (1 << 16);
        this.loop = [r.read("I"), r.read("I")];
        this.encoding = r.read("B");
        this.baseFreq = r.read("B");
        this.nchannels = 1;
        switch (this.encoding) {
            case (0xff):
                this.nchannels = this.length;
                this.length = r.read("I");
                this.AIFFRate = BigInt(0);
                for (let i = 0; i < 10; i++) {
                    this.AIFFRate <<= BigInt(8);
                    this.AIFFRate |= BigInt(r.read("B"));
                }
                this.markerChunk = r.read("I");
                this.instrumentChunk = r.read("I");
                this.AESRecording = r.read("I");
                this.sampleSize = r.read("h");
                this.future1 = r.read("h");
                this.future2 = r.read("i");
                this.future3 = r.read("i");
                this.future4 = r.read("i");
                break;
            case (0xfe):
                this.nchannels = this.length;
                this.length = r.read("I")
                this.AIFFRate = BigInt(0);
                for (let i = 0; i < 10; i++) {
                    this.AIFFRate <<= BigInt(8);
                    this.AIFFRate |= BigInt(r.read("B"));
                }

                this.markerChunk = r.read("I");
                this.format = r.readStr(4);
                this.future2 = r.read("I");
                this.statVars = r.read("I");
                this.leftOverSamples = r.read("I");
                this.compressionID = r.read("h");
                this.packetSize = r.read("h");
                this.snthID = r.read("h");
                this.sampleSize = r.read("h");
                break;
            case (0):
                break;
            default:
                throw new Error(`unknown encoding ${this.encoding}`);
        }

        this.data = r.copy();
    }
    /**
     * The sample data in the depth it is stored at, ready to be handed to a
     * consumer verbatim: unsigned bytes for a plain 8-bit (stdSH) sound,
     * signed 16-bit for an ima4-compressed one. Nothing is resampled,
     * requantized or filtered — the whole point is that this is the original
     * waveform, bit for bit where the source is already PCM.
     */
    pcm(): { bitsPerSample: 8, data: Uint8Array } | { bitsPerSample: 16, data: Int16Array } {
        const r = this.data.copy();
        if (this.encoding === 0) {
            const data = new Uint8Array(this.length);
            for (let i = 0; i < this.length; i++) {
                data[i] = r.read("B");
            }
            return { bitsPerSample: 8, data };
        }
        if (isCompressedHeader(this)) {
            if (this.format === "ima4") {
                // `length` counts ima4 packets, each 34 bytes in / 64 samples out.
                const data = new Int16Array(this.length * IMA4_SAMPLES_PER_PACKET);
                let i = 0;
                for (let packet = 0; packet < this.length; packet++) {
                    for (const s of read_ima4(r)) {
                        data[i++] = s;
                    }
                }
                return { bitsPerSample: 16, data };
            }
            throw new Error(`unknown compression format ${this.format} (currently only ima4 supported)`);
        }
        throw new Error(`long headers unsupported`);
    }

    /**
     * The same waveform as {@link pcm}, normalized to floats in [-1, 1).
     * Both depths use the textbook mapping (`(byte - 128) / 128` for 8-bit
     * unsigned, `int / 32768` for 16-bit signed) so that digital silence —
     * 0x80 for an 8-bit Mac sound — lands on exactly 0 rather than a small
     * positive DC offset.
     */
    *[Symbol.iterator](): IterableIterator<number> {
        yield* Sample.normalize(this.pcm());
    }

    static *normalize({ bitsPerSample, data }: ReturnType<Sample['pcm']>):
        IterableIterator<number> {
        const scale = bitsPerSample === 8 ? 128 : 32768;
        const bias = bitsPerSample === 8 ? 128 : 0;
        for (const v of data) {
            yield (v - bias) / scale;
        }
    }
}

const COMMANDS = {
    nullCmd: 0,         //{do nothing}                                        
    quietCmd: 3,        //{stop a sound that is playing}                      
    flushCmd: 4,        //{flush a sound channel}                             
    reInitCmd: 5,       //{reinitialize a sound channel}                      
    waitCmd: 10,        //{suspend processing in a channel}                   
    pauseCmd: 11,       //{pause processing in a channel}                     
    resumeCmd: 12,      //{resume processing in a channel}                    
    callBackCmd: 13,    //{execute a callback procedure}                      
    syncCmd: 14,        //{synchronize channels}                              
    availableCmd: 24,   //{see if initialization options are supported}       
    versionCmd: 25,     //{determine version}                                 
    totalLoadCmd: 26,   //{report total CPU load}                             
    loadCmd: 27,        //{report CPU load for a new channel}                 
    freqDurationCmd: 40,//{play a note for a duration}                        
    restCmd: 41,        //{rest a channel for a duration}                     
    freqCmd: 42,        //{change the pitch of a sound}                       
    ampCmd: 43,         //{change the amplitude of a sound}                   
    timbreCmd: 44,      //{change the timbre of a sound}                      
    getAmpCmd: 45,      //{ get the amplitude of a sound }                      
    volumeCmd: 46,      //{ set volume}                                        
    getVolumeCmd: 47,   //{ get volume}                                        
    waveTableCmd: 60,   //{ install a wave table as a voice }                   
    soundCmd: 80,       //{ install a sampled sound as a voice }                
    bufferCmd: 81,      //{ play a sampled sound }                              
    rateCmd: 82,        //{ set the pitch of a sampled sound }                  
    getRateCmd: 85,     //{ get the pitch of a sampled sound }
};

/**
 * A decoded `snd ` resource: the original waveform at its original rate.
 *
 * `samples` is the normalized float view (handy for tests and analysis);
 * `pcm` is the same waveform at its stored depth, which is what gets served.
 */
export interface ParsedSound {
    /** Frames per second, from the sampled sound header's Fixed 16.16 rate. */
    rate: number;
    channels: number;
    samples: number[];
    pcm: { bitsPerSample: 8, data: Uint8Array } | { bitsPerSample: 16, data: Int16Array };
}

export class SndResource extends BaseResource {
    constructor(resource: Resource, idSpace: NovaResources) {
        super(resource, idSpace);
    }
    // http://mirror.informatimago.com/next/developer.apple.com/documentation/mac/Sound/Sound-135.html
    // http://mirror.informatimago.com/next/developer.apple.com/documentation/mac/Sound/Sound-60.html#MARKER-9-400
    // header: http://mirror.informatimago.com/next/developer.apple.com/documentation/mac/Sound/Sound-74.html#MARKER-9-657
    // sound commands: http://mirror.informatimago.com/next/developer.apple.com/documentation/mac/Sound/Sound-47.html#HEADING47-0
    // http://mirror.informatimago.com/next/developer.apple.com/documentation/mac/Sound/Sound-44.html#HEADING44-0

    //ok, so, nova only uses ima4 and 8 bit pcm samples, so lets just read those
    get sound(): ParsedSound {
        const r = new Reader(this.data);
        const format = r.read("H");
        if (format === 1) {
            const numberOfDataFormats = r.read("H");
            if (numberOfDataFormats !== 0) {
                const firstDataFormatID = r.read("H");
                const initOptionForChannel = r.read("I");
            }
        } else {
            if (format == 2) {
                // refcount is ignored by sound manager
                const referenceCount = r.read("H");
                //console.warn("snd format 2 is obsolete.");
            } else {
                throw new Error(`snd format unknown:${format}`);
            }
        }
        const numCommands = r.read("H");
        if (numCommands !== 1) {
            throw new Error("only immediate buffer command accepted, (got !== 1 cmds)");
        }
        const command = { id: r.read("H"), arg1: r.read('H'), arg2: r.read('I'), offset: false };
        command.offset = (command.id & 0x8000) !== 0;
        command.id &= 0x7fff;
        if (command.id != COMMANDS.bufferCmd || !command.offset) {
            throw new Error(`only immediate buffer command accepted, (got cmd id:${command.id},arg1:${command.arg1},arg2:${command.arg2},offset:${command.offset})`);
        }
        const bhr = new Reader(this.data).skip(command.arg2);
        const sample = new Sample(bhr);

        // Deliberately NOT resampled. Every stock combat and interface sound
        // is an 11127.27 Hz 8-bit sample, and this used to be forced onto the
        // nearest rate MP3 allows (12000 Hz) with linear interpolation. At a
        // ratio that close to 1:1 linear interpolation is a savage low-pass
        // whose gain sweeps with the fractional phase — measured across those
        // sounds at -3.5 dB at 4 kHz and -6.2 dB at 5.5 kHz, which is exactly
        // the "muffled, missing the highs" character. Handing the browser the
        // original rate instead lets its own windowed-sinc resampler do the
        // job, losslessly in the source's band.
        const pcm = sample.pcm();
        return { /*note: sample.baseFreq,*/
            rate: sample.rate,
            channels: sample.nchannels,
            samples: [...Sample.normalize(pcm)],
            pcm,
        };
    }
}
