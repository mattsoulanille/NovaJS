import "jasmine";
import { restoreWorld, snapshotWorld, SnapshotPoliciesResource } from "nova_ecs/plugins/snapshot_plugin";
import { hashWorld } from "nova_ecs/plugins/world_hash";
import { deriveEntityComponents } from "../nova_plugin/core/index.js";
import { makeDeterminismWorld } from "./determinism_harness.js";

describe("World snapshot", () => {
    it("restores exactly and resimulates identically through combat", async () => {
        const world = await makeDeterminismWorld(4);
        for (let i = 0; i < 60; i++) {
            world.step();
        }

        const snapshot = snapshotWorld(world);
        const hashAtSnapshot = hashWorld(world).hash;

        const original: string[] = [];
        for (let i = 0; i < 180; i++) {
            world.step();
            original.push(hashWorld(world).hash);
        }

        restoreWorld(world, snapshot, deriveEntityComponents);
        expect(hashWorld(world).hash)
            .withContext("restore must reproduce the snapshotted state exactly")
            .toEqual(hashAtSnapshot);

        const resimulated: string[] = [];
        for (let i = 0; i < 180; i++) {
            world.step();
            resimulated.push(hashWorld(world).hash);
        }
        const firstDivergence = original.findIndex(
            (hash, i) => hash !== resimulated[i]);
        expect(firstDivergence)
            .withContext("resimulation must retrace the original timeline")
            .toBe(-1);

        // Every component present in the world must have a deliberate
        // snapshot policy; unhandled components are silently dropped
        // state waiting to break resimulation.
        const policies = world.resources.get(SnapshotPoliciesResource)!;
        expect([...policies.unhandled]).toEqual([]);
    }, 120_000);

    it("can restore the same snapshot repeatedly", async () => {
        const world = await makeDeterminismWorld(2);
        for (let i = 0; i < 60; i++) {
            world.step();
        }
        const snapshot = snapshotWorld(world);

        restoreWorld(world, snapshot, deriveEntityComponents);
        const firstRun: string[] = [];
        for (let i = 0; i < 90; i++) {
            world.step();
            firstRun.push(hashWorld(world).hash);
        }

        restoreWorld(world, snapshot, deriveEntityComponents);
        const secondRun: string[] = [];
        for (let i = 0; i < 90; i++) {
            world.step();
            secondRun.push(hashWorld(world).hash);
        }

        expect(secondRun)
            .withContext("the snapshot must not be polluted by resimulation")
            .toEqual(firstRun);
    }, 120_000);
});
