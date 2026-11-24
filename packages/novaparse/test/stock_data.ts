import fs from "fs";
import path from "path";
import { fixturesDir } from "./fixtures.js";
import { NovaParse } from "../src/nova_parse.js";

/**
 * The real stock data (base "Nova Files" only, so the parsed values do not
 * depend on which plug-ins are installed), for specs that pin a field
 * against the numbers the EVN Bible and docs/npc_behavior_gaps.md cite.
 *
 * packages/nova/Nova_Data is a symlink set up by scripts/setup_worktree.sh;
 * where it is absent `stockNovaParse()` resolves to null and the spec
 * should call `pending()`. One NovaParse is shared by every spec in the
 * run: parsing the id space is the slow part, and the specs only read.
 */
const novaData = path.join(fixturesDir, "..", "..", "..", "nova", "Nova_Data");

export const STOCK_DATA_MISSING = "packages/nova/Nova_Data is not linked";

let shared: Promise<NovaParse | null> | undefined;

export function stockNovaParse(): Promise<NovaParse | null> {
    if (!shared) {
        shared = (async () => {
            if (!fs.existsSync(path.join(novaData, "Nova Files"))) {
                return null;
            }
            const np = new NovaParse(novaData, false,
                { novaFiles: "Nova Files", novaPlugins: null });
            np.resourceNotFoundFunction = () => { };
            np.flagNamespaceWarn = () => { };
            np.controlBitNamespaceWarn = () => { };
            const space = await np.idSpace;
            if (space instanceof Error) {
                throw space;
            }
            return np;
        })();
    }
    return shared;
}
