import 'jasmine';
import { execFileSync, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Specs for scripts/clean_stale_dist.mjs, the build step that removes
 * dist/ files with no source counterpart (issue #254).
 *
 * tsc's incremental builds never delete the outputs of files that were
 * moved: after `git mv src/nova_plugin/<mod>.ts src/nova_plugin/<domain>/<mod>.ts`
 * an existing checkout keeps the old flat dist/src/nova_plugin/<mod>.js
 * beside dist/src/nova_plugin/<domain>/<mod>.js, and jasmine's
 * `dist/**`/*_test.js` glob then loads and runs both copies (duplicate
 * specs; modules with load-time registration register twice). Case-only
 * renames are the same trap on case-sensitive filesystems
 * (Gettable_test.js beside gettable_test.js).
 *
 * The specs run the real script as a subprocess against a synthetic tree
 * in a temp directory, laid out the way the packages are: the dist
 * directory's parent is the package root, and a compiled file's source is
 * the package-root-relative path with dist/ and the compilation suffix
 * stripped — either as-is (nova, novaparse: dist mirrors the root) or
 * under src/ (nova_ecs, novadatainterface, resource_fork: dist mirrors
 * src/).
 */

const SCRIPT = fileURLToPath(
    new URL('../../../scripts/clean_stale_dist.mjs', import.meta.url));

/** Whether the filesystem holding `dir` distinguishes letter case. */
function isCaseSensitive(dir: string): boolean {
    const probe = path.join(dir, 'cleanstaledistcaseprobe.ts');
    fs.writeFileSync(probe, 'export {};');
    const insensitive = fs.existsSync(probe.toUpperCase());
    fs.unlinkSync(probe);
    return !insensitive;
}

/** A dist file that exists and a source tree that does not explain it. */
function makeTree(root: string, files: Record<string, string>): void {
    for (const [rel, contents] of Object.entries(files)) {
        const abs = path.join(root, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, contents);
    }
}

function runCleaner(distDir: string): string {
    return execFileSync(process.execPath, [SCRIPT, distDir], {
        encoding: 'utf8',
    });
}

/** Run the cleaner with no distDir argument, from another package's root. */
function runCleanerDefaultingToCwd(cwd: string): string {
    return execFileSync(process.execPath, [SCRIPT], {
        encoding: 'utf8',
        cwd,
    });
}

describe('clean_stale_dist', () => {
    let tmp: string;
    let dist: string;

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clean_stale_dist_'));
        dist = path.join(tmp, 'dist');
    });

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('removes a stale flat module left beside its moved domain directory', () => {
        // The issue #254 shape: nova_plugin/<mod>.ts moved into
        // nova_plugin/<domain>/, tsc rebuilt the new location but never
        // deleted the old flat output.
        makeTree(dist, {
            'src/nova_plugin/reputation.js': 'old flat output',
            'src/nova_plugin/reputation.js.map': '{}',
            'src/nova_plugin/reputation.d.ts': 'old flat types',
            'src/nova_plugin/reputation/reputation.js': 'current output',
        });
        makeTree(tmp, {
            'src/nova_plugin/reputation/reputation.ts': 'export const x = 1;',
        });

        runCleaner(dist);

        expect(fs.existsSync(path.join(dist, 'src/nova_plugin/reputation.js')))
            .toBeFalse();
        expect(fs.existsSync(path.join(dist, 'src/nova_plugin/reputation.js.map')))
            .toBeFalse();
        expect(fs.existsSync(path.join(dist, 'src/nova_plugin/reputation.d.ts')))
            .toBeFalse();
        // The moved module's new output survives.
        expect(fs.existsSync(
            path.join(dist, 'src/nova_plugin/reputation/reputation.js')))
            .toBeTrue();
    });

    it('keeps outputs whose source still exists', () => {
        // nova's layout: dist mirrors the package root, so dist/server.js
        // comes from the root server.ts and dist/src/<x>.js from src/<x>.ts.
        makeTree(dist, {
            'server.js': 'server',
            'server.js.map': '{}',
            'src/util/deimmerify.js': 'util',
            'src/util/deimmerify.js.map': '{}',
            'src/util/deimmerify.d.ts': 'types',
        });
        makeTree(tmp, {
            'server.ts': 'export {};',
            'src/util/deimmerify.ts': 'export {};',
        });

        runCleaner(dist);

        expect(fs.existsSync(path.join(dist, 'server.js'))).toBeTrue();
        expect(fs.existsSync(path.join(dist, 'server.js.map'))).toBeTrue();
        expect(fs.existsSync(path.join(dist, 'src/util/deimmerify.js')))
            .toBeTrue();
        expect(fs.existsSync(path.join(dist, 'src/util/deimmerify.js.map')))
            .toBeTrue();
        expect(fs.existsSync(path.join(dist, 'src/util/deimmerify.d.ts')))
            .toBeTrue();
    });

    it('keeps outputs in packages whose dist mirrors src/ directly', () => {
        // nova_ecs / novadatainterface / resource_fork layout: no src/ in
        // dist, the compiled path is the source path under src/.
        makeTree(dist, {
            'world.js': 'kept',
            'gone/gone_test.js': 'stale',
        });
        makeTree(tmp, { 'src/world.ts': 'export {};' });

        runCleaner(dist);

        expect(fs.existsSync(path.join(dist, 'world.js'))).toBeTrue();
        expect(fs.existsSync(path.join(dist, 'gone/gone_test.js'))).toBeFalse();
    });

    it('keeps outputs compiled from the test tree', () => {
        // novaparse compiles src/ and test/ into one dist/ that mirrors
        // the package root.
        makeTree(dist, {
            'test/pilot/synthetic_pilot_test.js': 'kept',
            'test/removed_test.js': 'stale',
        });
        makeTree(tmp, { 'test/pilot/synthetic_pilot_test.ts': 'export {};' });

        runCleaner(dist);

        expect(fs.existsSync(
            path.join(dist, 'test/pilot/synthetic_pilot_test.js'))).toBeTrue();
        expect(fs.existsSync(path.join(dist, 'test/removed_test.js')))
            .toBeFalse();
    });

    it('removes the stale copy of a case-only rename', () => {
        if (!isCaseSensitive(tmp)) {
            pending('case-insensitive filesystem: the stale copy IS the source');
        }
        // novadatainterface renamed Gettable_test.ts to gettable_test.ts;
        // on Linux the old output keeps loading beside the new one.
        makeTree(dist, {
            'src/gettable_test.js': 'current',
            'src/Gettable_test.js': 'stale',
        });
        makeTree(tmp, { 'src/gettable_test.ts': 'export {};' });

        runCleaner(dist);

        expect(fs.existsSync(path.join(dist, 'src/gettable_test.js')))
            .toBeTrue();
        expect(fs.existsSync(path.join(dist, 'src/Gettable_test.js')))
            .toBeFalse();
    });

    it('keeps esbuild bundles and the tsc incremental state', () => {
        // esbuild writes bundles with no per-file source counterpart
        // (browser_bundle.js from src/browser.ts, the .cjs worker bundle);
        // tsconfig.tsbuildinfo is tsc's own state, not an output.
        makeTree(dist, {
            'src/browser_bundle.js': 'bundle',
            'src/browser_bundle.js.map': '{}',
            'src/server/parsing/nova_parse_worker_bundle.cjs': 'bundle',
            'src/server/parsing/nova_parse_worker_bundle.cjs.map': '{}',
            'tsconfig.tsbuildinfo': '{"version": "5.9.3"}',
        });

        runCleaner(dist);

        expect(fs.existsSync(path.join(dist, 'src/browser_bundle.js')))
            .toBeTrue();
        expect(fs.existsSync(path.join(dist, 'src/browser_bundle.js.map')))
            .toBeTrue();
        expect(fs.existsSync(
            path.join(dist, 'src/server/parsing/nova_parse_worker_bundle.cjs')))
            .toBeTrue();
        expect(fs.existsSync(
            path.join(dist,
                'src/server/parsing/nova_parse_worker_bundle.cjs.map')))
            .toBeTrue();
        expect(fs.existsSync(path.join(dist, 'tsconfig.tsbuildinfo')))
            .toBeTrue();
    });

    it('removes directories left empty by the cleanup', () => {
        makeTree(dist, {
            'src/nova_plugin/gone/plugin.js': 'stale',
        });
        // No source anywhere: the whole gone/ subtree is stale.

        runCleaner(dist);

        expect(fs.existsSync(path.join(dist, 'src/nova_plugin/gone')))
            .toBeFalse();
    });

    it('leaves files it cannot attribute to a source alone', () => {
        // Conservative: an unrecognized file in dist/ is someone else's
        // output until proven stale.
        makeTree(dist, { 'src/misc.dat': 'data' });

        runCleaner(dist);

        expect(fs.existsSync(path.join(dist, 'src/misc.dat'))).toBeTrue();
    });

    it('cleans the invoking package when run with no argument from its root', () => {
        // The sibling packages invoke the script as
        // `node ../nova/scripts/clean_stale_dist.mjs` with no argument, so
        // the default dist directory must come from the caller's working
        // directory (npm runs build scripts in the package root), not from
        // the script's own location inside packages/nova — otherwise every
        // sibling build would clean nova's dist and never its own.
        makeTree(dist, {
            'src/world.js': 'kept',
            'src/gone.js': 'stale',
        });
        makeTree(tmp, { 'src/world.ts': 'export {};' });

        runCleanerDefaultingToCwd(tmp);

        expect(fs.existsSync(path.join(dist, 'src/gone.js'))).toBeFalse();
        expect(fs.existsSync(path.join(dist, 'src/world.js'))).toBeTrue();
    });

    it('lets concurrent cleaners race on the same dist without failing', async () => {
        // turbo runs the independent leaf packages' builds concurrently; if
        // two of them ever clean the same directory (a shared dist, or a
        // misdirected default), each scans the whole tree and then unlinks,
        // so the second unlink of an already-removed file must not crash
        // the build with ENOENT.
        const files: Record<string, string> = {};
        for (let i = 0; i < 400; i++) {
            files[`src/stale_${i}.js`] = 'stale';
        }
        makeTree(dist, files);

        // Overlap the cleaners: the script scans the whole tree before it
        // starts unlinking, so starting three together is enough for each
        // to see files another has already removed.
        const runs = [0, 1, 2].map(() => new Promise<number>((resolve) => {
            const child = spawn(process.execPath, [SCRIPT, dist],
                { stdio: ['ignore', 'ignore', 'pipe'] });
            let stderr = '';
            child.stderr.on('data', (chunk) => { stderr += String(chunk); });
            child.on('close', (code) => {
                if (code !== 0) console.error(stderr);
                resolve(code ?? 1);
            });
        }));
        await new Promise((resolve) => setTimeout(resolve, 25));

        const codes = await Promise.all(runs);
        expect(codes).toEqual([0, 0, 0]);
        expect(fs.existsSync(path.join(dist, 'src/stale_0.js'))).toBeFalse();
    });

    it('removes nothing on a second run', () => {
        makeTree(dist, { 'src/nova_plugin/reputation.js': 'stale' });

        const first = runCleaner(dist);
        const second = runCleaner(dist);

        expect(first).toContain('removed');
        expect(second).not.toContain('removed');
    });

    it('succeeds when dist does not exist yet', () => {
        expect(() => runCleaner(dist)).not.toThrow();
    });
});

describe('the build scripts that run clean_stale_dist', () => {
    const PACKAGES = fileURLToPath(new URL('../../../../', import.meta.url));
    const BUILT = ['nova', 'nova_ecs', 'novadatainterface', 'novaparse',
        'resource_fork'];

    it('run it immediately before tsc, after every source generator', () => {
        // tsc's incremental build never re-emits an output whose source is
        // unchanged according to tsconfig.tsbuildinfo, even when the output
        // file is missing. So every generated, gitignored source
        // (novadatainterface's src/default_rled.ts from build-defaults,
        // nova's src/common/generated_build_version.ts) must exist BEFORE
        // the cleaner runs: with the generator after it, a checkout whose
        // dist/ came back from the turbo cache — outputs and tsbuildinfo
        // restored, generator never run — has default_rled.js deleted as
        // stale and never written again, and the build still exits 0.
        for (const pkg of BUILT) {
            const manifest = JSON.parse(fs.readFileSync(
                path.join(PACKAGES, pkg, 'package.json'), 'utf8'));
            const steps = (manifest.scripts.build as string)
                .split('&&').map((step) => step.trim());
            const clean = steps.findIndex(
                (step) => step.includes('clean_stale_dist.mjs'));
            expect(clean).withContext(`${pkg}: build runs the cleaner`)
                .toBeGreaterThanOrEqual(0);
            expect(steps[clean + 1])
                .withContext(`${pkg}: tsc runs right after the cleaner`)
                .toBe('tsc');
        }
    });
});
