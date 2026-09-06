// Forges a real desync against the live server from a node client:
// publish inputs, rewind through them (forking the local timeline
// from the log), then keep playing until the relay convicts us and
// the black-box recorder captures the incident.
import { firstValueFrom, filter } from 'rxjs';
process.chdir('/Users/matthew/Projects/NovaJS/packages/nova');
const { SocketChannelClient } = await import('./dist/src/communication/socket_channel_client.js');
const { CommunicatorClient } = await import('./dist/src/communication/communicator_client.js');
const { MultiRoom } = await import('./dist/src/communication/multi_room_communicator.js');
const { SimulationBridgeHost } = await import('./dist/src/communication/simulation_bridge_host.js');
const { makeSystem } = await import('./dist/src/nova_plugin/make_system.js');
const { SimulationGameData } = await import('./dist/src/client/gamedata/simulation_game_data.js');
const { CommunicatorResource } = await import('nova_ecs/plugins/multiplayer_plugin');
// The server refuses any client that does not announce its build stamp.
const { connectUrlWithVersion } = await import('./dist/src/common/version_handshake.js');
const { BUILD_VERSION } = await import('./dist/src/common/generated_build_version.js');

const SYSTEM = process.argv[2] ?? 'nova:131';

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

// Insert a ship so there is per-peer state to diverge.
const { makeShip } = await import('./dist/src/nova_plugin/ship/make_ship.js');
const { ControlledByComponent } = await import('./dist/src/nova_plugin/player/ship_control.js');
const shipData = await gameData.data.Ship.get('nova:164');
const ship = makeShip(shipData);
ship.components.set(ControlledByComponent, { peerId: room.uuid });
const { SerializerResource } = await import('nova_ecs/plugins/serializer_plugin');
const serializer = world.resources.get(SerializerResource);
await host.addEntity('forge-ship', serializer.encode(ship));

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function play(ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        host.step(1);
        await sleep(16);
    }
}

// Publish real inputs, then rewind through them: the discarded
// records stay in the room's log, so the local timeline forks.
await play(3000);
host.controlEvents([{ action: 'accelerate', state: 'start' }]);
await play(1000);
console.error('rewinding through published inputs at tick',
    host.status().tick);
console.error('rewound:', host.rewind(50));

// Keep stepping until the relay convicts us (dump + resync happen
// inside the bridge when the desync message arrives).
const start = Date.now();
while (host.status().desyncCount === 0 && Date.now() - start < 40_000) {
    await play(500);
}
const status = host.status();
console.error('desyncCount:', status.desyncCount, 'tick:', status.tick,
    'joined:', status.joined);
// Give the resync's join and the dump upload a moment to flush.
await play(3000);
process.exit(status.desyncCount > 0 ? 0 : 1);
