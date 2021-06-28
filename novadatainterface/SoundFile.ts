export type SoundFile = ArrayBuffer;

export function getDefaultSoundFile(): SoundFile {
    return Buffer.from([]);
}
