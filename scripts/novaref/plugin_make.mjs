/**
 * novaref plugin-make: builds an EV Nova plug-in from a JSON spec.
 *
 *   novaref plugin-make <spec.json> [out] [--data]
 *
 * Spec:
 *   {
 *     "name": "novaref-kit",              // file name (default: spec basename)
 *     "stock": "~/.local/share/novaref/stock",  // dir of .ndat files to clone from
 *     "resources": [
 *       { "type": "shïp", "id": 700, "name": "Probe",
 *         "clone": "shïp:128",            // start from a stock resource's bytes
 *         "set": { "speed": 300, "accel": 300, "turn": 10 } },
 *       { "type": "sÿst", "id": 2000, "fill": 255, "set": {...} },  // blank
 *       { "type": "STR#", "id": 9000, "strings": ["a", "b"] },
 *       { "type": "dësc", "id": 9000, "text": "Hello" },
 *       { "type": "xxxx", "id": 128, "hex": "0001ffff" }
 *     ]
 *   }
 *
 * Field names for "set" are in packages/novaparse/src/plugin_kit/
 * resource_fields.ts (plus raw "@offset:kind"). A resource with "clone" and
 * no "name" keeps the cloned resource's name.
 *
 * Output: a Mac plug-in, i.e. an empty data fork + resource fork + FinderInfo
 * type 'Npïf' creator 'Nvä' (what every Mac plug-in in Nova_Data/Plug-ins
 * carries). --data writes the resources into the data fork instead (the
 * layout of the stock "Nova Data N.ndat" files, no FinderInfo).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildResourceFork, encode_macroman, parseResourceFork } from "resource_fork";
import { patchResource } from "novaparse/plugin_kit/resource_fields";

export const PLUGIN_FINDER_INFO_HEX = "4E7095664E9A768A" + "00".repeat(24); // 'Npïf' 'Nvä'

const expandHome = (p) => (p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p);

let stockCache = null;
function stockMap(dir) {
    if (stockCache) return stockCache;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ndat")).sort();
    if (!files.length) throw new Error(`no .ndat files in ${dir} (copy the old Mac's Nova Data *.ndat there)`);
    const merged = {};
    for (const f of files) {
        const buf = fs.readFileSync(path.join(dir, f));
        const map = parseResourceFork(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
        for (const [type, byId] of Object.entries(map)) {
            merged[type] = { ...(merged[type] ?? {}), ...byId };
        }
    }
    stockCache = merged;
    return merged;
}

function bytesOf(res) {
    return new Uint8Array(res.data.buffer, res.data.byteOffset, res.data.byteLength);
}

function strList(strings) {
    const out = [(strings.length >> 8) & 0xff, strings.length & 0xff];
    for (const s of strings) {
        const enc = encode_macroman(s);
        if (enc.length > 255) throw new Error(`STR# entry too long: ${s}`);
        out.push(enc.length, ...enc);
    }
    return out;
}

/** Builds the ResourceSpec list for a plug-in spec object. */
/**
 * Highest id EV Nova 1.1.1 accepts per type. Most come from the Bible's
 * "Max ..." table (ids start at 128: Max Weapon Types 256 -> 383, Max
 * Outfit Item Types 512 -> 639, Max Dude Types 512 -> 639, Max Govts 256,
 * Max Fleets 256 -> 383, Max Missions 1000 -> 1127). rlëD is empirical:
 * wave 3 found that a plug-in with rlëD 2000/2001 makes the game quit while
 * loading, while 1999 works.
 */
export const ID_LIMITS = {
    "wëap": 383, "oütf": 639, "düde": 639, "gövt": 383, "flët": 383, "mïsn": 1127,
    "shïp": 895, "sÿst": 2175, "spöb": 2175, "rlëD": 1999,
};

/** Throws if a resource's id is above what the game accepts (see ID_LIMITS). */
export function checkIdLimit(r) {
    const max = ID_LIMITS[r.type];
    if (max !== undefined && r.id > max && !r.unsafeId) {
        throw new Error(`${r.type}:${r.id} is above EV Nova's limit of ${max} for ${r.type} (the game quits or ignores it); add "unsafeId": true to build it anyway`);
    }
}

export function buildPluginResources(spec, { stockDir } = {}) {
    const out = [];
    const seen = new Set();
    for (const r of spec.resources ?? []) {
        if (!r.type || r.id === undefined) throw new Error(`resource needs type and id: ${JSON.stringify(r)}`);
        checkIdLimit(r);
        const key = `${r.type}:${r.id}`;
        if (seen.has(key)) throw new Error(`duplicate resource ${key}`);
        seen.add(key);
        // Overriding a stock resource changes the stock universe for the
        // run; make the spec say so explicitly.
        const stock = stockMap(expandHome(spec.stock ?? stockDir ?? "~/.local/share/novaref/stock"));
        if (stock[r.type]?.[r.id] && !r.override) {
            throw new Error(`${key} is a stock resource ("${stock[r.type][r.id].name}"); add "override": true to replace it`);
        }
        let data;
        let name = r.name;
        if (r.hex !== undefined) {
            data = Uint8Array.from(Buffer.from(r.hex.replace(/\s+/g, ""), "hex"));
        } else if (r.strings) {
            data = Uint8Array.from(strList(r.strings));
        } else if (r.text !== undefined) {
            data = Uint8Array.from([...encode_macroman(r.text), 0]);
        } else if (r.clone) {
            const [ctype, cid] = r.clone.includes(":") ? [r.clone.slice(0, r.clone.lastIndexOf(":")), r.clone.slice(r.clone.lastIndexOf(":") + 1)] : [r.type, r.clone];
            const src = stockMap(expandHome(spec.stock ?? stockDir ?? "~/.local/share/novaref/stock"))[ctype]?.[Number(cid)];
            if (!src) throw new Error(`clone source ${ctype}:${cid} not found in stock data`);
            data = bytesOf(src).slice();
            name ??= src.name;
        } else if (r.fill !== undefined || r.set) {
            data = new Uint8Array(0);
        } else {
            throw new Error(`resource ${key} needs one of hex, strings, text, clone, fill or set`);
        }
        if (r.set || r.fill !== undefined) {
            if (r.fill !== undefined && !r.clone) {
                data = patchResource(r.type, data, {}).fill(r.fill);
            }
            data = patchResource(r.type, data, r.set ?? {});
        }
        out.push({ type: r.type, id: r.id, name: name ?? "", data });
    }
    return out;
}

export async function pluginMake(args) {
    const dataFork = args.includes("--data");
    const rest = args.filter((a) => a !== "--data");
    const specPath = rest[0];
    if (!specPath) throw new Error("usage: novaref plugin-make <spec.json> [out] [--data]");
    const spec = specPath.endsWith(".mjs")
        ? (await import(pathToFileURL(path.resolve(specPath)).href)).default
        : JSON.parse(fs.readFileSync(specPath, "utf8"));
    const name = spec.name ?? path.basename(specPath).replace(/\.(json|mjs)$/, "");
    const out = path.resolve(rest[1] ?? path.join(os.homedir(), ".local/share/novaref/plugins", name));
    const resources = buildPluginResources(spec);
    const fork = new Uint8Array(buildResourceFork(resources, { dataOffset: 256 }));
    // Round trip: every resource reads back unchanged.
    const back = parseResourceFork(fork.slice().buffer);
    for (const r of resources) {
        const got = back[r.type]?.[r.id];
        if (!got || got.name !== r.name || Buffer.compare(Buffer.from(bytesOf(got)), Buffer.from(r.data)) !== 0) {
            throw new Error(`round trip failed for ${r.type} ${r.id}`);
        }
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.rmSync(out, { force: true });
    if (dataFork) {
        fs.writeFileSync(out, fork);
    } else {
        fs.writeFileSync(out, "");
        fs.writeFileSync(out + "/..namedfork/rsrc", fork);
        const x = spawnSync("xattr", ["-wx", "com.apple.FinderInfo", PLUGIN_FINDER_INFO_HEX, out], { encoding: "utf8" });
        if (x.status !== 0) throw new Error(`xattr failed: ${x.stderr}`);
    }
    const types = {};
    for (const r of resources) types[r.type] = (types[r.type] ?? 0) + 1;
    return { ok: true, cmd: "plugin-make", path: out, layout: dataFork ? "data-fork" : "resource-fork",
        bytes: fork.length, resources: resources.length, types };
}
