import defaultCicn from 'nova_data_interface/default_rled';

export type CicnImageData = ArrayBuffer;

export function getDefaultCicnImageData(): CicnImageData {
    return Buffer.from(defaultCicn.buffer);
}
