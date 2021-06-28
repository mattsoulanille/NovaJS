import { SndResource } from '../resource_parsers/SndResource';
import { Mp3Encoder } from 'lamejs';


export async function SoundFileParse(sound: SndResource): Promise<ArrayBuffer> {
    let { rate, samples } = sound.sound;

    rate = 22050;

    samples = samples.map(x => x * 32768);
    const encoder = new Mp3Encoder(1, rate, 128);
    const a = encoder.encodeBuffer(samples); //encode mp3
    const b = encoder.flush();

    //console.log(samples);
    const out = new Int8Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out.buffer;
}
