import { BaseData, DefaultBaseData } from "./BaseData";
import * as fs from "fs";
import * as path from "path";

interface PictData extends BaseData {
    PNG: Buffer
}

const DefaultPictData: PictData = {
    ...DefaultBaseData,
    PNG: fs.readFileSync(require.resolve("./default.png"))
}

export { PictData, DefaultPictData }
