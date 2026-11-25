#!/usr/bin/env node
/**
 * Where (and at what scale) does a stock rlëD frame sit in a window shot?
 * Wave 23: the stellar hail's picture well (is an oversized stellar clipped
 * at 1:1 or scaled to fit, which frame of an animated one is drawn).
 *
 *   node analysis/sprite_match.mjs <shot.png> <rledId> --rect x0,y0,x1,y1
 *        [--frames all|0|0-41] [--scales 1,0.95,0.9] [--step 1] [--clip x0,y0,x1,y1]
 *
 * The frame (nearest-neighbour scaled) is slid over every offset whose
 * centre lies in --rect; only its opaque pixels are compared (and, with
 * --clip, only those inside that rect, e.g. the well's interior, so a
 * clipped sprite is judged on its visible part). Prints the best offset per
 * scale and frame as JSON lines, best first: {frame, scale, x, y (top-left
 * in the shot), cx, cy (the frame's centre), rmse (0-1 per channel), n}.
 * Names resolve against packages/nova/Nova_Data (stock data only).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { IDSpaceHandler } from "novaparse/id_space_handler";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { PNG } = createRequire(import.meta.url)("pngjs");
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const [shotPath, rledArg] = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
if (!shotPath || !rledArg) { console.error("usage: sprite_match.mjs <shot.png> <rledId> --rect x0,y0,x1,y1 [--frames all] [--scales 1] [--clip x0,y0,x1,y1]"); process.exit(2); }
const rect = opt("--rect").split(",").map(Number);
const clip = opt("--clip") ? opt("--clip").split(",").map(Number) : [0, 0, 1e9, 1e9];
const scales = opt("--scales", "1").split(",").map(Number);
const step = Number(opt("--step", "1"));

const shot = PNG.sync.read(fs.readFileSync(shotPath));
const space = await new IDSpaceHandler(path.resolve(HERE, "../../../packages/nova/Nova_Data"), { novaFiles: "Nova Files", novaPlugins: null }).getIDSpace();
const rled = space.rlëD[`nova:${rledArg}`];
if (!rled) { console.error(`no rlëD ${rledArg}`); process.exit(1); }
const frames = rled.frames;
const fsel = opt("--frames", "0");
const idx = fsel === "all" ? frames.map((_, i) => i) : fsel.includes("-") ? (() => { const [a, b] = fsel.split("-").map(Number); return Array.from({ length: b - a + 1 }, (_, i) => a + i); })() : fsel.split(",").map(Number);

function scaled(fr, s) {
    const w = Math.max(1, Math.round(fr.width * s)), h = Math.max(1, Math.round(fr.height * s));
    const px = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const sx = Math.min(fr.width - 1, Math.floor(x / s)), sy = Math.min(fr.height - 1, Math.floor(y / s));
        const i = (sy * fr.width + sx) * 4;
        if (fr.data[i + 3] > 128) px.push([x, y, fr.data[i], fr.data[i + 1], fr.data[i + 2]]);
    }
    return { w, h, px };
}
const results = [];
for (const f of idx) {
    for (const s of scales) {
        const t = scaled(frames[f], s);
        // Coarse-to-fine: a sparse pixel subset first, then all pixels around the best few offsets.
        const sub = t.px.filter((_, i) => i % 7 === 0);
        const score = (ox, oy, pts) => {
            let e = 0, n = 0;
            for (const [x, y, r, g, b] of pts) {
                const X = ox + x, Y = oy + y;
                if (X < clip[0] || Y < clip[1] || X > clip[2] || Y > clip[3] || X < 0 || Y < 0 || X >= shot.width || Y >= shot.height) continue;
                const i = (Y * shot.width + X) * 4;
                e += (shot.data[i] - r) ** 2 + (shot.data[i + 1] - g) ** 2 + (shot.data[i + 2] - b) ** 2; n += 3;
            }
            return n > 300 ? { rmse: Math.sqrt(e / n) / 255, n: n / 3 } : null;
        };
        const cand = [];
        for (let cy = rect[1]; cy <= rect[3]; cy += step) for (let cx = rect[0]; cx <= rect[2]; cx += step) {
            const ox = Math.round(cx - t.w / 2), oy = Math.round(cy - t.h / 2);
            const sc = score(ox, oy, sub);
            if (sc) cand.push({ ox, oy, ...sc });
        }
        cand.sort((a, b) => a.rmse - b.rmse);
        let best = null;
        for (const c of cand.slice(0, 5)) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const sc = score(c.ox + dx, c.oy + dy, t.px);
            if (sc && (!best || sc.rmse < best.rmse)) best = { frame: f, scale: s, x: c.ox + dx, y: c.oy + dy, cx: c.ox + dx + t.w / 2, cy: c.oy + dy + t.h / 2, w: t.w, h: t.h, rmse: +sc.rmse.toFixed(4), n: sc.n };
        }
        if (best) results.push(best);
    }
}
results.sort((a, b) => a.rmse - b.rmse);
for (const r of results.slice(0, Number(opt("--top", "8")))) console.log(JSON.stringify(r));
