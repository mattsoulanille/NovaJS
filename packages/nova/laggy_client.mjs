// Reproduces the lagging-client scenario that repeatedly provoked
// live-archive divergence: a client whose event loop stalls every few
// seconds (like a struggling browser), stamping inputs ahead via the
// estimated clock, sending late (retimes), and snap-stepping to catch
// up — while flying and fighting so the divergence has sim activity
// to bite. Runs until a conviction lands or the time limit passes.
import { firstValueFrom, filter } from 'rxjs';
process.chdir('/Users/matthew/Projects/NovaJS/packages/nova');
const { SocketChannelClient } = await import('./dist/src/communication/socket_channel_client.js');
const { CommunicatorClient } = await import('./dist/src/communication/communicator_client.js');
const { MultiRoom } = await import('./dist/src/communication/multi_room_communicator.js');
const { SimulationBridgeHost } = await import('./dist/src/communication/simulation_bridge_host.js');
const { makeSystem } = await import('./dist/src/nova_plugin/make_system.js');
const { SimulationGameData } = await import('./dist/src/client/gamedata/simulation_game_data.js');
const { CommunicatorResource } = await import('nova_ecs/plugins/multiplayer_plugin');
const { makeShip } = await import('./dist/src/nova_plugin/ship/make_ship.js');
const { ControlledByComponent } = await import('./dist/src/nova_plugin/player/ship_control.js');
const { SerializerResource } = await import('nova_ecs/plugins/serializer_plugin');
// The server refuses any client that does not announce its build stamp.
const { connectUrlWithVersion } = await import('./dist/src/common/version_handshake.js');
const { BUILD_VERSION } = await import('./dist/src/common/generated_build_version.js');

const SYSTEM = process.argv[2] ?? 'nova:139';
const DURATION_MS = Number(process.argv[3] ?? 150_000);

const channel = new SocketChannelClient({
    webSocketFactory: () => new WebSocket(
        connectUrlWithVersion('ws://localhost:8000', BUILD_VERSION)),
});
const communicator = new CommunicatorClient(channel);
const multiRoom = new MultiRoom(communicator);
const room = multiRoom.join(SYSTEM);
await firstValueFrom(room.peers.current.pipe(
    filter(peers => peers.has('server'))));
const gameData = new SimulationGameData('http://localhost:8000');
const world = await makeSystem(SYSTEM, gameData, 'node');
world.resources.set(CommunicatorResource, room);
const host = new SimulationBridgeHost(world, gameData);
console.error('joined:', await host.joinRoom());

const ship = makeShip(await gameData.data.Ship.get('nova:164'));
ship.components.set(ControlledByComponent, { peerId: room.uuid });
await host.addEntity('laggy-ship',
    world.resources.get(SerializerResource).encode(ship));

// An NPC to fight, so the sim has combat (the incidents all had it).
await host.spawnNpc('nova:143');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const key = (action, state) => host.controlEvents([{ action, state }]);
const start = Date.now();
let lastReport = 0;
let stallPhase = 0;
key('firePrimary', 'start');
key('accelerate', 'start');
while (Date.now() - start < DURATION_MS) {
    const status = host.status();
    if (status.desyncCount > 0) {
        console.error('CONVICTED at tick', status.tick,
            'after', Math.round((Date.now() - start) / 1000), 's');
        // Give the dump upload and the resync a moment, then stop.
        for (let i = 0; i < 200; i++) { host.step(1); await sleep(16); }
        process.exit(0);
    }
    // Stall every ~4s for 400-900ms (varying), then let pacing
    // snap-step through the backlog like the browser pump does.
    if ((Date.now() - start) > stallPhase * 4000) {
        stallPhase++;
        await sleep(400 + (stallPhase % 6) * 100);
        // Occasional steering during catch-up windows: inputs stamped
        // at the estimated clock while the sim is behind.
        key(stallPhase % 2 ? 'turnLeft' : 'turnRight',
            stallPhase % 3 ? 'start' : 'stop');
    }
    // Catch up toward real time (crude pump): step the deficit,
    // capped, like the browser's snap.
    const behindMs = (Date.now() - start) - status.tick * (1000 / 60);
    const steps = Math.max(1, Math.min(60, Math.floor(behindMs / (1000 / 60))));
    host.step(steps);
    if (Date.now() - lastReport > 15000) {
        lastReport = Date.now();
        console.error('tick', status.tick, 'desyncs', status.desyncCount);
    }
    await sleep(16);
}
console.error('no conviction within the time limit; final:',
    JSON.stringify(host.status()));
process.exit(1);
