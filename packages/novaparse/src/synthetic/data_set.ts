import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildResourceFork } from "resource_fork/write";
import { buildSyntheticResources } from "./resources.js";

/**
 * The synthetic Nova data set as a file tree the parser loads like any
 * Nova_Data directory:
 *
 *     <root>/Nova Files/Synthetic Data.ndat   (a data-fork resource file)
 *     <root>/Plug-ins/                        (empty; .gitkeep only)
 *
 * The .ndat is CHECKED IN at SYNTHETIC_DATA_ROOT (packages/nova's test
 * fixtures) and regenerated with `npm run synthetic-data` in
 * packages/novaparse. Generation is a pure function of universe.ts, art.ts
 * and the encoders, so the checked-in bytes match a fresh run exactly —
 * a spec (test/synthetic/data_set_test.ts) fails if someone edits the
 * scenario without regenerating, or the generator stops being
 * deterministic.
 */

export const SYNTHETIC_NOVA_FILES_DIR = "Nova Files";
export const SYNTHETIC_PLUGINS_DIR = "Plug-ins";
export const SYNTHETIC_NDAT_NAME = "Synthetic Data.ndat";

/** packages/nova/test_fixtures/synthetic, located from this module. */
export const SYNTHETIC_DATA_ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../nova/test_fixtures/synthetic");

export function syntheticNdatPath(root = SYNTHETIC_DATA_ROOT): string {
    return path.join(root, SYNTHETIC_NOVA_FILES_DIR, SYNTHETIC_NDAT_NAME);
}

/** The whole data set as resource-fork bytes. */
export function buildSyntheticDataSet(): Uint8Array {
    return new Uint8Array(buildResourceFork(buildSyntheticResources()));
}

/**
 * Writes the data set under `root`, creating the Nova Files and (empty)
 * Plug-ins directories. Returns the .ndat path.
 */
export function writeSyntheticDataSet(root = SYNTHETIC_DATA_ROOT): string {
    const ndat = syntheticNdatPath(root);
    fs.mkdirSync(path.dirname(ndat), { recursive: true });
    fs.writeFileSync(ndat, buildSyntheticDataSet());
    const plugins = path.join(root, SYNTHETIC_PLUGINS_DIR);
    fs.mkdirSync(plugins, { recursive: true });
    // git keeps no empty directories; the loader ignores dotfiles.
    fs.writeFileSync(path.join(plugins, ".gitkeep"), "");
    return ndat;
}
