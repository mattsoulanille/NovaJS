import "jasmine";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { NovaParse } from "../src/nova_parse.js";
import { IDSpaceHandler } from "../src/id_space_handler.js";
import { resolveFixture } from "./fixtures.js";
import { buildResourceFork } from "resource_fork/write";

// These tests pin the failure policy for id-space loading:
//   - Core "Nova Files" data failing to load is FATAL (the `ids` promise
//     rejects) rather than silently returning empty ids.
//   - A single broken plug-in is SKIPPED with a loud, file-naming error log,
//     and the rest of the ids still load.
//   - A plug-in that reads clean but yields zero resources (the classic
//     macOS xattr-stripped resource-fork case) warns loudly.
//
// Regression: previously ONE unreadable plug-in (e.g. a missing resource fork)
// silently wiped ALL ids (systems, ships, planets, everything).

const VALID_CORE = resolveFixture(
    "IDSpaceHandlerTestFilesystem/Nova Files/Data File 1.ndat");
const VALID_PLUGIN = resolveFixture(
    "IDSpaceHandlerTestFilesystem/Plug-ins/Plugin 1.ndat");

// A minimal but structurally-valid classic resource fork containing zero
// resources. This mimics a file whose resource fork survived as an empty shell
// (e.g. stripped of its xattr payload) rather than being missing entirely.
function makeEmptyResourceFork(): Buffer {
    const headerLen = 16;
    const dataLen = 0;
    const o_data = headerLen;
    const o_map = headerLen + dataLen;
    const typeListOffset = 28;
    const nameListOffset = 30;
    const mapLen = 16 + 8 + 2 + 2 + 2;

    const buf = Buffer.alloc(headerLen + dataLen + mapLen);
    buf.writeUInt32BE(o_data, 0);
    buf.writeUInt32BE(o_map, 4);
    buf.writeUInt32BE(dataLen, 8);
    buf.writeUInt32BE(mapLen, 12);
    // The parser verifies the map begins with a copy of the header.
    buf.writeUInt32BE(o_data, o_map + 0);
    buf.writeUInt32BE(o_map, o_map + 4);
    buf.writeUInt32BE(dataLen, o_map + 8);
    buf.writeUInt32BE(mapLen, o_map + 12);
    buf.writeUInt16BE(typeListOffset, o_map + 24);
    buf.writeUInt16BE(nameListOffset, o_map + 26);
    // numTypes-1 = 0xFFFF  =>  (0xFFFF + 1) & 0xFFFF = 0 types.
    buf.writeUInt16BE(0xFFFF, o_map + typeListOffset);
    return buf;
}

describe("NovaParse id-space failure policy", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "novaparse-bad-plugin-"));
        fs.mkdirSync(path.join(tmpDir, "Nova Files"));
        fs.mkdirSync(path.join(tmpDir, "Plug-ins"));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function installCore() {
        fs.copyFileSync(VALID_CORE, path.join(tmpDir, "Nova Files", "Data File 1.ndat"));
    }

    it("loads ids from valid core data (sanity check)", async () => {
        installCore();
        const np = new NovaParse(tmpDir, false);
        const ids = await np.ids;
        expect(ids.Weapon.length).toBeGreaterThan(0);
    });

    it("throws (does not silently return empty ids) when core data fails to load", async () => {
        // A forkless .plug in Nova Files: read via resource fork -> ENOENT.
        fs.writeFileSync(path.join(tmpDir, "Nova Files", "Broken.plug"), Buffer.from([]));

        const np = new NovaParse(tmpDir, false);
        await expectAsync(np.ids).toBeRejected();
    });

    it("skips a single unreadable plug-in and still loads the other ids", async () => {
        installCore();
        fs.copyFileSync(VALID_PLUGIN, path.join(tmpDir, "Plug-ins", "Plugin 1.ndat"));
        // Forkless .plug: reading its resource fork throws ENOENT.
        const badPluginPath = path.join(tmpDir, "Plug-ins", "Singularity1.plug");
        fs.writeFileSync(badPluginPath, Buffer.from([]));

        const errorSpy = spyOn(console, "error").and.callThrough();

        const np = new NovaParse(tmpDir, false);
        const ids = await np.ids;

        // Ids from the good core + good plug-in survived.
        expect(ids.Weapon.length).toBeGreaterThan(0);

        // A loud error naming the exact offending file was logged.
        const loggedText = errorSpy.calls.allArgs()
            .map(args => args.map(String).join(" "))
            .join("\n");
        expect(loggedText).toContain("FAILED to load plug-in");
        expect(loggedText).toContain("Singularity1.plug");
    });

    it("names the underlying error when skipping a bad plug-in", async () => {
        installCore();
        fs.writeFileSync(path.join(tmpDir, "Plug-ins", "Singularity1.plug"), Buffer.from([]));

        const errorSpy = spyOn(console, "error").and.callThrough();

        const np = new NovaParse(tmpDir, false);
        await np.ids;

        const loggedText = errorSpy.calls.allArgs()
            .map(args => args.map(String).join(" "))
            .join("\n");
        // The underlying missing-resource-fork error is surfaced. The errno
        // is platform-dependent: on macOS opening "..namedfork/rsrc" on a
        // regular file yields ENOENT (the named fork simply doesn't exist),
        // while on Linux the path traversal fails at the regular-file
        // component and yields ENOTDIR instead. Either way the parser must
        // surface the underlying error rather than silently swallowing it.
        expect(loggedText).toMatch(/ENOENT|ENOTDIR/);
    });

    // isDirectory (fs.stat) rejects on anything but ENOENT. Before the
    // stat moved inside the per-plug-in isolation, one such entry rejected
    // build() and took every id with it. A symlink loop gives a
    // deterministic ELOOP without touching permissions.
    it("skips a Plug-ins entry whose stat fails (ELOOP) and still loads the other ids", async () => {
        installCore();
        fs.copyFileSync(VALID_PLUGIN, path.join(tmpDir, "Plug-ins", "Plugin 1.ndat"));
        const loopPath = path.join(tmpDir, "Plug-ins", "Loop.plug");
        fs.symlinkSync("Loop.plug", loopPath);

        const errorSpy = spyOn(console, "error").and.callThrough();

        const np = new NovaParse(tmpDir, false);
        const ids = await np.ids;
        expect(ids.Weapon.length).toBeGreaterThan(0);
        expect(ids.Weapon).toContain("Plugin 1:150");

        const loggedText = errorSpy.calls.allArgs()
            .map(args => args.map(String).join(" "))
            .join("\n");
        expect(loggedText).toContain("FAILED to load plug-in");
        expect(loggedText).toContain("Loop.plug");
        expect(loggedText).toContain("ELOOP");
    });

    it("warns loudly (mentioning the xattr/resource-fork gotcha) for a plug-in that parses to zero resources", async () => {
        installCore();
        fs.writeFileSync(
            path.join(tmpDir, "Plug-ins", "StrippedFork.ndat"),
            makeEmptyResourceFork());

        const warnSpy = spyOn(console, "warn").and.callThrough();

        const np = new NovaParse(tmpDir, false);
        await np.ids;

        const loggedText = warnSpy.calls.allArgs()
            .map(args => args.map(String).join(" "))
            .join("\n");
        expect(loggedText).toContain("ZERO resources");
        expect(loggedText).toContain("StrippedFork.ndat");
        expect(loggedText.toLowerCase()).toContain("resource fork");
        expect(loggedText).toContain("xattr");
    });
});

describe("IDSpaceHandler failure policy", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "novaparse-idspace-"));
        fs.mkdirSync(path.join(tmpDir, "Nova Files"));
        fs.mkdirSync(path.join(tmpDir, "Plug-ins"));
        fs.copyFileSync(VALID_CORE, path.join(tmpDir, "Nova Files", "Data File 1.ndat"));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // readNovaFile constructs resources type by type in enum order,
    // writing each into the shared id space as it goes. Three
    // constructors throw on malformed input (bööm, shän, rlëD); before
    // per-resource isolation, one such throw escaped mid-file, so the
    // types before it (oütf) survived and the types after it (shïp)
    // vanished, with a log claiming the whole file was skipped.
    it("drops only the malformed resource of a plug-in and names it", async () => {
        // Empty oütf/shïp data: every field takes its Reader default, which
        // the constructors accept. A 3-byte rlëD cannot hold its size header.
        const partial = buildResourceFork([
            { type: "oütf", id: 900, name: "Keycard", data: [] },
            { type: "rlëD", id: 900, name: "Torn", data: [0, 0, 0] },
            { type: "shïp", id: 900, name: "Kilmura", data: [] },
        ]);
        fs.writeFileSync(path.join(tmpDir, "Plug-ins", "Partial.ndat"),
            Buffer.from(partial));
        const errorSpy = spyOn(console, "error").and.callThrough();

        const handler = new IDSpaceHandler(tmpDir);
        const idSpace = await handler.getIDSpace();

        expect(idSpace.oütf["Partial:900"]?.name).toEqual("Keycard");
        expect(idSpace.shïp["Partial:900"]?.name).toEqual("Kilmura");
        expect(idSpace.rlëD["Partial:900"]).toBeUndefined();
        // Core weapons are untouched.
        expect(Object.keys(idSpace.wëap).length).toBeGreaterThan(0);

        const loggedText = errorSpy.calls.allArgs()
            .map(args => args.map(String).join(" "))
            .join("\n");
        expect(loggedText).toContain("rlëD");
        expect(loggedText).toContain("900");
        expect(loggedText).toContain("Partial.ndat");
        // The file itself was NOT skipped.
        expect(loggedText).not.toContain("FAILED to load plug-in");
    });

    it("getIDSpace succeeds even when a plug-in is unreadable (plug-in skipped)", async () => {
        fs.writeFileSync(path.join(tmpDir, "Plug-ins", "Singularity1.plug"), Buffer.from([]));
        spyOn(console, "error").and.callThrough();

        const handler = new IDSpaceHandler(tmpDir);
        const idSpace = await handler.getIDSpace();
        // Core weapons still present.
        expect(Object.keys(idSpace.wëap).length).toBeGreaterThan(0);
    });

    it("getIDSpace rejects when core Nova Files data is unreadable", async () => {
        fs.writeFileSync(path.join(tmpDir, "Nova Files", "Broken.plug"), Buffer.from([]));
        const handler = new IDSpaceHandler(tmpDir);
        await expectAsync(handler.getIDSpace()).toBeRejected();
    });
});
