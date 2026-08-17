import * as path from "path";
import * as fs from "fs";
import { parseResourceFork, ResourceMap } from "./parse.js";

// see https://developer.apple.com/legacy/library/documentation/mac/pdf/MoreMacintoshToolbox.pdf#page=151
// for info on resource fork

export {
    decode_macroman, isRez, parseResourceFork, readRez, Resource, ResourceMap,
} from "./parse.js";

async function readResourceFork(p: string, readResourceFork = true): Promise<ResourceMap> {
    let filePath: string;
    if (readResourceFork) {
        filePath = path.normalize(p + "/..namedfork/rsrc");
    }
    else {
        filePath = path.normalize(p);
    }

    const buffer = await readFile(filePath);
    return parseResourceFork(buffer);
}

function readFile(filePath: string): Promise<ArrayBuffer> {
    return new Promise((fulfill, reject) => {
        fs.readFile(filePath, function(err, data) {
            if (err) {
                reject(err);
                return;
            }
            fulfill(data.buffer);
        });
    });
}


export { readResourceFork };
