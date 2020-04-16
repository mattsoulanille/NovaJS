import fs from "fs";

const defaultRledPath = require.resolve("novajs/novadatainterface/defaultRled.png");
const DefaultSpriteSheetImage = fs.readFileSync(defaultRledPath);
export function getDefaultSpriteSheetImage() {
    return DefaultSpriteSheetImage;
}
