/**
 * Target a magenta pointer/disc ship and fire at it one tap at a time
 * until the target panel says "Disabled" (wave 11, reviving a disabled
 * ally). Run as `{"script": "../loops/disable.mjs", "args": {...}}`.
 *
 *  - `args.target`: "tab" presses Tab until the panel names a target
 *    (mission ships); "click" clicks the magenta sprite found in a window
 *    shot (the player's own escorts, which Tab never selects: wave 9), then
 *    parks the mouse outside the window.
 *  - then up to `args.maxTaps` times: `args.fireKeys` (default one 100 ms
 *    Space tap), wait `args.waitMs`, shoot; stop as soon as the panel shows
 *    "Disabled" (`disabledWord`), or the target is gone.
 *
 * Returns {ok, taps, disabled, shots}.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import { disabledWord, findColour, isMagenta, targetShown } from "./board.mjs";

export { disabledWord };

const { PNG } = createRequire(import.meta.url)("pngjs");


export default async function disable(api, args = {}) {
    let n = 0;
    const shoot = async (label) => {
        const r = await api.step({ shot: `${label}-${String(n++).padStart(2, "0")}`, window: true });
        return { png: PNG.sync.read(fs.readFileSync(r.path)), file: r.path };
    };
    let s = await shoot("dis-start");
    if (args.target === "click") {
        for (let t = 0; t < (args.clickTries ?? 3) && !targetShown(s.png); t++) {
            const d = findColour(s.png, isMagenta, 12);
            if (!d) return { ok: false, error: "no magenta ship on screen" };
            await api.step({ click: [Math.round(d.x), Math.round(d.y)], win: true });
            await api.step({ move: true });
            await api.step({ wait: 400 });
            s = await shoot("dis-click");
            api.log({ click: [Math.round(d.x), Math.round(d.y)], targeted: targetShown(s.png) });
        }
    } else {
        for (let t = 0; t < (args.tabTries ?? 3) && !targetShown(s.png); t++) {
            await api.step({ keys: "Tab wait 500" });
            s = await shoot("dis-tab");
        }
    }
    if (!targetShown(s.png)) return { ok: false, error: "nothing targeted" };
    const shots = [];
    let taps = 0;
    for (; taps < (args.maxTaps ?? 10); taps++) {
        if (disabledWord(s.png)) break;
        await api.step({ keys: `${args.fireKeys ?? "Space@100"} wait ${args.waitMs ?? 1800}` });
        s = await shoot("dis-tap");
        const rec = { tap: taps, disabled: disabledWord(s.png), targeted: targetShown(s.png), shot: s.file };
        shots.push(rec);
        api.log(rec);
        if (!rec.targeted) break;
    }
    return { ok: true, taps, disabled: disabledWord(s.png), shots };
}
