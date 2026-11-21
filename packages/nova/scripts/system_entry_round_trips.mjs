// How many SEQUENTIAL game-data round trips building a system's genesis
// costs a client, and what that is in wall time at a given latency
// (issue #368). Builds each system with makeSystem — exactly what the
// main thread's serializer world and the sim worker's world each do on
// every system entry — over a COLD SimulationGameData (the worker's
// cache is fresh on every entry) pointed at a running server, with
// every request held `delayMs` first to emulate the network.
//
//   node scripts/system_entry_round_trips.mjs <serverUrl> [delayMs] [systemId...]
//     (run from packages/nova after a build; defaults: 100 ms, the
//     default pilot's possible start systems)
//
// Prints one JSON line per system: depth (the longest chain of
// dependent round trips — the number that matters), requests, batched
// POSTs, ids carried, and wall time.
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
process.chdir(path.resolve(here, '..'));

const [serverUrl, delayArg = '100', ...systemArgs] = process.argv.slice(2);
if (!serverUrl) {
    console.error('usage: node scripts/system_entry_round_trips.mjs <serverUrl> [delayMs] [systemId...]');
    process.exit(2);
}
const delayMs = Number(delayArg);

const { makeSystem } = await import('../dist/src/nova_plugin/make_system.js');
const { SimulationGameData } = await import('../dist/src/client/gamedata/simulation_game_data.js');
const { meterRoundTrips } = await import('../dist/src/client/gamedata/round_trip_meter.js');

let systems = systemArgs;
if (systems.length === 0) {
    const probe = new SimulationGameData(serverUrl);
    const ids = await probe.ids;
    const starts = await Promise.all(ids.PlayerStart.map(
        id => probe.data.PlayerStart.get(id)));
    const start = starts.find(s => s.isDefault) ?? starts[0];
    systems = start?.systems.length ? start.systems : [ids.System[0]];
}

for (const systemId of systems) {
    const meter = meterRoundTrips(fetch, delayMs);
    const gameData = new SimulationGameData(serverUrl, meter.fetch);
    await gameData.loaded;
    await gameData.ids;
    meter.reset();
    const t0 = performance.now();
    await makeSystem(systemId, gameData, 'worker');
    const wallMs = Math.round(performance.now() - t0);
    console.log(JSON.stringify({ systemId, delayMs, ...meter.stats, wallMs }));
}
process.exit(0);
