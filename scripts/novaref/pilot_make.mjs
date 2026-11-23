/**
 * novaref pilot-make: writes a Mac pilot file from a JSON spec.
 *
 *   novaref pilot-make <spec.json> [out]
 *
 * Spec:
 *   {
 *     "name": "novaref-probe",          // pilot file name (default: spec basename)
 *     "base": "~/.local/share/novaref/pilots/novaref-base.rsrc",
 *     "edits": {                        // PilotEdits (packages/novaparse/src/pilot/pilot_write.ts)
 *       "ship": 700, "stellar": 2000, "credits": 100000,
 *       "legal": {"2100": -500} (per SYSTEM), "weapons": {"300": {"count": 1, "ammo": 0}}, ...
 *     }
 *   }
 *
 * The base is a pilot the game itself created (title screen > New Pilot),
 * so every field the spec does not set holds a value the original wrote.
 * Output: <out> with an empty data fork, the pilot in its resource fork and
 * FinderInfo 'NpïL'/'Nvä' (as the game writes them), plus <out>.rsrc (the
 * bare fork). It is read back with the repo's pilot parser before returning.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseResourceFork } from "resource_fork";
import { readPilot } from "novaparse";
import {
    buildMacPilotFork, decryptMacPilot, editMacPilot, PILOT_FINDER_INFO_HEX,
} from "novaparse/pilot/pilot_write";

const expandHome = (p) => (p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p);

function readFork(file) {
    const rsrc = file + "/..namedfork/rsrc";
    const buf = fs.existsSync(rsrc) && fs.statSync(rsrc).size > 0 ? fs.readFileSync(rsrc) : fs.readFileSync(file);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

export async function pilotMake(args) {
    const specPath = args[0];
    if (!specPath) throw new Error("usage: novaref pilot-make <spec.json> [out]");
    const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
    const name = spec.name ?? path.basename(specPath, ".json");
    if (name === "Last Pilot" || name === "Matt" || /[/\n]/.test(name)) throw new Error(`refusing pilot name ${name}`);
    const base = expandHome(spec.base ?? "~/.local/share/novaref/pilots/novaref-base.rsrc");
    const out = path.resolve(args[1] ?? path.join(os.homedir(), ".local/share/novaref/pilots", name));

    const pilot = editMacPilot(decryptMacPilot(parseResourceFork(readFork(base))), spec.edits ?? {});
    const fork = buildMacPilotFork(pilot);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.rmSync(out, { force: true });
    fs.writeFileSync(out, "");
    fs.writeFileSync(out + "/..namedfork/rsrc", fork);
    fs.writeFileSync(out + ".rsrc", fork);
    const x = spawnSync("xattr", ["-wx", "com.apple.FinderInfo", PILOT_FINDER_INFO_HEX, out], { encoding: "utf8" });
    if (x.status !== 0) throw new Error(`xattr failed: ${x.stderr}`);

    const parsed = await readPilot(out);
    const p = parsed.player;
    return {
        ok: true, cmd: "pilot-make", name, path: out, raw_path: out + ".rsrc", base,
        readback: {
            ship_name: parsed.shipName, nickname: parsed.globals.nickname, ship_id: p.shipClass + 128,
            stellar_id: p.lastStellar + 128, credits: p.cash, fuel: p.fuel, rating: p.rating,
            date: p.date,
            legal: Object.fromEntries(p.legalStatus.flatMap((v, i) => (v ? [[i + 128, v]] : []))),
            outfits: Object.fromEntries(p.outfitCount.flatMap((v, i) => (v ? [[i + 128, v]] : []))),
            weapons: Object.fromEntries(p.weaponCount.flatMap((v, i) => (v ? [[i + 128, { count: v, ammo: p.ammo[i] }]] : []))),
            escorts: p.escorts.map((e) => ({ ship: e.shipClass + 128, hired: e.hired })),
            active_missions: p.missions.filter((m) => m.objectives.active).length,
        },
    };
}
