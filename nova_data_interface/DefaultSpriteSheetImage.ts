import defaultRled from 'nova_data_interface/default_rled';
export function getDefaultSpriteSheetImage() {
    return Buffer.from(defaultRled.buffer);
}
