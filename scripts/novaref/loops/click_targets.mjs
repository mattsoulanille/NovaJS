/**
 * Target ships by clicking them (wave 9, target brackets), run as a
 * scenario `{"script": "../loops/click_targets.mjs", "args": {...}}` step.
 *
 * Tab never selects the player's own escorts on the original (wave 9: 30
 * Tabs with six escorts on screen all said "No Target"), but a click on a
 * ship in the play area targets it. Each round:
 *
 *  1. a window shot (`scan-NN`); the ship sprites in it are the bright
 *     connected blobs (pixels within `reach` px joined, so a hull's parts
 *     count as one) of at least `minN` pixels, away from the player at the
 *     centre (`exclude` px) and from the play area's edge (`edge` px);
 *  2. up to `perRound` of them, largest first: click the blob pixel
 *     nearest its centroid, park the mouse outside the window (the cursor
 *     sprite would otherwise sit in the shot), wait `settleMs`, and shoot
 *     (`click-NN-K`);
 *  3. `turnKeys` (default a short Left) so escorts re-form and turn.
 *
 * `args.keysShots` ([[keys, label], ...]) run once after the first round,
 * each followed by a shot (e.g. `["r wait 700", "r-key"]`). Returns {ok,
 * clicks: [{round, k, x, y, n, bbox, shot}]}; read the shots with
 * analysis/brackets.mjs and the target panel for the class.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import { components } from "../analysis/brackets.mjs";

const { PNG } = createRequire(import.meta.url)("pngjs");

export const CX = 318, CY = 302, PLAY_W = 636, PLAY_H = 604;

/**
 * Ship-sized bright blobs in an RGBA window shot, largest first:
 * [{x, y, n, x0, y0, x1, y1}] where (x, y) is the blob's own pixel nearest
 * its centroid (a click there lands on the sprite even for a crescent).
 */
export function shipBlobs(png, { minN = 60, exclude = 20, edge = 6, reach = 2, minSum = 90 } = {}) {
    const { width: W, data } = png;
    const H = Math.min(png.height, PLAY_H);
    const mask = new Uint8Array(PLAY_W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < PLAY_W; x++) {
        if ((x - CX) ** 2 + (y - CY) ** 2 <= exclude * exclude) continue;
        const i = (y * W + x) * 4;
        if (data[i] + data[i + 1] + data[i + 2] >= minSum) mask[y * PLAY_W + x] = 1;
    }
    const out = [];
    for (const c of components(mask, PLAY_W, H, reach)) {
        if (c.n < minN) continue;
        if (c.x0 < edge || c.y0 < edge || c.x1 >= PLAY_W - edge || c.y1 >= H - edge) continue;
        let best = null, bd = Infinity;
        for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
            if (!mask[y * PLAY_W + x]) continue;
            const d = (x - c.cx) ** 2 + (y - c.cy) ** 2;
            if (d < bd) { bd = d; best = [x, y]; }
        }
        out.push({ x: best[0], y: best[1], n: c.n, x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 });
    }
    return out.sort((a, b) => b.n - a.n);
}

export default async function clickTargets(api, args = {}) {
    const rounds = args.rounds ?? 6;
    const perRound = args.perRound ?? 6;
    const settleMs = args.settleMs ?? 700;
    const turnKeys = args.turnKeys ?? "Left@300 wait 600";
    const clicks = [];
    const shot = async (label) => {
        const r = await api.step({ shot: label, window: true });
        return { png: PNG.sync.read(fs.readFileSync(r.path)), file: r.path };
    };
    for (let round = 0; round < rounds; round++) {
        const rr = String(round).padStart(2, "0");
        const scan = await shot(`scan-${rr}`);
        const blobs = shipBlobs(scan.png, args).slice(0, perRound);
        api.log({ round, blobs });
        for (let k = 0; k < blobs.length; k++) {
            const b = blobs[k];
            await api.step({ click: [b.x, b.y], win: true });
            await api.step({ move: true });
            await api.step({ wait: settleMs });
            const s = await shot(`click-${rr}-${k}`);
            clicks.push({ round, k, x: b.x, y: b.y, n: b.n, bbox: [b.x0, b.y0, b.x1, b.y1], shot: s.file });
        }
        if (round === 0) {
            for (const [keys, label] of args.keysShots ?? []) {
                await api.step({ keys });
                await shot(label);
            }
        }
        if (round < rounds - 1 && turnKeys) await api.step({ keys: turnKeys });
    }
    return { ok: true, clicks };
}
