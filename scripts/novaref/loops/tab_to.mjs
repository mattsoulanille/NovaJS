/**
 * Press Tab until the bracketed target is a disc hull of one colour (wave
 * 12: pick a Kit Prey / Kit Brave Trader among several ships). Run as
 * `{"script": "../loops/tab_to.mjs", "args": {"colour": "cyan"}}`.
 *
 *  - `args.colour`: "yellow" | "cyan" | "green" | "magenta" | "red" |
 *    "blue". The target panel shows only the NAME of a kit hull (no
 *    picture), so the loop finds the target brackets in the play area
 *    (analysis/brackets.mjs, any bracket colour) and counts that colour's
 *    pixels within 8 px of the box's centre: at least `args.minN`
 *    (default 20) means the disc under the brackets is that colour.
 *  - up to `args.tries` (default 12) Tab presses, `args.waitMs` (default
 *    500) apart, with a window shot after each.
 *
 * Returns {ok, tabs, found, shot, bracket}.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import { bracketsIn } from "../analysis/brackets.mjs";

const { PNG } = createRequire(import.meta.url)("pngjs");

export const COLOUR_TESTS = {
    yellow: (r, g, b) => r > 170 && g > 170 && b < 90,
    cyan: (r, g, b) => r < 90 && g > 170 && b > 170,
    green: (r, g, b) => r < 90 && g > 170 && b < 90,
    magenta: (r, g, b) => r > 170 && b > 170 && g < 90,
    red: (r, g, b) => r > 170 && g < 90 && b < 90,
    blue: (r, g, b) => r < 90 && g < 90 && b > 170,
};

/** Pixels of `colour` within `radius` px of (cx, cy) in a PNG. */
export function colourNear(png, colour, cx, cy, radius = 8) {
    const test = COLOUR_TESTS[colour];
    if (!test) throw new Error(`unknown colour ${colour}`);
    const { width: W, height: H, data } = png;
    let n = 0;
    for (let y = Math.max(0, Math.round(cy - radius)); y <= Math.min(H - 1, Math.round(cy + radius)); y++) {
        for (let x = Math.max(0, Math.round(cx - radius)); x <= Math.min(W - 1, Math.round(cx + radius)); x++) {
            const i = (y * W + x) * 4;
            if (test(data[i], data[i + 1], data[i + 2])) n++;
        }
    }
    return n;
}

/** The ship-bracket box in a window shot (yellow / red / green / grey corners), or null. */
export function shipBracket(png) {
    const found = bracketsIn(png.data, png.width, png.height, { colours: ["yellow", "red", "green", "grey"] });
    return found[0] ?? null;
}

export default async function tabTo(api, args = {}) {
    const colour = args.colour ?? "cyan";
    const minN = args.minN ?? 20;
    let last = null;
    for (let t = 0; t < (args.tries ?? 12); t++) {
        await api.step({ keys: `Tab wait ${args.waitMs ?? 500}` });
        const r = await api.step({ shot: `tab-${colour}-${String(t).padStart(2, "0")}`, window: true });
        const png = PNG.sync.read(fs.readFileSync(r.path));
        const box = shipBracket(png);
        const n = box ? colourNear(png, colour, box.cx, box.cy) : 0;
        const bracket = box ? { colour: box.colour, cx: box.cx, cy: box.cy } : null;
        api.log({ tab: t, colour, n, bracket, shot: r.path });
        last = r.path;
        if (n >= minN) return { ok: true, tabs: t + 1, found: true, shot: r.path, bracket };
    }
    return { ok: true, tabs: args.tries ?? 12, found: false, shot: last };
}
