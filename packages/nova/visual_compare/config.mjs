// Shared configuration for the visual-comparison harness.
//
// Everything that depends on the local machine (Chrome location, where the
// original-game reference screenshots live, which port to drive) is resolved
// here so the rest of the harness stays portable.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));

/** packages/nova */
export const NOVA_ROOT = path.resolve(here, '..');

/** Where generated captures, crops, diffs and the report land. */
export const OUTPUT_DIR = path.join(here, 'output');

/**
 * The original-game reference screenshots (1920x1080 captures of EV Nova on
 * real Mac hardware). These are NOT committed to the repo; they live in the
 * developer's main checkout. Override with NOVA_REF_DIR.
 */
export const REFERENCE_DIR = process.env.NOVA_REF_DIR
    ?? '/Users/matthew/Projects/NovaJS/ui_screenshots/original_macos_screenshots';

/** System Chrome. puppeteer-core does not ship a browser. */
export const CHROME_PATH = process.env.CHROME_PATH
    ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/**
 * Port the game server is served on. If a server is already answering here
 * the runner reuses it; otherwise it spawns its own `node dist/server.js`
 * (never any shared/preview tooling) and tears it down at the end.
 */
export const PORT = parseInt(process.env.PORT ?? '8210', 10);

export const BASE_URL = `http://localhost:${PORT}`;

/** Reference frames are 1920x1080; we match exactly, deviceScaleFactor 1. */
export const VIEWPORT = { width: 1920, height: 1080, deviceScaleFactor: 1 };

/** Flags that make headless Chrome render PIXI/WebGL via SwiftShader. */
export const CHROME_ARGS = [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--window-size=1920,1080',
    '--hide-scrollbars',
    '--mute-audio',
];

export function ensureOutputDir() {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    return OUTPUT_DIR;
}
