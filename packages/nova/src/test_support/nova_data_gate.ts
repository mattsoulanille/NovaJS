/**
 * The one gate every data-backed spec goes through when the game data is
 * not installed.
 *
 * `packages/nova/Nova_Data` is a tracked placeholder; its children
 * `Nova Files` and `Plug-ins` are gitignored (the game is copyrighted, so
 * the repo carries none of it) and CI has no copy. Specs that parse the real
 * data must therefore SKIP — jasmine `pending()` — rather than fail when it
 * is absent, so the pure-logic majority of the suite still gates a checkout
 * without it. The plug-in fixtures already did this per plug-in; the base
 * data fixtures (`getIntegrationGameData`, `makeSimulationBridgeHarness`)
 * now route through here too.
 *
 * `pending()` is only honoured from an `it`/`beforeEach` (or a helper awaited
 * by one). Thrown from a `beforeAll`, jasmine reports it as a SUITE FAILURE
 * ("Not run because a beforeAll function failed"), so a suite that loads
 * data in `beforeAll` guards that hook with `novaDataInstalled()` and adds
 * `beforeEach(requireNovaData)` to pend each spec instead.
 */
import fs from "fs";
import path from "path";

export const NOVA_FILES_DIR = "Nova Files";

export const NOVA_DATA_PENDING_REASON =
    "Nova_Data/Nova Files not installed (see README, Game data)";

/**
 * Whether `<packageRoot>/Nova_Data/Nova Files` is a directory (through a
 * symlink, as the worktree setup script leaves it). The same condition
 * NovaParse's loader enforces ("Nova Files must be a directory"), checked
 * up front so the spec can skip instead of rejecting. Jasmine runs with
 * cwd = packages/nova, hence the process.cwd() default.
 */
export function novaDataInstalled(packageRoot = process.cwd()): boolean {
    try {
        return fs.statSync(path.join(packageRoot, "Nova_Data", NOVA_FILES_DIR))
            .isDirectory();
    } catch {
        return false;
    }
}

/**
 * Marks the running spec pending when the game data is absent; a no-op
 * when it is present. Usable directly as a hook: `beforeEach(requireNovaData)`.
 */
export function requireNovaData(packageRoot = process.cwd()): void {
    if (novaDataInstalled(packageRoot)) {
        return;
    }
    if (typeof pending === "function") {
        pending(NOVA_DATA_PENDING_REASON);
    }
    // Outside jasmine (a scratch script importing the fixture) there is
    // nothing to mark pending; fail loudly instead of letting the parser
    // reject later with a less specific message.
    throw new Error(NOVA_DATA_PENDING_REASON);
}
