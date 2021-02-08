import defaultRled from 'novadatainterface/default_rled';
export function getDefaultSpriteSheetImage() {
    return Buffer.from(defaultRled.buffer);
}
