import fs from "fs";
import os from "os";
import path from "path";
import {
    currentGateContext,
    GateContext,
    NOVA_DATA_PENDING_REASON,
    NOVA_FILES_DIR,
    novaDataInstalled,
    novaFilesPresent,
    noteGateContext,
    requireNovaData,
    UNGUARDED_HOOK_MESSAGE,
} from "./nova_data_gate.js";

/** A scratch package root that HAS the data, as a checkout with it does. */
function rootWithData(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "novajs-data-gate-"));
    fs.mkdirSync(path.join(root, "Nova_Data", NOVA_FILES_DIR), { recursive: true });
    return root;
}

function thrownBy(fn: () => void): unknown {
    try {
        fn();
    } catch (e) {
        return e;
    }
    return undefined;
}

describe("Nova_Data gate", () => {
    let root: string;
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "novajs-data-gate-"));
    });
    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("reports data absent when Nova_Data/Nova Files is missing", () => {
        expect(novaDataInstalled(root)).toBeFalse();
        fs.mkdirSync(path.join(root, "Nova_Data"));
        expect(novaDataInstalled(root)).toBeFalse();
    });

    it("reports data absent when Nova Files is a file, not a directory", () => {
        // NovaParse rejects with "Nova Files must be a directory"; the gate
        // must agree so the spec skips instead of failing on that message.
        fs.mkdirSync(path.join(root, "Nova_Data"));
        fs.writeFileSync(path.join(root, "Nova_Data", NOVA_FILES_DIR), "");
        expect(novaDataInstalled(root)).toBeFalse();
    });

    it("reports data present through a symlinked Nova Files directory", () => {
        // scripts/setup_worktree.sh links, never copies.
        const canonical = path.join(root, "canonical");
        fs.mkdirSync(canonical);
        fs.mkdirSync(path.join(root, "Nova_Data"));
        fs.symlinkSync(canonical, path.join(root, "Nova_Data", NOVA_FILES_DIR));
        expect(novaDataInstalled(root)).toBeTrue();
    });

    it("reports data absent through a dangling symlink", () => {
        fs.mkdirSync(path.join(root, "Nova_Data"));
        fs.symlinkSync(path.join(root, "gone"),
            path.join(root, "Nova_Data", NOVA_FILES_DIR));
        expect(novaDataInstalled(root)).toBeFalse();
    });

    it("marks the spec pending, not failed, when the data is absent", () => {
        // jasmine's pending() throws a specially-tagged value (a bare
        // string in jasmine 5: "=> marked Pending" + reason) that the
        // runner turns into a pending result; catching it here keeps THIS
        // spec running while proving the gate raised it.
        let thrown: unknown;
        try {
            requireNovaData(root);
        } catch (e) {
            thrown = e;
        }
        expect(thrown).toBeDefined();
        const message = thrown instanceof Error ? thrown.message : String(thrown);
        expect(message).toContain("marked Pending");
        expect(message).toContain(NOVA_DATA_PENDING_REASON);
    });

    it("is a no-op when the data is present", () => {
        fs.mkdirSync(path.join(root, "Nova_Data", NOVA_FILES_DIR),
            { recursive: true });
        expect(() => requireNovaData(root)).not.toThrow();
    });
});

/**
 * Issue #334: a beforeAll that loads the real data with no
 * novaDataInstalled() guard is a suite failure on CI (no data), and
 * invisible on every checkout with the data. The gate refuses it even
 * WITH the data, so the checkouts that do run it see it.
 */
describe("Nova_Data gate, outside a spec", () => {
    it("knows it is inside a spec (the spec_support reporter is registered)", () => {
        expect(currentGateContext()).toBe("spec");
    });

    describe("in an unguarded beforeAll", () => {
        let root: string;
        let error: unknown;
        beforeAll(() => {
            root = rootWithData();
            error = thrownBy(() => requireNovaData(root));
        });
        afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

        it("refuses the load even though the data is installed", () => {
            expect(error).toEqual(new Error(UNGUARDED_HOOK_MESSAGE));
        });
    });

    describe("in a beforeAll guarded by novaDataInstalled()", () => {
        let root: string;
        let error: unknown = "not run";
        beforeAll(() => {
            root = rootWithData();
            if (!novaDataInstalled(root)) return;
            error = thrownBy(() => requireNovaData(root));
        });
        afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

        it("allows the load", () => {
            expect(error).toBeUndefined();
        });
    });

    describe("in a beforeAll checking only novaFilesPresent()", () => {
        // A fixture's own check (makePluginNovaParse) must not vouch for
        // the hook that called it.
        let root: string;
        let error: unknown;
        beforeAll(() => {
            root = rootWithData();
            novaFilesPresent(root);
            error = thrownBy(() => requireNovaData(root));
        });
        afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

        it("still refuses the load", () => {
            expect(error).toEqual(new Error(UNGUARDED_HOOK_MESSAGE));
        });
    });

    describe("driven directly", () => {
        let root: string;
        let saved: GateContext;
        beforeEach(() => {
            root = rootWithData();
            saved = currentGateContext();
        });
        afterEach(() => {
            noteGateContext(saved);
            fs.rmSync(root, { recursive: true, force: true });
        });

        it("needs a fresh guard in every hook", () => {
            noteGateContext("hook");
            novaDataInstalled(root);
            expect(thrownBy(() => requireNovaData(root))).toBeUndefined();
            noteGateContext("hook");
            expect(thrownBy(() => requireNovaData(root)))
                .toEqual(new Error(UNGUARDED_HOOK_MESSAGE));
        });

        it("does not enforce when no reporter tracks the run", () => {
            noteGateContext("untracked");
            expect(thrownBy(() => requireNovaData(root))).toBeUndefined();
        });

        it("still pends, not refuses, inside a spec without the data", () => {
            noteGateContext("spec");
            const message = String(thrownBy(() => requireNovaData(
                path.join(root, "elsewhere"))));
            expect(message).toContain("marked Pending");
        });
    });
});
