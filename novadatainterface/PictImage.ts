import defaultPict from 'novadatainterface/default_pict';

export type PictImageData = ArrayBuffer;

export function getDefaultPictImageData(): PictImageData {
    return Buffer.from(defaultPict.buffer);
}
