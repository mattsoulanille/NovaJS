import fs from "fs";
import path from "path";

const defaultRledPath = require.resolve("novajs/novadatainterface/defaultRled.png");
const DefaultSpriteSheetImage = fs.readFileSync(defaultRledPath);

export { DefaultSpriteSheetImage }
