import * as fs from "fs";

export type PictImageData = Buffer;

const defaultImagePath = require.resolve("novajs/novadatainterface/default.png");
const DefaultPictImageData: PictImageData = fs.readFileSync(defaultImagePath);
export function getDefaultPictImageData(): PictImageData {
    return DefaultPictImageData;
}
