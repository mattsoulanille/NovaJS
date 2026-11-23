/**
 * Scenario step expansion (README "Scenarios"): a step
 *
 *   {"repeat": 12, "steps": [{"keys": "l wait 150"}, {"shot": "pass-{i}", "window": true}]}
 *
 * runs its `steps` 12 times. Every "{i}" in a string of the inner steps
 * becomes the 0-based iteration number, zero-padded to two digits
 * ("00".."11"), so shot labels stay unique. Repeats nest; an inner repeat
 * substitutes its own {i} first, so an outer {i} can't reach inside it.
 */
export function expandSteps(steps) {
    const out = [];
    for (const step of steps ?? []) {
        if (step && typeof step === "object" && step.repeat !== undefined) {
            const n = step.repeat;
            if (!Number.isInteger(n) || n < 0) throw new Error(`repeat must be a non-negative integer: ${JSON.stringify(step)}`);
            if (!Array.isArray(step.steps)) throw new Error(`repeat needs a "steps" array: ${JSON.stringify(step)}`);
            const inner = expandSteps(step.steps);
            for (let i = 0; i < n; i++) for (const s of inner) out.push(substitute(s, String(i).padStart(2, "0")));
        } else {
            out.push(step);
        }
    }
    return out;
}

function substitute(v, i) {
    if (typeof v === "string") return v.replaceAll("{i}", i);
    if (Array.isArray(v)) return v.map((x) => substitute(x, i));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, substitute(x, i)]));
    return v;
}
