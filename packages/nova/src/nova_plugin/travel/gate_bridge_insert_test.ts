import "jasmine";
import { v4 } from "uuid";
import { MockCommunicator } from "nova_ecs/plugins/mock_communicator";
import { multiplayer, MultiplayerData } from "nova_ecs/plugins/multiplayer_plugin";
import { SerializerResource } from "nova_ecs/plugins/serializer_plugin";
import { getIntegrationGameData } from "../../communication/simulation_test_fixture.js";
import { SimulationBridgeClient } from "../../communication/simulation_bridge_client.js";
import { SimulationBridgeHost } from "../../communication/simulation_bridge_host.js";
import { makeShip } from "../ship/make_ship.js";
import { makeSystem } from "../make_system.js";
import { completeEntity } from "../spawn/entity_data_loader.js";
import { GateArrivalComponent } from "./gate_transit_plugin.js";
import { PlayerShipSelector } from "../player/player_ship_plugin.js";

// NOTE: this covers the insertion path *inside* one live bridge. The
// 2026-07 "ship missing at destination" hang lived one level up, in
// the browser's bridge lifecycle: jumpTo terminated the origin worker
// while the frame pump awaited a call on it, the never-settling
// promise wedged the pump, and the destination bridge (whose insertion
// path is exercised here) was simply never stepped. That level is
// covered by simulation_bridge_close_test.ts.
describe('gate arrival through the bridge insertion path', () => {
    it('inserts a ship carrying GateArrivalComponent via addEntity', async () => {
        const gameData = await getIntegrationGameData();
        const ids = await gameData.ids;
        const world = await makeSystem('nova:425', gameData, undefined,
            { npcs: false });
        const communicator = new MockCommunicator("server");
        await world.addPlugin(multiplayer(communicator));
        const serializer = world.resources.get(SerializerResource)!;
        const host = new SimulationBridgeHost(world, gameData);
        const client = new SimulationBridgeClient(host, serializer);

        const shipData = await gameData.data.Ship.get([...ids.Ship].sort()[0]!);
        const ship = makeShip(shipData);
        ship.components.set(MultiplayerData, { owner: "server" });
        ship.components.set(PlayerShipSelector, undefined);
        await completeEntity(world, ship);
        ship.components.set(GateArrivalComponent, {
            destinationSpob: 'nova:1401',
            emergenceAngle: null,
            randomDraw: 0.5,
        });

        const uuid = v4();
        await client.addEntity(uuid, ship);
        client.step();
        expect(world.entities.has(uuid)).toBeTrue();
        // The arrival marker is consumed on the first tick.
        client.step();
        expect(world.entities.has(uuid)).toBeTrue();
        expect(world.entities.get(uuid)!.components
            .has(GateArrivalComponent)).toBeFalse();
    }, 30_000);
});
