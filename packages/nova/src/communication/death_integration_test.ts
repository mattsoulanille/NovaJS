import "jasmine";
import { MultiplayerData } from "nova_ecs/plugins/multiplayer_plugin";
import { v4 } from "uuid";
import { DamagedEvent, DeathEvent } from "../nova_plugin/ship/death_plugin.js";
import { completeEntity } from "../nova_plugin/spawn/entity_data_loader.js";
import { makeNpc } from "../nova_plugin/npc/npc_plugin.js";
import { makeSimulationBridgeHarness, getSyntheticGameData } from "./simulation_test_fixture.js";

const LETHAL_DAMAGE = {
    shield: 1e9, armor: 1e9, ionization: 0, ionizationColor: 0,
    knockback: 0, passThroughShield: true, recoil: 0,
} as never;

// On the synthetic data set: any ship class that can die will do.
describe("Ship death", () => {
    async function makeWorldWithNpc(owner: string) {
        const harness = await makeSimulationBridgeHarness(getSyntheticGameData());
        const { world } = harness;
        const gameData = await getSyntheticGameData();
        const ids = await gameData.ids;
        const shipId = [...ids.Ship].sort()[0]!;
        const shipData = await gameData.data.Ship.get(shipId);

        const npc = makeNpc(shipData);
        npc.components.set(MultiplayerData, { owner });
        const npcUuid = v4();
        await completeEntity(world, npc);
        world.entities.set(npcUuid, npc);

        // Let async providers resolve so the NPC has armor etc.
        for (let i = 0; i < 60; i++) {
            world.step();
            await new Promise(resolve => setImmediate(resolve));
        }

        return { world, npcUuid, deathDelay: shipData.deathDelay };
    }

    async function stepThroughDeath(
        world: Awaited<ReturnType<typeof makeWorldWithNpc>>["world"],
        npcUuid: string, deathDelay: number) {
        let deathEventFired = false;
        world.events.get(DeathEvent).subscribe(() => { deathEventFired = true; });

        world.emit(DamagedEvent,
            { damage: LETHAL_DAMAGE, damager: "test" }, [npcUuid]);

        // The ship explodes for deathDelay (wall-clock) before DeathEvent.
        const deadline = Date.now() + (deathDelay + 5) * 1000;
        while (Date.now() < deadline && !deathEventFired) {
            world.step();
            await new Promise(resolve => setImmediate(resolve));
        }
        // A few more steps for death handling to settle.
        for (let i = 0; i < 10; i++) {
            world.step();
        }
        return deathEventFired;
    }

    it("removes a ship owned by this peer when it dies", async () => {
        // The harness communicator's uuid is 'server'.
        const { world, npcUuid, deathDelay } = await makeWorldWithNpc("server");
        const deathEventFired = await stepThroughDeath(world, npcUuid, deathDelay);

        expect(deathEventFired).toBe(true);
        expect(world.entities.has(npcUuid)).toBe(false);
    }, 30_000);

    it("removes ships owned by other peers just the same", async () => {
        const { world, npcUuid, deathDelay } = await makeWorldWithNpc("some other peer");
        const deathEventFired = await stepThroughDeath(world, npcUuid, deathDelay);

        // Input-driven multiplayer: every peer simulates the same death
        // at the same tick, so removal is deterministic and unowned.
        expect(deathEventFired).toBe(true);
        expect(world.entities.has(npcUuid)).toBe(false);
    }, 30_000);
});
