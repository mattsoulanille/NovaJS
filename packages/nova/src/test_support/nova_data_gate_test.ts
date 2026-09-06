import fs from "fs";
import os from "os";
import path from "path";
import {
    NOVA_DATA_PENDING_REASON,
    NOVA_FILES_DIR,
    novaDataInstalled,
    requireNovaData,
} from "./nova_data_gate.js";

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
