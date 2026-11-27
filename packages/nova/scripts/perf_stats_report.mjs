// The performance stats report (docs/perf_stats.md): per build and per
// session, the frame-rate distribution, the worst stalls with what was on
// screen, the simulation's rate and cost, and how frame time scales with
// entity counts.
//
//   node scripts/perf_stats_report.mjs [file-or-dir ...] [--json] [--stalls N]
//     (run from packages/nova after a build)
//
// Inputs: the server's perf_stats/<date>.jsonl files (a directory reads
// every .jsonl / .json in it; the default is perf_stats/), or a Cloud
// Logging export:
//   gcloud logging read 'resource.type="cloud_run_revision" AND
//     resource.labels.service_name="nova" AND
//     jsonPayload.logType="novajs_perf_stats"' --format=json > perf.json
// --json prints the aggregate as JSON instead of tables.
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..');
const { parsePerfStats, buildPerfReport, formatPerfReport } = await import(
    pathToFileURL(path.join(packageRoot,
        'dist/src/server/perf_stats_report.js')).href);

const args = process.argv.slice(2);
const json = args.includes('--json');
let stallLimit = 15;
const inputs = [];
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') {
        continue;
    }
    if (args[i] === '--stalls') {
        stallLimit = Number(args[++i]);
        continue;
    }
    inputs.push(args[i]);
}
if (inputs.length === 0) {
    inputs.push(path.join(packageRoot, 'perf_stats'));
}

const files = [];
for (const input of inputs) {
    if (!fs.existsSync(input)) {
        console.error(`no such file or directory: ${input}`);
        process.exit(2);
    }
    if (fs.statSync(input).isDirectory()) {
        for (const name of fs.readdirSync(input).sort()) {
            if (name.endsWith('.jsonl') || name.endsWith('.json')) {
                files.push(path.join(input, name));
            }
        }
    } else {
        files.push(input);
    }
}

const samples = [];
let skipped = 0;
for (const file of files) {
    const parsed = parsePerfStats(fs.readFileSync(file, 'utf8'));
    samples.push(...parsed.samples);
    skipped += parsed.skipped;
}
const report = buildPerfReport(samples, skipped, stallLimit);
console.log(json ? JSON.stringify(report, null, 2) : formatPerfReport(report));
