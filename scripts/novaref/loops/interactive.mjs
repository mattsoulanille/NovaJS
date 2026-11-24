/**
 * Hand-driven steps inside a run (wave 13). A scenario step
 * `{"script": "../loops/interactive.mjs", "args": {"inbox": "/path/in.jsonl"}}`
 * keeps the run (its lock, plug-ins, recording and frame stamps) alive and
 * executes ordinary steps appended to the inbox file, one JSON step per
 * line, so a driver can look at a shot before choosing the next click:
 *
 *   echo '{"click":[287,362],"win":true}' >> in.jsonl
 *   echo '{"shot":"after-abort","window":true}' >> in.jsonl
 *   echo '{"done":true}' >> in.jsonl     # back to the scenario's next step
 *
 * Every result is appended to `<inbox>.out` (`{"i", "step", "result"}`, a
 * shot's result carries its local `path`). The inbox is read from where it
 * stood when the step started, so old lines are never replayed. The same
 * rules as any script step apply (no Escape, no nested scripts); a failed
 * step is reported in the outbox and does not end the loop. It ends on
 * `{"done": true}` or after `args.maxMs` (default 20 min) without one.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Complete JSON lines of `text` from character `from` on: {steps, next}. */
export function readNewLines(text, from) {
    const end = text.lastIndexOf("\n") + 1;
    if (end <= from) return { steps: [], next: from };
    const steps = text.slice(from, end).split("\n").filter((l) => l.trim()).map((l) => {
        try { return JSON.parse(l); } catch { return { bad: l }; }
    });
    return { steps, next: end };
}

export default async function interactive(api, args = {}) {
    if (!args.inbox) return { ok: false, error: "args.inbox is required" };
    const inbox = args.inbox.replace(/^~(?=\/)/, os.homedir());
    fs.mkdirSync(path.dirname(inbox), { recursive: true });
    const outbox = `${inbox}.out`;
    if (!fs.existsSync(inbox)) fs.writeFileSync(inbox, "");
    let pos = fs.readFileSync(inbox, "utf8").length;
    const deadline = Date.now() + (args.maxMs ?? 20 * 60 * 1000);
    const pollMs = args.pollMs ?? 300;
    let n = 0;
    const write = (o) => fs.appendFileSync(outbox, JSON.stringify(o) + "\n");
    write({ ready: true, dir: api.dir });
    api.log({ interactive: "ready", inbox });
    while (Date.now() < deadline) {
        // A removed or truncated inbox starts over from its beginning
        // (wave 13: a second queue's setup deleted it mid-run).
        const text = fs.existsSync(inbox) ? fs.readFileSync(inbox, "utf8") : "";
        if (text.length < pos) pos = 0;
        const { steps, next } = readNewLines(text, pos);
        pos = next;
        for (const step of steps) {
            if (step.done) {
                write({ done: true, steps: n });
                return { ok: true, steps: n, ended: "done" };
            }
            let result;
            try {
                if (step.bad) throw new Error(`not JSON: ${step.bad}`);
                result = await api.step(step);
            } catch (e) {
                result = { ok: false, error: String(e.message ?? e) };
            }
            write({ i: n++, step, result });
            api.log({ interactive: n - 1, step, ok: result?.ok !== false });
        }
        await sleep(pollMs);
    }
    write({ timeout: true, steps: n });
    return { ok: true, steps: n, ended: "timeout" };
}
