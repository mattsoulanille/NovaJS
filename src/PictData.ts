import { BaseData, DefaultBaseData } from "./BaseData";
import * as fs from "fs";
import * as path from "path";

interface PictData extends BaseData {
    PNG: Buffer
}
console.log(path.resolve("./"))
const DefaultPictData: PictData = {
    ...DefaultBaseData,
    PNG: fs.readFileSync(path.join(__dirname, "default.png"))
}

export { PictData, DefaultPictData }
