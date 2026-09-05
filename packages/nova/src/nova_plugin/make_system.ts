import { installDeterministicMath } from "nova_ecs/deterministic_math";
import { MultiplayerData, MultiplayerDataType } from "nova_ecs/plugins/multiplayer_plugin";
import { SerializerResource } from "nova_ecs/plugins/serializer_plugin";
import { Random, RandomResource } from "nova_ecs/plugins/random_plugin";
import { useFixedTimestep } from "nova_ecs/plugins/time_plugin";
import { fnv1a } from "nova_ecs/plugins/world_hash";
import { World } from "nova_ecs/world";
import { completeEntity } from "./entity_data_loader.js";
import { configureSnapshotPolicies } from "./snapshot_policies.js";
import { DEFAULT_MISSILE_GUIDANCE, MissileGuidanceResource } from "./guidance.js";
import { SystemInterferenceResource } from "./jamming_plugin.js";
import { IdFactory, IdFactoryResource } from "./id_factory.js";
import { SimulationGameDataInterface } from "../client/gamedata/simulation_game_data.js";
import { spawnAsteroids } from "./asteroid_plugin.js";
import { spawnNpcs } from "./npc_spawn_plugin.js";
import { SimulationGameDataResource } from "./game_data_resource.js";
import { makePlanet } from "./make_planet.js";
import { Platform, PlatformResource } from "./platform_plugin.js";
import { GovtsResource } from "./reputation_plugin.js";
import { SystemIdResource } from "./system_id_resource.js";
import { SystemPlugin } from "./system_plugin.js";


/** The simulation runs at a fixed 60Hz. */
export const SIMULATION_STEP_MS = 1000 / 60;

export interface MakeSystemOptions {
    /**
     * Whether to populate the system with its NPC traffic (sÿst
     * DudeTypes / flët fleets). Defaults to true. Genesis state must
     * be identical for every world in a room, so every peer AND the
     * server archive must build the system with the same value; the
     * opt-out exists for choreography-sensitive tests and benchmarks
     * that need a controlled battlefield (the same reason the bay-
     * escort spec pinned itself to an asteroid-free system).
     */
    npcs?: boolean;
}

export async function makeSystem(systemId: string, gameData: SimulationGameDataInterface,
    platformOverride?: Platform, options: MakeSystemOptions = {}) {
    // Every context that simulates builds its worlds here (the browser
    // sim worker, the server's archive, node workers, tests), so this
    // is the chokepoint that makes Math's trig bit-identical across
    // engines before any world steps. Display-only contexts (the
    // browser main thread) never call this and keep native Math.
    installDeterministicMath();
    const world = new World(systemId);

    world.resources.set(SimulationGameDataResource, gameData);
    world.resources.set(SystemIdResource, systemId);
    // Deterministic randomness and entity id allocation for simulation
    // code. Seeded per system so different systems behave differently
    // while identical runs stay identical. The id factory is PREFIXED
    // with the system id so no two worlds can mint the same uuid: a
    // uuid carried across a transition (a target, an aggressor) then
    // names nothing in the destination rather than an unrelated ship
    // (issue #32; see IdFactory).
    world.resources.set(RandomResource, new Random(fnv1a(systemId)));
    world.resources.set(IdFactoryResource, new IdFactory(systemId));
    // Guided-missile steering mode. Set here (the deterministic World builder
    // that every client and the server's RoomArchive run) so it is identical
    // for every peer in a room, satisfying the rollback determinism
    // constraint. To change the game-wide default, edit
    // DEFAULT_MISSILE_GUIDANCE in guidance.ts ('smart' = hard-to-dodge
    // leading missiles; 'simple' = dodgeable point-at-current-position).
    world.resources.set(MissileGuidanceResource, { mode: DEFAULT_MISSILE_GUIDANCE });
    if (platformOverride) {
        world.resources.set(PlatformResource, platformOverride);
    }
    await world.addPlugin(SystemPlugin);
    world.resources.get(SerializerResource)?.addComponent(MultiplayerData, MultiplayerDataType);
    // Simulation worlds run on a fixed timestep with deterministic,
    // 0-based time. Whoever steps the world converts real elapsed time
    // into a number of steps.
    useFixedTimestep(world, SIMULATION_STEP_MS);

    configureSnapshotPolicies(world);

    // Load the system's planets before the world ever steps: the
    // simulation must not resolve data asynchronously mid-simulation,
    // so all entities are fully loaded before they are inserted.
    const systemData = await gameData.data.System.get(systemId);
    // Stage EVERY gövt (they are tiny) and publish them as a resource
    // in sorted-id order: reputation record propagation and criminal-
    // hostility checks consult arbitrary govts synchronously, and the
    // sorted order makes record-map materialization deterministic on
    // every peer regardless of the data source's id ordering.
    const allIds = await gameData.ids;
    const govtEntries = await Promise.all([...allIds.Govt].sort().map(
        async id => [id, await gameData.data.Govt.get(id)] as const));
    world.resources.set(GovtsResource, new Map(govtEntries));
    // Stage EVERY ränk, for exactly the govts' reason: they are tiny (31
    // in stock data) and the SIMULATION reads them synchronously through
    // `getCached`.
    //
    // Nothing else stages them. The preload bundle carries Outfit, Ship
    // and System; entity staging (entity_data_loader) adds a ship's Govt.
    // A simulation world runs in its own worker — and its own server
    // archive, and its own node worker — each with its own game-data
    // cache, and a ränk resource had never been fetched into any of them.
    // Three privileges were therefore dead in the simulation while the
    // MAIN THREAD's display world, which loads the ränk table for the
    // spaceport dialogs, believed they were live:
    //
    //   0x0200 "all planets of the affiliated government will let the
    //          player land regardless of their MinStatus field" —
    //          AttemptLandingSystem's clearance (planet_plugin's
    //          stellarClearanceFor) and applyHail's. This is the stock
    //          HYPERGATE NETWORK's only key: ränk nova:147 opens the 19
    //          MinStatus-32767 gates, and with the read cold they stayed
    //          shut however the mission ended.
    //   0x0400 "player can always request battle assistance" — applyHail,
    //          an input-apply path replayed on every peer, so a warm peer
    //          set AssistingComponent and a cold one did not: a straight
    //          state fork.
    //   0x0100 "ships of the affiliated government will not automatically
    //          attack the player" — the NPC dispositions. That one is
    //          additionally BAKED into synced state at grant time
    //          (rank_logic.ts's suppressAggressionGovts), because it is
    //          read in a per-tick cross-entity sweep and should cost no
    //          data lookup at all; this staging is what makes the bake's
    //          own inputs, and the two remaining readers, warm.
    //
    // Staging the WHOLE table rather than the ranks an entity happens to
    // hold is what makes it complete: a rank granted mid-flight (a përs
    // ship offer's OnAccept `Kxxx`) reaches other peers as a state delta
    // that carries no game data with it, so per-entity staging would warm
    // the granting peer's cache and nobody else's.
    await Promise.all([...allIds.Rank].sort().map(
        id => gameData.data.Rank.get(id)));
    // Stage the linked systems' metadata too: starting a hyperspace
    // jump reads the destination's map position synchronously
    // (getCached) to compute the travel heading, and every peer builds
    // its world through here, so the cache is warm on all of them.
    await Promise.all(systemData.links.map(link =>
        gameData.data.System.get(link)));
    // The system's inherent sensor interference degrades radar-guided missiles
    // (see jamming_plugin.ts). Set deterministically here, before the world
    // steps, so it is identical for every peer in a room.
    world.resources.set(SystemInterferenceResource,
        { interference: systemData.interference });
    for (const planetId of systemData.planets) {
        const planetData = await gameData.data.Planet.get(planetId);
        const planet = makePlanet(planetData);
        planet.components.set(MultiplayerData, { owner: 'server' });
        await completeEntity(world, planet);
        world.entities.set(`planet ${planetId}`, planet);
    }

    // Spawn the system's asteroid field. Deterministic: every peer
    // draws the same positions from the same per-system Random and
    // allocates the same entity ids.
    await spawnAsteroids(world, systemData);

    // Populate the system's NPC traffic (same determinism story: the
    // spawn table and initial population come from the per-system
    // seeded Random, with all game data staged before the world
    // steps).
    if (options.npcs !== false) {
        await spawnNpcs(world, systemId, systemData);
    }

    return world;
}
