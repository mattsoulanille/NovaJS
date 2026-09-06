// Offline analyzer for a desync incident directory recorded by the
// server's DesyncRecorder (see src/server/desync_recorder.ts).
//
// Reconstructs the room's true simulation from the recorded baseline +
// input log, then works through the convicted client's uploaded state
// history in two passes:
//
//  1. Checkpoint diff: at each checkpoint the client dumped, wire-
//     encode the truth and deep-diff against the client's snapshot —
//     names the exact entities, components, and fields that diverged.
//     A checkpoint whose *hash* matched but whose wire form differs
//     exposes divergence hiding in unhashed state.
//
//  2. Infection pass: restore the client's earliest dumped checkpoint
//     into a second world and step it in lockstep with the truth,
//     applying the same input log, hashing every tick — pins the
//     exact tick where the client's state stops tracking the log.
//
// Usage: node analyze_desync.mjs <incident-dir> [serverUrl]
//   (run from packages/nova with the game server running, default
//    http://localhost:8000; the dir needs desync.json, baselines.json,
//    log.json, and at least one client_<peer>.json)
//
// Game data comes from the RUNNING SERVER over HTTP — the same parse
// the live worlds consumed — never from a local re-parse, which can
// genuinely differ for plugin content and poison every replay-based
// conclusion. The incident records a fingerprint of the data it was
// recorded under; a mismatch here means the server's data changed
// since the session and the replay cannot be trusted.
import * as fs from 'fs/promises';
import * as path from 'path';
process.chdir(path.dirname(new URL(import.meta.url).pathname));

const { makeSystem } = await import('./dist/src/nova_plugin/make_system.js');
const { SimulationGameData } = await import('./dist/src/client/gamedata/simulation_game_data.js');
const { fingerprintGameData } = await import('./dist/src/server/desync_recorder.js');
const { loadWireSnapshotGameData } = await import('./dist/src/nova_plugin/spawn/entity_data_loader.js');
const { deriveEntityComponents } = await import('./dist/src/nova_plugin/core/entity_factory.js');
const { applyInputRecords, loadInputRecordsGameData } = await import('./dist/src/communication/simulation_input.js');
const { PEER_LOCAL_COMPONENTS } = await import('./dist/src/nova_plugin/player/ship_control.js');
const { restoreWireWorldSnapshot, wireSnapshotWorld } = await import('nova_ecs/plugins/snapshot_plugin');
const { hashWorld } = await import('nova_ecs/plugins/world_hash');
const { TimeResource } = await import('nova_ecs/plugins/time_plugin');

const dir = process.argv[2];
if (!dir) {
    console.error('Usage: node analyze_desync.mjs <incident-dir> [serverUrl]');
    process.exit(1);
}
const serverUrl = process.argv[3] ?? 'http://localhost:8000';

const readJson = async name =>
    JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
const desync = await readJson('desync.json');
const baselines = await readJson('baselines.json');
const log = await readJson('log.json');
const clientFiles = (await fs.readdir(dir))
    .filter(name => name.startsWith('client_') && name.endsWith('.json'));
if (clientFiles.length === 0) {
    // The verdict and archive-state passes below run from the server
    // side alone; only the per-dump checkpoint analysis needs uploads.
    console.log('(no client dumps in this incident — the convicted '
        + 'peer\'s upload never arrived; running server-side passes only)');
}

console.log(`Incident: room ${desync.roomId}, convicted checkpoint tick `
    + `${desync.tick} at ${desync.wallTime}`);
console.log(`  reported hashes:`, Object.fromEntries(desync.hashes));
console.log(`  canonical: ${desync.canonical}, convicted:`,
    desync.convicted, desync.archiveOutvoted ? '(ARCHIVE OUTVOTED)' : '');

const tick = world => world.resources.get(TimeResource).frame;

const byTick = new Map();
for (const record of log) {
    byTick.set(record.tick, [...(byTick.get(record.tick) ?? []), record]);
}

/** Builds the truth world at `atTick` from the newest baseline not
 * after `fromTick`, replaying the log. */
async function truthAt(fromTick, atTick, gameData) {
    const world = await makeSystem(desync.roomId, gameData, 'node');
    const usable = baselines.filter(b => b.tick <= fromTick).at(-1);
    const baseline = usable ?? baselines[0];
    if (baseline) {
        if (!usable) {
            console.warn(`  (no baseline at or before tick ${fromTick}; `
                + `using tick ${baseline.tick} — earlier checkpoints are `
                + `skipped)`);
        }
        await loadWireSnapshotGameData(world, baseline.snapshot);
        await loadInputRecordsGameData(world, log);
        restoreWireWorldSnapshot(world, baseline.snapshot,
            deriveEntityComponents);
    } else {
        // A young room: no baseline captured yet, so the log is
        // untrimmed and genesis + log reconstructs everything.
        await loadInputRecordsGameData(world, log);
    }
    stepTo(world, atTick);
    return world;
}

function stepTo(world, target, records = byTick) {
    while (tick(world) < target) {
        const atTick = records.get(tick(world) + 1);
        if (atTick) {
            applyInputRecords(world, atTick);
        }
        world.step();
    }
}

function groupByTick(records) {
    const grouped = new Map();
    for (const record of records) {
        grouped.set(record.tick,
            [...(grouped.get(record.tick) ?? []), record]);
    }
    return grouped;
}

/** Replays a variant record list from genesis and counts differences
 * against a dumped checkpoint. (Only valid without a baseline gap:
 * callers check that genesis + log covers the window.) */
async function variantDiffCount(records, checkpoint, gameData) {
    const world = await makeSystem(desync.roomId, gameData, 'node');
    await loadInputRecordsGameData(world, records);
    stepTo(world, checkpoint.tick, groupByTick(records));
    return diffSnapshots(wireSnapshotWorld(world), checkpoint.snapshot);
}

/** Wire components as a name -> JSON map, peer-local excluded. */
function componentMap(wireEntity) {
    return new Map(wireEntity.components
        .filter(([name]) => !PEER_LOCAL_COMPONENTS.has(name))
        .map(([name, data]) => [name, JSON.stringify(data)]));
}

const clip = value => value.length > 200 ? value.slice(0, 200) + '…' : value;

/** Deep-diffs two wire snapshots; returns human-readable lines. */
function diffSnapshots(truth, client) {
    const lines = [];
    const truthEntities = new Map(truth.entities.map(e => [e.uuid, e]));
    const clientEntities = new Map(client.entities.map(e => [e.uuid, e]));
    for (const uuid of truthEntities.keys()) {
        if (!clientEntities.has(uuid)) {
            lines.push(`entity ${uuid} missing from client`);
        }
    }
    for (const uuid of clientEntities.keys()) {
        if (!truthEntities.has(uuid)) {
            lines.push(`entity ${uuid} extra on client`);
        }
    }
    const truthOrder = truth.entities.map(e => e.uuid).join();
    const clientOrder = client.entities.map(e => e.uuid).join();
    if (truthOrder !== clientOrder
        && lines.length === 0) {
        lines.push('entity insertion order differs (iteration-order '
            + 'divergence: same entities, different sequence)');
    }
    for (const [uuid, truthEntity] of truthEntities) {
        const clientEntity = clientEntities.get(uuid);
        if (!clientEntity) {
            continue;
        }
        const truthComponents = componentMap(truthEntity);
        const clientComponents = componentMap(clientEntity);
        const names = new Set([...truthComponents.keys(),
            ...clientComponents.keys()]);
        for (const name of names) {
            const expected = truthComponents.get(name);
            const actual = clientComponents.get(name);
            if (expected === actual) {
                continue;
            }
            const label = `${truthEntity.name ?? clientEntity.name ?? ''}`
                + `(${uuid}).${name}`;
            if (expected === undefined) {
                lines.push(`${label}: extra on client: ${clip(actual)}`);
            } else if (actual === undefined) {
                lines.push(`${label}: missing from client`);
            } else {
                lines.push(`${label}:\n    truth:  ${clip(expected)}\n`
                    + `    client: ${clip(actual)}`);
            }
        }
    }
    const truthSingleton = componentMap({ components: truth.singleton });
    const clientSingleton = componentMap({ components: client.singleton });
    for (const name of new Set([...truthSingleton.keys(),
        ...clientSingleton.keys()])) {
        if (truthSingleton.get(name) !== clientSingleton.get(name)) {
            lines.push(`singleton.${name}:\n    truth:  `
                + `${clip(truthSingleton.get(name) ?? 'absent')}\n    client: `
                + `${clip(clientSingleton.get(name) ?? 'absent')}`);
        }
    }
    truth.resources.forEach((resource, i) => {
        const expected = JSON.stringify(resource);
        const actual = JSON.stringify(client.resources[i]);
        if (expected !== actual) {
            lines.push(`resource[${i}]:\n    truth:  ${clip(expected)}\n`
                + `    client: ${clip(actual)}`);
        }
    });
    return lines;
}

const gameData = new SimulationGameData(serverUrl);
let ids;
try {
    ids = await gameData.ids;
} catch (e) {
    console.error(`Could not reach the game server at ${serverUrl} — start `
        + `it first (the replay must use the server's exact game data): ${e}`);
    process.exit(1);
}
const fingerprint = fingerprintGameData(ids);
if (desync.gameDataFingerprint && desync.gameDataFingerprint !== fingerprint) {
    console.error(`\n*** GAME DATA MISMATCH ***\n`
        + `The incident was recorded under game data ${desync.gameDataFingerprint}\n`
        + `but the server now serves ${fingerprint}. The plugins or data\n`
        + `changed since the session: replay conclusions below are suspect.\n`);
} else if (desync.gameDataFingerprint) {
    console.log(`Game data fingerprint matches the incident's `
        + `(${fingerprint}).`);
}

// Whose side is the log on? Replay to the convicted checkpoint and
// hash: matching a reporter exonerates them — including the archive's
// witness vote, which is not automatically right (a lagging client's
// retime storms provoked live-archive divergence, and the innocent
// peer was convicted on the archive's word). When the incident
// recorded the archive's per-entity hashes, a mismatch names the
// exact entities the live archive got wrong.
try {
    const verdictWorld = await truthAt(desync.tick, desync.tick, gameData);
    const hashed = hashWorld(verdictWorld, PEER_LOCAL_COMPONENTS);
    console.log(`\nReplay verdict at the convicted checkpoint `
        + `(tick ${desync.tick}):`);
    for (const [peer, hash] of desync.hashes) {
        console.log(`  ${hash === hashed.hash ? 'replay MATCHES'
            : 'replay differs from'} ${peer} (${hash})`);
    }
    if (desync.archiveEntityHashes) {
        const replayEntities = new Map(hashed.entities);
        const archiveEntities = new Map(desync.archiveEntityHashes);
        const lines = [];
        for (const [id, hash] of replayEntities) {
            if (archiveEntities.get(id) !== hash) {
                lines.push(`    ${id}: replay ${hash} vs live archive `
                    + `${archiveEntities.get(id) ?? 'ABSENT'}`);
            }
        }
        for (const id of archiveEntities.keys()) {
            if (!replayEntities.has(id)) {
                lines.push(`    ${id}: only in the live archive`);
            }
        }
        if (lines.length > 0) {
            console.log(`  the LIVE archive diverged from its own log's `
                + `replay in ${lines.length} entities:`);
            for (const line of lines.slice(0, 25)) {
                console.log(line);
            }
        } else {
            console.log('  live archive per-entity hashes match the replay.');
        }
    }
} catch (error) {
    console.warn('Replay-verdict pass failed:', error);
}

// When the incident captured the archive's full live state, diff it
// against a clean replay at the same tick: component-level evidence
// for exactly what the live archive's world got wrong.
try {
    const archiveState = JSON.parse(
        await fs.readFile(path.join(dir, 'archive_state.json'), 'utf8'));
    const replayWorld = await truthAt(archiveState.tick, archiveState.tick,
        gameData);
    const lines = diffSnapshots(wireSnapshotWorld(replayWorld),
        archiveState.snapshot);
    console.log(`\nLive archive state vs clean replay at its capture `
        + `tick (${archiveState.tick}):`);
    if (lines.length === 0) {
        console.log('  identical — the live archive re-converged by '
            + 'capture time (transient divergence).');
    } else {
        console.log(`  ${lines.length} findings (replay is "truth", the `
            + `live archive is "client"):`);
        for (const line of lines.slice(0, 30)) {
            console.log(`  - ${line}`);
        }
    }
} catch (error) {
    if (error?.code !== 'ENOENT') {
        console.warn('Archive-state pass failed:', error);
    }
}

for (const clientFile of clientFiles) {
    const dump = await readJson(clientFile);
    console.log(`\n=== ${clientFile} (engine: ${dump.engine}, dumped at `
        + `tick ${dump.tick}${dump.desyncTick !== undefined
            ? `, desync tick ${dump.desyncTick}` : ''}) ===`);
    if (dump.rollbackLog.length > 0) {
        console.log('Rollback log (how the peer got here):');
        for (const entry of dump.rollbackLog) {
            console.log(`  tick ${entry.atTick}: ${entry.event}`,
                entry.detail ?? '');
        }
    }
    // The incident's log was snapshotted when its conviction recorded:
    // replaying past that point runs without the records that arrived
    // later and produces pure artifact diffs. (A dump uploaded for a
    // later, cooldown-suppressed conviction can reach past it — pair
    // it with the NEXT incident's log instead.)
    const allCheckpoints = [...dump.checkpoints].sort((a, b) => a.tick - b.tick);
    const checkpoints = allCheckpoints.filter(c => c.tick <= desync.tick);
    if (checkpoints.length < allCheckpoints.length) {
        console.log(`(${allCheckpoints.length - checkpoints.length} `
            + `checkpoints past tick ${desync.tick} skipped: beyond this `
            + `incident's log coverage)`);
    }
    if (checkpoints.length === 0) {
        console.log('No checkpoints within this incident\'s log coverage.');
        continue;
    }

    // Pass 1: diff every dumped checkpoint against the resimulated
    // truth. One truth world steps through all of them in order.
    console.log('\nCheckpoint diffs (truth = baseline + input log):');
    const truth = await truthAt(checkpoints[0].tick, checkpoints[0].tick,
        gameData);
    let firstMismatch;
    let lastMatch;
    for (const checkpoint of checkpoints) {
        if (tick(truth) > checkpoint.tick) {
            console.log(`  tick ${checkpoint.tick}: skipped (before the `
                + `recorded baseline)`);
            continue;
        }
        stepTo(truth, checkpoint.tick);
        const lines = diffSnapshots(wireSnapshotWorld(truth),
            checkpoint.snapshot);
        if (lines.length === 0) {
            console.log(`  tick ${checkpoint.tick}: MATCH`);
            lastMatch = checkpoint;
        } else {
            console.log(`  tick ${checkpoint.tick}: DIFF `
                + `(${lines.length} finding${lines.length > 1 ? 's' : ''})`);
            for (const line of lines) {
                console.log(`  - ${line}`);
            }
            firstMismatch ??= checkpoint;
        }
    }

    // Pass 2: pin the infection tick. Step the client's last matching
    // state (or its earliest dumped state) in lockstep with the truth,
    // hashing every tick.
    const seed = lastMatch && (!firstMismatch
        || lastMatch.tick < firstMismatch.tick) ? lastMatch : checkpoints[0];
    if (!firstMismatch) {
        console.log('\nAll dumped checkpoints match the truth: the '
            + 'divergence healed before the dump, or lives in state the '
            + 'wire snapshot does not carry.');
        continue;
    }
    if (seed.tick >= firstMismatch.tick) {
        console.log(`\nThe earliest dumped checkpoint (tick ${seed.tick}) `
            + 'already differs: the divergence began before the dump\'s '
            + 'window. The diffs above are the trail, not the origin.');
        if (baselines.length > 0) {
            console.log('(Origin search needs a genesis-covering log; '
                + 'a baseline gap prevents it here.)');
            continue;
        }
        // Origin search: the most common cause of a whole-window
        // divergence is a single input record the sender applied at a
        // different tick than the room's log (a retimed record whose
        // echo failed, or a pre-echo build). Try moving each control
        // record and see if one variant reproduces the client exactly.
        console.log('Searching for a single retimed control record...');
        const candidates = log.filter(r => r.tick <= firstMismatch.tick
            && r.inputs.every(i => i.kind === 'control'));
        let found = false;
        for (const record of candidates) {
            for (const shift of [-1, -2, -3]) {
                const variant = log.map(r => r === record
                    ? { ...r, tick: r.tick + shift } : r);
                const lines = await variantDiffCount(
                    variant, firstMismatch, gameData);
                if (lines.length === 0) {
                    console.log(`  FOUND: the record logged at tick `
                        + `${record.tick} was applied by the client at `
                        + `tick ${record.tick + shift} — with that one `
                        + `shift the replay reproduces the client's `
                        + `checkpoint ${firstMismatch.tick} exactly. `
                        + `The relay retimed this record for the room `
                        + `but its sender kept the stale application.`);
                    found = true;
                    break;
                }
            }
            if (found) {
                break;
            }
        }
        if (!found) {
            console.log('  No single-record shift explains it: not a '
                + 'simple retiming. Suspect engine/computation '
                + 'divergence or a multi-record timing fault; the '
                + 'checkpoint diffs above are the trail.');
        }
        continue;
    }
    console.log(`\nInfection pass: client state at tick ${seed.tick} `
        + `matches the truth; stepping both in lockstep to find where `
        + `they part...`);
    const clientWorld = await makeSystem(desync.roomId, gameData, 'node');
    await loadWireSnapshotGameData(clientWorld, seed.snapshot);
    await loadInputRecordsGameData(clientWorld, log);
    restoreWireWorldSnapshot(clientWorld, seed.snapshot,
        deriveEntityComponents);
    const truth2 = await truthAt(seed.tick, seed.tick, gameData);
    let parted = false;
    while (tick(truth2) < firstMismatch.tick) {
        stepTo(truth2, tick(truth2) + 1);
        stepTo(clientWorld, tick(clientWorld) + 1);
        const truthHash = hashWorld(truth2, PEER_LOCAL_COMPONENTS);
        const clientHash = hashWorld(clientWorld, PEER_LOCAL_COMPONENTS);
        if (truthHash.hash !== clientHash.hash) {
            console.log(`  first divergent tick: ${tick(truth2)}`);
            const clientEntities = new Map(clientHash.entities);
            for (const [uuid, hash] of truthHash.entities) {
                if (clientEntities.get(uuid) !== hash) {
                    console.log(`  - entity ${uuid}: truth ${hash} vs `
                        + `client ${clientEntities.get(uuid) ?? 'absent'}`);
                }
            }
            parted = true;
            break;
        }
    }
    if (!parted) {
        console.log('  the lockstep replay never diverges: the client\'s '
            + 'live run diverged through timing (a rollback or late '
            + 'record), not state — see the rollback log above and the '
            + `tick ${firstMismatch.tick} diff.`);
    }
}
process.exit(0);
