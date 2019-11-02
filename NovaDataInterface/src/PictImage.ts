import * as fs from "fs";
import * as path from "path";

type PictImageData = Buffer;

const DefaultPictImageData: PictImageData = fs.readFileSync(require.resolve("./default.png"));

export { PictImageData, DefaultPictImageData };
