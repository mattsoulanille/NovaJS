
import { BaseResource } from "./NovaResourceBase";
import { NovaResources } from "./ResourceHolderBase";
import { Resource } from "resourceforkjs";



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
function imaSignMag(v: number): number {
    return (v >> 3 ? -1 : 1) * ((v & 7) + .5);
}
function* read_ima4(r: Reader): IterableIterator<number> {
    const c = r.read("h");
    let si = c & 0x7f;
    let p = c - si;
    if (si > 88) { si = 88; }
    let step = ima_step_table[si];
    for (let i = 0; i < 32; i++) {
        const b = r.read("B");
        for (let ni = 0; ni < 2; ni++) {
            const v = ni ? b >> 4 : b & 0xf;
            si += ima_index_table[v];
            if (si > 88) { si = 88; } else { if (si < 0) { si = 0; } }
            p += (imaSignMag(v)) * step / 4;
            yield p / 32768;
            step = ima_step_table[si];
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
    *[Symbol.iterator](): IterableIterator<number> {
        const r = this.data.copy();
        if (this.encoding === 0) {
            for (let i = 0; i < this.length; i++) {
                yield (r.read("B") - 127.5) / 127.5;
            }
            return;
        }
        if (isCompressedHeader(this)) {
            if (this.format === "ima4") {
                for (let i = 0; i < this.length; i++) {
                    yield* read_ima4(r);
                }
                return;
            }
            throw new Error(`unknown compression format ${this.format} (currently only ima4 supported)`);
        }
        throw new Error(`long headers unsupported`);
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

const allowedMP3Rates = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000] as const;
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
    get sound() {
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

        //convert up to nearest mp3 rate using linear interp
        const data = [...sample];
        let mp3rate: number = allowedMP3Rates[0];
        for (let i = 0; i < allowedMP3Rates.length; i++) {
            mp3rate = allowedMP3Rates[i];
            if (mp3rate >= sample.rate) {
                break;
            }
        }

        return { /*note: sample.baseFreq,*/
            rate: sample.rate,
            dat: data,

            mp3Rate: mp3rate,
            mp3Data: [...new SampleRateConvertAndScale(sample.rate / mp3rate,32768).convert(data)]
        };
    }
}

export class SampleRateConvertAndScale {
    constructor(public ratio: number, public scale = 1) { }
    *convert(a: number[]): IterableIterator<number> {
        let t = 0;
        let i = 1;
        while (i < a.length) {
            yield (a[i - 1] * (1 - t) + a[i] * t) * this.scale;
            t += this.ratio;
            i += Math.floor(t);
            t -= Math.floor(t);
        }
    }
}