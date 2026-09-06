/**
 * Harness for checking that the simulation is deterministic: builds two
 * identical system worlds, steps them in lockstep, and compares state
 * hashes each tick. This is the acceptance gate for the rollback
 * multiplayer determinism work (docs/rollback_multiplayer.md, Phase 1).
 */
import { Angle } from "nova_ecs/datatypes/angle";
import { Position } from "nova_ecs/datatypes/position";
import { Vector } from "nova_ecs/datatypes/vector";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { diffWorldHashes, hashWorld } from "nova_ecs/plugins/world_hash";
import { World } from "nova_ecs/world";
import { completeEntity } from "../nova_plugin/entity_data_loader.js";
import { makeNpc } from "../nova_plugin/npc_plugin.js";
import { makeShip } from "../nova_plugin/make_ship.js";
import { PlayerShipSelector } from "../nova_plugin/player_ship_plugin.js";
import { ControlledByComponent } from "../nova_plugin/ship_control.js";
import { makeSystem } from "../nova_plugin/make_system.js";
import { Platform } from "../nova_plugin/platform_plugin.js";
import { getIntegrationGameData } from "./simulation_test_fixture.js";
import { GameDataAggregator } from "../server/parsing/game_data_aggregator.js";

/**
 * Which data set a harness world is built from. The integration set
 * unless a spec passes `getSyntheticGameData()` (simulation_test_fixture).
 */
export type GameDataSource = Promise<GameDataAggregator>;

export interface DeterminismCheckResult {
    /** Tick of the first hash mismatch, or undefined if none. */
    divergedAtStep?: number;
    /** Per-entity differences at the first mismatch. */
    differences: string[];
    stepsRun: number;
}

async function settle(world: World, steps: number) {
    for (let i = 0; i < steps; i++) {
        world.step();
        // Yield between batches of steps (mirrors real stepping).
        await new Promise(resolve => setImmediate(resolve));
    }
}

/**
 * Builds a system world with a deterministic set of ships. `npcCount when
 * nonzero adds fighting NPCs, which currently exercise the known
 * nondeterminism (Math.random weapon spread, random targeting, v4 uuids).
 */
export async function makeDeterminismWorld(npcCount: number,
    platform: Platform | undefined = 'worker',
    gameDataSource: GameDataSource = getIntegrationGameData()): Promise<World> {
    const gameData = await gameDataSource;
    const ids = await gameData.ids;
    const systemId = [...ids.System].sort()[0]!;
    const shipIds = [...ids.Ship].sort();

    // 'worker' platform by default: the same system set as the real
    // client simulation, including the ship control systems.
    const world = await makeSystem(systemId, gameData, platform);

    const shipData = await gameData.data.Ship.get(shipIds[0]!);
    const ship = makeShip(shipData);
    // Controlled by 'test peer', so tests can feed control events as
    // per-peer rollback input records.
    ship.components.set(PlayerShipSelector, undefined);
    ship.components.set(ControlledByComponent, { peerId: 'test peer' });
    setDeterministicMovement(world, ship, 0);
    // Stage, load, then insert, like the simulation bridge does.
    await completeEntity(world, ship);
    world.entities.set('determinism ship', ship);

    for (let i = 0; i < npcCount; i++) {
        const npcData = await gameData.data.Ship.get(shipIds[i % shipIds.length]!);
        const npc = makeNpc(npcData);
        setDeterministicMovement(world, npc, i + 1);
        await completeEntity(world, npc);
        world.entities.set(`determinism npc ${i}`, npc);
    }
    return world;
}

/** makeShip randomizes the initial position; pin it down. */
function setDeterministicMovement(world: World, ship: { components: Map<unknown, unknown> },
    index: number) {
    const entity = ship as Parameters<typeof world.entities.set>[1];
    const movement = entity.components.get(MovementStateComponent);
    if (movement) {
        movement.position = new Position(100 * index, -50 * index);
        movement.rotation = new Angle(index);
        movement.velocity = new Vector(10, 5 * index);
    }
}

/**
 * Steps both worlds in lockstep for `steps` ticks, comparing state
 * hashes after every tick. Both worlds should be warmed up first so
 * async data loading is not part of the comparison.
 */
export async function compareWorlds(worldA: World, worldB: World, steps: number,
    log?: (message: string) => void): Promise<DeterminismCheckResult> {
    const initialDiff = diffWorldHashes(hashWorld(worldA), hashWorld(worldB));
    if (initialDiff.length > 0) {
        return { divergedAtStep: 0, differences: initialDiff, stepsRun: 0 };
    }

    for (let i = 1; i <= steps; i++) {
        worldA.step();
        worldB.step();
        if (i % 10 === 0) {
            await new Promise(resolve => setImmediate(resolve));
        }
        const hashA = hashWorld(worldA);
        const hashB = hashWorld(worldB);
        if (hashA.hash !== hashB.hash) {
            const differences = diffWorldHashes(hashA, hashB);
            log?.(`Diverged at step ${i}:`);
            for (const difference of differences.slice(0, 20)) {
                log?.(`  ${difference}`);
            }
            return { divergedAtStep: i, differences, stepsRun: i };
        }
    }
    return { differences: [], stepsRun: steps };
}

/**
 * Builds and compares two identical worlds. Since entities are staged
 * (fully loaded before insertion), worlds are deterministic from tick 0
 * and no warmup is needed; warmupSteps remains for stress variations.
 */
export async function runDeterminismCheck(npcCount: number, steps: number,
    warmupSteps = 0, log?: (message: string) => void,
    gameDataSource: GameDataSource = getIntegrationGameData()): Promise<DeterminismCheckResult> {

    const worldA = await makeDeterminismWorld(npcCount, 'worker', gameDataSource);
    await settle(worldA, warmupSteps);
    const worldB = await makeDeterminismWorld(npcCount, 'worker', gameDataSource);
    await settle(worldB, warmupSteps);

    return compareWorlds(worldA, worldB, steps, log);
}
