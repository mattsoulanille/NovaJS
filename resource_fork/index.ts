import * as path from "path";
import * as fs from "fs";

// see https://developer.apple.com/legacy/library/documentation/mac/pdf/MoreMacintoshToolbox.pdf#page=151
// for info on resource fork

type ResourceMap = {
    [index: string]: // resource type
    {
        [index: number]: // id
        Resource
    }
}

async function readResourceFork(p: string, readResourceFork = true): Promise<ResourceMap> {
    let filePath: string;
    if (readResourceFork) {
        filePath = path.normalize(p + "/..namedfork/rsrc");
    }
    else {
        filePath = path.normalize(p);
    }
    const resources: ResourceMap = {};

    const buffer = await readFile(filePath);
    //this.u8 = new Uint8Array(this.buffer);
    //this.u32 = new Uint32Array(this.buffer);
    const dataView = new DataView(buffer);


    // Offset and length of resource data and resource map
    const o_data = dataView.getUint32(0);
    const o_map = dataView.getUint32(1 * 4);
    const l_data = dataView.getUint32(2 * 4);
    const l_map = dataView.getUint32(3 * 4);

    // Verify that the file is actually in resource fork format
    if (o_data !== dataView.getUint32(o_map) ||
        o_map !== dataView.getUint32(o_map + 4) ||
        l_data !== dataView.getUint32(o_map + 8) ||
        l_map !== dataView.getUint32(o_map + 12)) {
        throw ("Not a valid resourceFork file");
    }


    // Get resource map
    const resource_data = new DataView(buffer, o_data, l_data);
    const resource_map = new DataView(buffer, o_map, l_map);

    // Get type and name list
    // Make sure to account for the resource map's byteOffset
    const o_type_list = resource_map.getUint16(24) + resource_map.byteOffset;
    const o_name_list = resource_map.getUint16(26) + resource_map.byteOffset;
    const type_list = new DataView(buffer, o_type_list, o_name_list - o_type_list);
    const name_list = new DataView(buffer, o_name_list); // continues to end of buffer

    // Type List
    // 2 bytes: Number of resource types in the map minus 1 (no one uses resource fork without using at
    // least one resource, so they get an extra type by doing this)
    const n_types = (type_list.getUint16(0) + 1) & 0xffff; // keep within uint16


    //this.resources = {};

    // read each resource
    for (let i = 0; i < n_types; i++) {
        const resource_type_array =
            [type_list.getUint8(2 + 8 * i),
            type_list.getUint8(3 + 8 * i),
            type_list.getUint8(4 + 8 * i),
            type_list.getUint8(5 + 8 * i)];

        const resource_type = decode_macroman(resource_type_array);

        const quantity = type_list.getUint16(6 + 8 * i) + 1;
        const offset = type_list.getUint16(8 + 8 * i);


        if (resources.hasOwnProperty(resource_type)) {
            throw Error("Duplicate resource type " + resource_type);
        }
        resources[resource_type] = [];

        for (let j = 0; j < quantity; j++) {
            const resType = resource_type;
            const resId = type_list.getUint16(offset + 12 * j);
            let resName: string;

            const o_name = type_list.getUint16(offset + 12 * j + 2);
            if (o_name == 0xffff) {
                resName = "";
            }
            else {
                const name_len = name_list.getUint8(o_name);
                const current_name_list = [];
                for (let k = 0; k < name_len; k++) {
                    current_name_list.push(name_list.getUint8(o_name + 1 + k));
                }
                resName = decode_macroman(current_name_list);
            }


            //const attrs = this.type_list.getUint8(offset + 12*j + 4);

            const tmsb = type_list.getUint8(offset + 12 * j + 5);
            const t = type_list.getUint16(offset + 12 * j + 6);

            const o_rdat = (tmsb << 16) + t;
            const l_rdat = resource_data.getUint32(o_rdat);
            const resData = new DataView(buffer,
                resource_data.byteOffset + o_rdat + 4,
                l_rdat);

            const res = new Resource(resType, resId, resName, resData);
            resources[resource_type][res.id] = res;
        }
    }
    return resources;
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

// see https://gist.github.com/jrus/3113240
function decode_macroman(mac_roman_bytearray: Array<number>): string {
    let byte, char_array, idx;
    const high_chars_unicode = 'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü\n†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø\n¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ\n‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ'.replace(/\n/g, '');

    char_array = (function() {
        let i, ref, results;
        results = [];
        for (idx = i = 0, ref = mac_roman_bytearray.length; 0 <= ref ? i < ref : i > ref; idx = 0 <= ref ? ++i : --i) {
            byte = mac_roman_bytearray[idx];
            if (byte < 0x80) {
                results.push(String.fromCharCode(byte));
            } else {
                results.push(high_chars_unicode.charAt(byte - 0x80));
            }
        }
        return results;
    })();
    return char_array.join('');
}




class Resource {
    readonly data: DataView;
    readonly type: string;
    readonly id: number;
    readonly name: string;
    constructor(resourceType: string, id: number, name: string, data: DataView) {
        this.type = resourceType;
        this.id = id;
        this.name = name;
        this.data = data;
    }
    get shortArray() {
        const arr = [];
        for (let i = 0; i < this.data.byteLength; i++) {
            arr.push(this.data.getUint8(i));
        }
        return arr;
    }
    get hexString() {
        // for conveniently viewing the data
        const hexArr = this.shortArray.map(function(n) {
            let hex = n.toString(16);
            if (hex.length === 1) {
                hex = "0" + hex;
            }
            return hex;

        });
        return hexArr.join(" ");
    }

    get shortString() {
        const shortArr = this.shortArray;
        return shortArr.map(function(n) {
            return n.toString();
        }).join(" ");
    }

    get intArray() {
        const arr = [];
        for (let i = 0; i < this.data.byteLength; i += 2) {
            arr.push(this.data.getUint16(i));
        }
        return arr;
    }
    get intString() {
        const intArr = this.intArray;
        return intArr.map(function(n) {
            return n.toString();
        }).join(" ");
    }

}

export { readResourceFork, Resource, ResourceMap };
