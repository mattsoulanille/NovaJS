// A real node client for a live NovaJS server: joins a room over the
// actual socket, reconstructs the world from the server's baseline +
// input log, simulates on node's V8, and prints per-entity world
// hashes at a target tick (rounded up to a checkpoint boundary).
//
// This is the cross-engine testing rig: park a Chrome client on the
// same tick (novaSim.pause() + novaSim.step(n), then novaSim.hashes())
// and diff the two dumps to name the exact diverging entity. It found
// the jump-arrival retiming bug that engine-matched trig could not
// explain.
//
// Usage: node node_client.mjs [systemId] [targetTick]
//   (run from packages/nova with the server on localhost:8000)
import { firstValueFrom, filter } from 'rxjs';
process.chdir('/Users/matthew/Projects/NovaJS/packages/nova');
const { SocketChannelClient } = await import('./dist/src/communication/socket_channel_client.js');
const { CommunicatorClient } = await import('./dist/src/communication/communicator_client.js');
const { MultiRoom } = await import('./dist/src/communication/multi_room_communicator.js');
const { SimulationBridgeHost } = await import('./dist/src/communication/simulation_bridge_host.js');
const { makeSystem } = await import('./dist/src/nova_plugin/make_system.js');
const { SimulationGameData } = await import('./dist/src/client/gamedata/simulation_game_data.js');
const { CommunicatorResource } = await import('nova_ecs/plugins/multiplayer_plugin');
// The server refuses any client that does not announce its build stamp,
// so this rig has to announce one too. It loads the same `dist` the
// server runs from, so its stamp is the server's by construction.
const { connectUrlWithVersion } = await import('./dist/src/common/version_handshake.js');
const { BUILD_VERSION } = await import('./dist/src/common/generated_build_version.js');

const SYSTEM = process.argv[2] ?? 'nova:129';
const TARGET = Number(process.argv[3] ?? 60000);

const channel = new SocketChannelClient({
    webSocketFactory: () => new WebSocket(
        connectUrlWithVersion('ws://localhost:8000', BUILD_VERSION)),
});
const communicator = new CommunicatorClient(channel);
const multiRoom = new MultiRoom(communicator);
const room = multiRoom.join(SYSTEM);
await firstValueFrom(room.peers.current.pipe(
    filter(peers => peers.has('server'))));
console.error('connected; uuid', room.uuid);

// The running server's exact parse, over HTTP — a local re-parse
// can differ for plugin content, which defeats same-tick diffing.
const gameData = new SimulationGameData('http://localhost:8000');
const world = await makeSystem(SYSTEM, gameData, 'node');
world.resources.set(CommunicatorResource, room);
const host = new SimulationBridgeHost(world, gameData);
const joined = await host.joinRoom();
console.error('joined:', joined, 'tick:', host.status().tick);

// Park on the next checkpoint boundary past both the join tick and
// TARGET, so a slower client can step to exactly this tick later.
const parkAt = Math.ceil(Math.max(host.status().tick, TARGET) / 60) * 60;
while (host.status().tick < parkAt) {
    host.step(Math.min(200, parkAt - host.status().tick));
    await new Promise(r => setImmediate(r));
}
const dump = host.entityHashes();
console.error('parked at', dump.tick, 'entities', dump.entities.length);
console.log(JSON.stringify(dump));
process.exit(0);
