import defaultPict from 'nova_data_interface/default_pict';

export type PictImageData = ArrayBuffer;

export function getDefaultPictImageData(): PictImageData {
    return Buffer.from(defaultPict.buffer);
}
