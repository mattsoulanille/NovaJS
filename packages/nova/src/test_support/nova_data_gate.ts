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
 *
 * That trap is invisible wherever the data IS installed (every developer
 * and agent checkout), so the gate enforces the guard itself: a
 * `requireNovaData` (hence `getIntegrationGameData`) reached OUTSIDE a
 * spec — from a `beforeAll` / `afterAll` or a describe body — with no
 * `novaDataInstalled()` check earlier in that hook throws, data or no
 * data. The spec/hook boundary comes from a jasmine reporter registered
 * by spec_support/nova_data_gate_context.ts (`noteGateContext`); with no
 * reporter (a scratch script) the gate does not enforce.
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
    // Consulting the gate is what makes a beforeAll safe to load data in.
    guardConsulted = true;
    return novaFilesPresent(packageRoot);
}

/**
 * The same check without counting as a beforeAll guard, for fixtures that
 * test for the data on their own account (makePluginNovaParse returns
 * undefined rather than pending) and must not vouch for their caller.
 */
export function novaFilesPresent(packageRoot = process.cwd()): boolean {
    try {
        return fs.statSync(path.join(packageRoot, "Nova_Data", NOVA_FILES_DIR))
            .isDirectory();
    } catch {
        return false;
    }
}

/**
 * Where jasmine is, as far as the gate knows: `"spec"` from a spec's start
 * to its end (its beforeEach / it / afterEach), `"hook"` anywhere else in
 * a run (spec-file loading, beforeAll, afterAll), `"untracked"` when no
 * reporter drives it.
 */
export type GateContext = "untracked" | "hook" | "spec";

let gateContext: GateContext = "untracked";
let guardConsulted = false;

/**
 * Called by the jasmine reporter in spec_support on every boundary; a
 * new boundary starts a new hook, which must consult the gate afresh.
 */
export function noteGateContext(context: GateContext): void {
    gateContext = context;
    guardConsulted = false;
}

export function currentGateContext(): GateContext {
    return gateContext;
}

export const UNGUARDED_HOOK_MESSAGE =
    "the real game data was requested from a beforeAll/afterAll or describe"
    + " body with no novaDataInstalled() guard. Without Nova_Data (CI) that"
    + " is a SUITE FAILURE, not a pend: start the hook with"
    + " `if (!novaDataInstalled()) return;` and add"
    + " `beforeEach(requireNovaData)`, or use getSyntheticGameData()"
    + " (test_support/nova_data_gate.ts).";

/**
 * Marks the running spec pending when the game data is absent; a no-op
 * when it is present. Usable directly as a hook: `beforeEach(requireNovaData)`.
 */
export function requireNovaData(packageRoot = process.cwd()): void {
    if (gateContext === "hook" && !guardConsulted) {
        throw new Error(UNGUARDED_HOOK_MESSAGE);
    }
    if (novaFilesPresent(packageRoot)) {
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
