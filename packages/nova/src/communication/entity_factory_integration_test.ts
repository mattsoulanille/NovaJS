import "jasmine";
import { MultiplayerData } from "nova_ecs/plugins/multiplayer_plugin";
import { completeEntity } from "../nova_plugin/spawn/index.js";
import {
    makeShip, OutfitsStateComponent, ShipDataComponent, ShipPhysicsComponent,
    WeaponsStateComponent,
} from '../nova_plugin/ship/index.js';
import { makeSystem } from "../nova_plugin/make_system.js";
import { PlanetDataComponent } from "../nova_plugin/travel/index.js";
import { getSyntheticGameData } from "./simulation_test_fixture.js";

// On the synthetic data set: the sorted-first system (Thessaly Reach, two
// stellars) and ship (the Wren Skiff) are all these need.
describe("completeEntity", () => {
    it("attaches derived ship components before the entity enters the world", async () => {
        const gameData = await getSyntheticGameData();
        const ids = await gameData.ids;
        const systemId = [...ids.System].sort()[0]!;
        const shipId = [...ids.Ship].sort()[0]!;
        const world = await makeSystem(systemId, gameData, undefined, { npcs: false });

        const shipData = await gameData.data.Ship.get(shipId);
        const ship = makeShip(shipData);
        ship.components.set(MultiplayerData, { owner: "server" });

        await completeEntity(world, ship);

        // Derived components are attached synchronously at completion,
        // not on the entity's first step. This is what snapshot restore
        // and resimulation rely on.
        expect(ship.components.get(ShipDataComponent)).toBeDefined();
        expect(ship.components.get(OutfitsStateComponent)).toBeDefined();
        expect(ship.components.get(ShipPhysicsComponent)).toBeDefined();
        expect(ship.components.get(WeaponsStateComponent)).toBeDefined();
    }, 30_000);

    it("attaches planet data to planets at system creation", async () => {
        const gameData = await getSyntheticGameData();
        const ids = await gameData.ids;
        const systemId = [...ids.System].sort()[0]!;
        const world = await makeSystem(systemId, gameData, undefined, { npcs: false });

        // Planets are completed before insertion in makeSystem, without
        // ever stepping the world.
        const planets = [...world.entities.entries()]
            .filter(([uuid]) => uuid.startsWith('planet '));
        expect(planets.length).toBeGreaterThan(0);
        for (const [, planet] of planets) {
            expect(planet.components.get(PlanetDataComponent)).toBeDefined();
        }
    }, 30_000);
});
