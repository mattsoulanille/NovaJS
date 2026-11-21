// End-to-end check of the binary (Avro) wire: starts a real NovaJS
// server on its own port, joins TWO node clients to one room over the
// actual sockets, has each insert a ship and drive it with control
// inputs that cross the wire, and after both have simulated the same
// stretch parks them on one checkpoint tick and compares their
// per-entity world hashes. Deterministic means every entity hashes
// alike on both peers (and at the relay's own archive, which convicts
// a diverged peer with a desync broadcast neither must have seen).
//
//   node scripts/binary_wire_e2e.mjs [systemId] [ticks] [port] [1x|2x]
//     (run from packages/nova after a build; needs Nova_Data)
//     Passing `2x` (or NOVA_E2E_SPEED=2x) makes both clients vote for 2x
//     room speed partway through and verifies determinism + 2x rollback depth.
//
// Exit status 0 on a deterministic run, 1 otherwise.
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { filter, firstValueFrom } from 'rxjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..');
process.chdir(packageRoot);

const SYSTEM = process.argv[2] ?? 'nova:129';
const TICKS = Number(process.argv[3] ?? 300);
const PORT = Number(process.argv[4] ?? 18342);
const SPEED_ARG = (process.argv[5] ?? process.env.NOVA_E2E_SPEED ?? '1x').toLowerCase();
const VOTE_FAST = SPEED_ARG === '2x' || SPEED_ARG === '2';
const SHIP = 'nova:128';
const STEP_MS = 1000 / 60;

const { SocketChannelClient } = await import('../dist/src/communication/socket_channel_client.js');
const { CommunicatorClient } = await import('../dist/src/communication/communicator_client.js');
const { MultiRoom } = await import('../dist/src/communication/multi_room_communicator.js');
const { SimulationBridgeHost } = await import('../dist/src/communication/simulation_bridge_host.js');
const { makeSystem } = await import('../dist/src/nova_plugin/make_system.js');
const { SimulationGameData } = await import('../dist/src/client/gamedata/simulation_game_data.js');
const { makeShip } = await import('../dist/src/nova_plugin/ship/index.js');
const { ControlledByComponent } = await import('../dist/src/nova_plugin/player/index.js');
const { connectUrlWithVersion } = await import('../dist/src/common/version_handshake.js');
const { BUILD_VERSION } = await import('../dist/src/common/generated_build_version.js');
const { liveWireCodec, liveWireFingerprint } = await import('../dist/src/communication/wire_schemas.js');
const { CommunicatorResource, MultiplayerData } = await import('nova_ecs/plugins/multiplayer_plugin');
const { SerializerResource } = await import('nova_ecs/plugins/serializer_plugin');
const { NpcSpawnerComponent } = await import('../dist/src/nova_plugin/spawn/index.js');
const { NpcComponent } = await import('../dist/src/nova_plugin/npc/index.js');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const log = (...args) => console.error(`[e2e ${((performance.now()) / 1000).toFixed(1)}s]`, ...args);

// --- The server, on its own port.
log(`starting server on port ${PORT} (wire: ${liveWireCodec().encoding}, schema ${liveWireFingerprint()})`);
const server = spawn(process.execPath, ['dist/server.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', chunk => { serverLog += chunk; });
server.stderr.on('data', chunk => { serverLog += chunk; });
const stop = code => {
    server.kill('SIGTERM');
    process.exit(code);
};
process.on('SIGINT', () => stop(130));
for (let i = 0; i < 600; i++) {
    try {
        const response = await fetch(`http://localhost:${PORT}/version`);
        if (response.ok) {
            break;
        }
    } catch {
        // Not listening yet.
    }
    await sleep(500);
    if (i === 599) {
        log('server never came up:\n' + serverLog.slice(-2000));
        stop(1);
    }
}
log('server up');

// --- A client: socket, rooms, a simulated world joined to the room.
async function makeClient(name) {
    const frames = { binary: 0, other: 0 };
    const channel = new SocketChannelClient({
        webSocketFactory: () => {
            const socket = new WebSocket(
                connectUrlWithVersion(`ws://localhost:${PORT}`, BUILD_VERSION));
            socket.addEventListener('message', event => {
                if (event.data instanceof ArrayBuffer) {
                    frames.binary++;
                } else {
                    frames.other++;
                }
            });
            return socket;
        },
        warn: message => log(`${name} socket:`, message),
    });
    const communicator = new CommunicatorClient(channel);
    const rooms = new MultiRoom(communicator);
    const room = rooms.join(SYSTEM);
    // The server set is the one the server announced, not a constant.
    await firstValueFrom(room.peers.current.pipe(
        filter(peers => [...room.servers.value].some(server => peers.has(server)))));
    const gameData = new SimulationGameData(`http://localhost:${PORT}`);
    const world = await makeSystem(SYSTEM, gameData, 'node');
    world.resources.set(CommunicatorResource, room);
    const host = new SimulationBridgeHost(world, gameData);
    const joined = await host.joinRoom();
    log(`${name} joined=${joined} uuid=${room.uuid} tick=${host.status().tick}`);
    if (!joined) {
        log('join failed; server log:\n' + serverLog.slice(-2000));
        stop(1);
    }
    const ship = makeShip(await gameData.data.Ship.get(SHIP));
    ship.components.set(ControlledByComponent, { peerId: room.uuid });
    ship.components.set(MultiplayerData, { owner: room.uuid });
    await host.addEntity(`${name}-ship`, world.resources.get(SerializerResource).encode(ship));
    return {
        name, host, room, frames, channel, world,
        timeDebt: 0, lastPumpMs: undefined, pacing: undefined, saw2x: false,
    };
}

/** Steps a client using its live RoomClock pacing (1x or 2x), like FramePump. */
function pump(client) {
    const now = performance.now();
    const elapsedMs = client.lastPumpMs !== undefined ? now - client.lastPumpMs : STEP_MS;
    client.lastPumpMs = now;
    const rate = client.pacing?.rate ?? 1;
    const speed = client.pacing?.speed ?? 1;
    client.timeDebt = Math.min(client.timeDebt + elapsedMs * rate, STEP_MS * 6 * speed);
    let steps = Math.floor(client.timeDebt / STEP_MS);
    client.timeDebt -= steps * STEP_MS;
    if (client.pacing && client.pacing.behindTicks > 30 * speed) {
        steps += Math.min(Math.floor(client.pacing.behindTicks), 60 * speed);
    }
    if (steps > 0) {
        client.host.step(steps);
    }
    const frame = client.host.snapshot();
    if (frame.pacing) {
        client.pacing = frame.pacing;
    }
    if (frame.roomSpeed?.speed === 2 && frame.pacing?.speed === 2) {
        client.saw2x = true;
    }
}

const a = await makeClient('A');
const b = await makeClient('B');
const startTick = Math.max(a.host.status().tick, b.host.status().tick);
const driveStartMs = performance.now();

// --- Drive both ships with inputs that cross the wire, for `TICKS`.
const speedMode = VOTE_FAST ? '2x' : '1x';
log(`driving both ships for ${TICKS} ticks (mode=${speedMode})`);
const untilTick = startTick + TICKS;
const voteFastAtTick = startTick + Math.floor(TICKS / 3);
let votedFast = false;
let fastStartMs;
let fastStartTick;
let phase = 0;
while (a.host.status().tick < untilTick || b.host.status().tick < untilTick) {
    for (const client of [a, b]) {
        pump(client);
    }
    const tick = a.host.status().tick;
    if (VOTE_FAST && !votedFast && tick >= voteFastAtTick) {
        votedFast = true;
        log(`voting 2x fast on both clients at tick ${tick}`);
        a.host.setSpeedVote(true, true);
        b.host.setSpeedVote(true, true);
    }
    if (VOTE_FAST && fastStartMs === undefined && a.saw2x && b.saw2x) {
        fastStartMs = performance.now();
        fastStartTick = Math.min(a.host.status().tick, b.host.status().tick);
    }
    if (tick > phase * 40) {
        phase++;
        // (A control's state is 'start' | 'repeat' | false. An invalid
        // input is applied by its author and refused by the wire — a
        // self-inflicted desync the relay convicts, as the first run of
        // this script demonstrated with `'stop'`.)
        a.host.controlEvents([{ action: 'accelerate', state: phase % 2 ? 'start' : false }]);
        b.host.controlEvents([{ action: phase % 2 ? 'turnLeft' : 'turnRight', state: 'start' }]);
        if (phase % 3 === 0) {
            a.host.controlEvents([{ action: 'firePrimary', state: 'start' }]);
        }
        // A heading with the sign bit of zero, which JSON would fold.
        b.host.analogControl({ heading: phase % 4 ? -0 : 1.5, throttle: 0.5 });
    }
    await sleep(16);
}
const driveElapsedS = (performance.now() - driveStartMs) / 1000;
const fastElapsedS = fastStartMs !== undefined
    ? (performance.now() - fastStartMs) / 1000 : undefined;
const fastTicksPerSec = fastElapsedS && fastElapsedS > 0 && fastStartTick !== undefined
    ? Number(((Math.min(a.host.status().tick, b.host.status().tick) - fastStartTick)
        / fastElapsedS).toFixed(1))
    : undefined;

// --- Park both on one checkpoint tick past the last input, with the
// relay's records settled, and compare.
const settle = 120;
const parkAt = Math.ceil((Math.max(a.host.status().tick, b.host.status().tick) + settle) / 60) * 60;
log(`parking both at tick ${parkAt}`);
for (let i = 0; i < 400 && (a.host.status().tick < parkAt || b.host.status().tick < parkAt); i++) {
    for (const client of [a, b]) {
        const tick = client.host.status().tick;
        if (tick < parkAt) {
            client.host.step(Math.min(10, parkAt - tick));
        }
    }
    await sleep(16);
}
// Let any in-flight record land and roll back before hashing.
await sleep(500);
for (const client of [a, b]) {
    client.host.step(0);
}

const dumpA = a.host.entityHashes();
const dumpB = b.host.entityHashes();
const statusA = a.host.status();
const statusB = b.host.status();
log(`A tick=${dumpA.tick} entities=${dumpA.entities.length} desyncs=${statusA.desyncCount} frames=${JSON.stringify(a.frames)}`);
log(`B tick=${dumpB.tick} entities=${dumpB.entities.length} desyncs=${statusB.desyncCount} frames=${JSON.stringify(b.frames)}`);

const hashesA = new Map(dumpA.entities);
const hashesB = new Map(dumpB.entities);
const differences = [];
for (const [uuid, hash] of hashesA) {
    if (hashesB.get(uuid) !== hash) {
        differences.push(`${uuid}: A ${hash} B ${hashesB.get(uuid) ?? 'absent'}`);
    }
}
for (const uuid of hashesB.keys()) {
    if (!hashesA.has(uuid)) {
        differences.push(`${uuid}: A absent B ${hashesB.get(uuid)}`);
    }
}
const bothShips = hashesA.has('A-ship') && hashesA.has('B-ship')
    && hashesB.has('A-ship') && hashesB.has('B-ship');
const textFrames = a.frames.other + b.frames.other;
// The room's population (#140): the server seeds every room it opens,
// so the initial population was rolled at A's entry, not at genesis.
// Reported, not gated on (NOVA_ROOM_SEED=off runs the fixed genesis).
const spawner = a.world.entities.get('npc spawner')?.components.get(NpcSpawnerComponent);
const room = {
    npcs: [...a.world.entities.values()]
        .filter(entity => entity.components.has(NpcComponent)).length,
    targetCount: spawner?.targetCount,
    spawnBits: spawner?.spawnBits,
    awaitingEntrant: spawner?.awaitingEntrant ?? false,
};
const rollbackStats = [a.host.rollbackStats(), b.host.rollbackStats()];
const observed2x = [a.saw2x, b.saw2x];
const ok = dumpA.tick === dumpB.tick && differences.length === 0 && bothShips
    && statusA.desyncCount === 0 && statusB.desyncCount === 0 && textFrames === 0
    && (!VOTE_FAST || (a.saw2x && b.saw2x));
console.log(JSON.stringify({
    ok, speedMode, observed2x,
    ticksPerSec: Number((TICKS / driveElapsedS).toFixed(1)),
    ...(fastTicksPerSec !== undefined ? { fastTicksPerSec } : {}),
    rollbackStats,
    tick: dumpA.tick, ticksDriven: TICKS, entities: dumpA.entities.length,
    bothShips, desyncs: [statusA.desyncCount, statusB.desyncCount],
    binaryFrames: [a.frames.binary, b.frames.binary], textFrames, room,
    wire: liveWireCodec().encoding, schema: liveWireFingerprint(),
    differences: differences.slice(0, 10),
}, null, 2));
if (!ok) {
    log('server log tail:\n' + serverLog.slice(-3000));
}
log(ok ? 'DETERMINISTIC' : 'DIVERGED');
stop(ok ? 0 : 1);
