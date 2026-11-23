#!/usr/bin/env node
/**
 * Converts a flat Windows-style .rez (BRGR) data file into the Mac format
 * that EV Nova 1.1.1 on OS X loads: a Resource Manager file stored in the
 * DATA fork, exactly like the stock "Nova Data N.ndat" files (which carry no
 * FinderInfo type/creator at all). The Mac build refuses .rez as-is.
 *
 *   node scripts/novaref/rez_to_ndat.mjs <in.rez> <out.ndat>
 *
 * Verifies the result before reporting ok: every type, id, name and data
 * byte read back from the .ndat equals the .rez. Prints one JSON line.
 */
import fs from "node:fs";
import { buildResourceFork, parseResourceFork, readRez } from "resource_fork";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
    console.error("usage: rez_to_ndat.mjs <in.rez> <out.ndat>");
    process.exit(2);
}

/** Flattens a ResourceMap into sorted {type, id, name, data} rows. */
export function resourceRows(map) {
    const rows = [];
    for (const type of Object.keys(map).sort()) {
        for (const res of Object.values(map[type]).sort((a, b) => a.id - b.id)) {
            rows.push({
                type, id: res.id, name: res.name,
                data: new Uint8Array(res.data.buffer, res.data.byteOffset, res.data.byteLength),
            });
        }
    }
    return rows;
}

const buf = fs.readFileSync(input);
const rez = readRez(new DataView(buf.buffer, buf.byteOffset, buf.byteLength));
const rows = resourceRows(rez);
const fork = new Uint8Array(buildResourceFork(rows, { dataOffset: 256 }));
fs.writeFileSync(output, fork);

const back = resourceRows(parseResourceFork(fs.readFileSync(output).buffer.slice(0)));
let mismatch = null;
if (back.length !== rows.length) mismatch = `count ${back.length} != ${rows.length}`;
for (let i = 0; !mismatch && i < rows.length; i++) {
    const a = rows[i], b = back[i];
    if (a.type !== b.type || a.id !== b.id || a.name !== b.name ||
        a.data.length !== b.data.length || !a.data.every((v, j) => v === b.data[j])) {
        mismatch = `${a.type} ${a.id} differs`;
    }
}
const types = {};
for (const r of rows) types[r.type] = (types[r.type] ?? 0) + 1;
console.log(JSON.stringify({
    ok: !mismatch, input, output, bytes: fork.length, resources: rows.length, types,
    ...(mismatch ? { error: mismatch } : {}),
}));
process.exitCode = mismatch ? 1 : 0;
