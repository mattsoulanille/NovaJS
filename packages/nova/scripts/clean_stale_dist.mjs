#!/usr/bin/env node
/**
 * Removes dist/ files with no source counterpart (issue #254).
 *
 * `tsc` incremental builds never delete the outputs of files that were
 * moved: after `git mv src/nova_plugin/<mod>.ts src/nova_plugin/<domain>/<mod>.ts`
 * an existing checkout keeps the old flat dist/src/nova_plugin/<mod>.js
 * beside dist/src/nova_plugin/<domain>/<mod>.js. Jasmine's `dist/**`/*_test.js`
 * glob then loads and runs BOTH copies — duplicate specs, and modules that
 * register at load time register twice ("Simulation bridge event name
 * DeathEvent is already registered"). `tsc --build --clean` does not help:
 * it removes the outputs of the CURRENT program, which no longer mentions
 * the moved file, so the stale output survives it.
 *
 * So the build runs this script first. It walks dist/ and deletes every
 * file whose source does not exist. tsc's rootDir is the package root
 * (packages/nova/tsconfig.json), so a compiled file's source is found by
 * stripping `dist/` and the compilation suffix:
 *
 *     dist/<rel>.js      <- <rel>.ts
 *     dist/<rel>.js.map  <- <rel>.ts
 *     dist/<rel>.d.ts    <- <rel>.ts
 *
 * Anything else is someone else's output and is left alone: esbuild
 * bundles (`*_bundle.js`, `*.cjs` and their maps) are not per-file
 * outputs at all — esbuild.config.js rewrites them wholesale on every
 * build — and `tsconfig.tsbuildinfo` is tsc's own incremental state.
 *
 * Empty directories are pruned on the way back up. The script never
 * touches anything outside the dist/ directory it is given.
 *
 * Usage: node scripts/clean_stale_dist.mjs [distDir]   (default: ./dist)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const distDir = path.resolve(
    process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)),
        '..', 'dist'));

if (!fs.existsSync(distDir)) {
    // Nothing built yet: nothing to clean.
    process.exit(0);
}

const packageRoot = path.dirname(distDir);
const removed = [];

/** The source a compiled dist file is an output of, or null if it has none. */
function sourceOf(distFile) {
    const rel = path.relative(distDir, distFile);
    const source = path.join(packageRoot, rel);
    if (/\.(js|js\.map|d\.ts)$/.test(source)
        && fs.existsSync(source.replace(/\.(js|js\.map|d\.ts)$/, '.ts'))) {
        return source;
    }
    return null;
}

/** Whether a file is an esbuild bundle (rebuilt wholesale every build). */
function isBundle(distFile) {
    return /_bundle\.js(\.map)?$/.test(distFile) || /\.cjs(\.map)?$/.test(distFile);
}

function clean(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            clean(abs);
            if (fs.readdirSync(abs).length === 0) {
                fs.rmdirSync(abs);
            }
            continue;
        }
        if (entry.name === 'tsconfig.tsbuildinfo' || isBundle(abs)) {
            continue;
        }
        if (sourceOf(abs) === null && /\.(js|js\.map|d\.ts)$/.test(abs)) {
            fs.unlinkSync(abs);
            removed.push(path.relative(distDir, abs));
        }
    }
}

clean(distDir);

if (removed.length > 0) {
    console.log(`clean_stale_dist: removed ${removed.length} stale file(s) `
        + `with no source counterpart:`);
    for (const file of removed) {
        console.log(`  ${file}`);
    }
}
