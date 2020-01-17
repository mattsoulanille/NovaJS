import * as fs from "fs";
import * as path from "path";

type PictImageData = Buffer;

const defaultImagePath = require.resolve("novajs/novadatainterface/default.png");
const DefaultPictImageData: PictImageData = fs.readFileSync(defaultImagePath);

export { PictImageData, DefaultPictImageData };
