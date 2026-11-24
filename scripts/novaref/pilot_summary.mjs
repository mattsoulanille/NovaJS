#!/usr/bin/env node
/**
 * Prints a one-line JSON summary of an EV Nova pilot file using the repo's
 * own parser (novaparse readPilot): a Mac pilot with its resource fork (as
 * `novaref pilots pull` writes it), a bare resource fork (`pull --raw`
 * .rsrc), or a Windows .plt.
 *
 *   node scripts/novaref/pilot_summary.mjs <pilot> [--no-names]
 *
 * Names (ship class, stellar, system) are resolved against the stock data in
 * packages/nova/Nova_Data when it is linked (scripts/setup_worktree.sh);
 * plug-in-only ids resolve to null. Needs `npm run build` (novaparse dist).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPilot } from "novaparse";
import { IDSpaceHandler } from "novaparse/id_space_handler";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const NOVA_DATA = path.join(ROOT, "packages/nova/Nova_Data");

const args = process.argv.slice(2);
const noNames = args.includes("--no-names");
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
    console.error("usage: pilot_summary.mjs <pilot> [--no-names]");
    process.exit(2);
}

const pilot = await readPilot(file);
const p = pilot.player;
const summary = {
    ok: true,
    file: path.resolve(file),
    pilot_name: path.basename(file).replace(/\.(rsrc|plt)$/i, ""),
    format: pilot.format,
    nickname: pilot.globals.nickname,
    ship_name: pilot.shipName,
    credits: p.cash,
    ship_class_id: p.shipClass + 128,
    last_stellar_id: p.lastStellar + 128,
    fuel: p.fuel,
    date: p.date,
    combat_rating: p.rating,
    explored_systems: p.exploration.filter((e) => e > 0).length,
    active_missions: p.missions.filter((m) => m.objectives.active).map((m) => m.data.missionName),
    strict_play: pilot.globals.strictPlay,
    // Wave 5: every non-zero per-system legal record, keyed by sÿst id.
    legal: Object.fromEntries(p.legalStatus.map((v, i) => [i + 128, v]).filter(([, v]) => v !== 0)),
    // Wave 11: every set mission bit.
    mission_bits: [...p.missionBits].flatMap((v, i) => (v ? [i] : [])),
};

if (!noNames && fs.existsSync(path.join(NOVA_DATA, "Nova Files"))) {
    const space = await new IDSpaceHandler(NOVA_DATA, { novaFiles: "Nova Files", novaPlugins: null })
        .getIDSpace();
    const name = (res) => (res ? res.name.split(";")[0].trim() : null);
    summary.ship_class = name(space.shïp[`nova:${summary.ship_class_id}`]);
    summary.last_stellar = name(space.spöb[`nova:${summary.last_stellar_id}`]);
    const systs = Object.entries(space.sÿst).filter(([, s]) => s.spobs?.includes(summary.last_stellar_id));
    summary.system = systs.length ? name(systs[0][1]) : null;
    summary.system_id = systs.length ? Number(systs[0][0].split(":")[1]) : null;
}

console.log(JSON.stringify(summary));
