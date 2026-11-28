#!/usr/bin/env node
/**
 * Shot-cap rig (kits/w58_shotcap.mjs): counts the orange SC Star bolts on
 * screen per frame of a window-cropped recording, and groups them by their
 * distance from the player (the play area's centre) into rings of 30 px
 * (one ring per second of the bolts' age, at 1 px a frame).
 *
 *   node scripts/novaref/analysis/shotcap.mjs <recording.mp4> [--every 15] [--from F] [--to F]
 *
 * Prints one line per sampled frame: frame, bolts seen, and the count per
 * 30 px ring band (band k holds bolts 30k..30k+29 px out). A bolt is a
 * connected blob of saturated orange/yellow pixels (R high, B low), so the
 * white stars and the cyan target ring are ignored.
 */
import { spawnSync } from "node:child_process";

const W = 832, H = 604, PLAY_W = 636, CX = 318, CY = 302;
const args = process.argv.slice(2);
const file = args[0];
const opt = (n, d) => (args.includes(n) ? Number(args[args.indexOf(n) + 1]) : d);
const every = opt("--every", 15);
const raw = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 8 * 1024 * 1024 * 1024 }).stdout;
const frames = raw.length / (W * H * 3);
const from = opt("--from", 0), to = Math.min(opt("--to", frames - 1), frames - 1);
for (let i = from; i <= to; i += every) {
    const f = raw.subarray(i * W * H * 3, (i + 1) * W * H * 3);
    const mask = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < PLAY_W; x++) {
        const p = y * W + x;
        const r = f[3 * p], g = f[3 * p + 1], b = f[3 * p + 2];
        if (r > 120 && r - b > 80 && g < r) mask[p] = 1;
    }
    const seen = new Uint8Array(W * H);
    const bands = [];
    let n = 0;
    for (let p = 0; p < W * H; p++) {
        if (!mask[p] || seen[p]) continue;
        const st = [p]; seen[p] = 1; let k = 0, sx = 0, sy = 0;
        while (st.length) {
            const q = st.pop(); k++; sx += q % W; sy += (q / W) | 0;
            for (const r of [q - 1, q + 1, q - W, q + W, q - W - 1, q - W + 1, q + W - 1, q + W + 1]) {
                if (r >= 0 && r < W * H && mask[r] && !seen[r]) { seen[r] = 1; st.push(r); }
            }
        }
        if (k < 3) continue;
        const d = Math.hypot(sx / k - CX, sy / k - CY);
        const band = Math.floor(d / 30);
        bands[band] = (bands[band] ?? 0) + 1;
        n++;
    }
    console.log(`${i}\t${n}\t${Array.from(bands, v => v ?? 0).join(" ")}`);
}
