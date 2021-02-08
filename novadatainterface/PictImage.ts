import defaultPict from 'novadatainterface/default_pict';

export type PictImageData = Buffer;

export function getDefaultPictImageData(): PictImageData {
    return Buffer.from(defaultPict.buffer);
}
