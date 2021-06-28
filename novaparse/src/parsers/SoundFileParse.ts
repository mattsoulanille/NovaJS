import { SndResource } from '../resource_parsers/SndResource';
import { Mp3Encoder } from 'lamejs';


export async function SoundFileParse(sound: SndResource): Promise<ArrayBuffer> {
    let { mp3Samples, mp3Rate } = sound.sound;
    const encoder = new Mp3Encoder(1, mp3Rate, 128);
    const a = encoder.encodeBuffer(mp3Samples); //encode mp3
    const b = encoder.flush();

    //console.log(samples);
    const out = new Int8Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out.buffer;
}
