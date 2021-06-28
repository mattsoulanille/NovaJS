type ListLike<T> = Iterable<T> & { length: number };


declare module 'lamejs' {
    export class Mp3Encoder {
        constructor(channels: 1 | 2, sampleRate: number, bitrate: number);
        encodeBuffer(left: ListLike<number>, right?: ListLike<number>): Int8Array;
        flush(): Int8Array;
    }
}
