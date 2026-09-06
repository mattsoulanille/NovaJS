import { Component, UnknownComponent } from "nova_ecs/component";
import { Entity } from "nova_ecs/entity";
import { Resource } from "nova_ecs/resource";
import { World } from "nova_ecs/world";
import { SimulationGameDataInterface } from "../../client/gamedata/simulation_game_data.js";
import { SimulationGameDataResource } from "./game_data_resource.js";

/**
 * A registered derivation of a component from game data. Plugins
 * register derivers next to their systems (so mods stay self-contained)
 * and `completeEntity` runs them synchronously wherever a full entity
 * is needed: staged insertion now; snapshot restore and multiplayer
 * ingress later.
 *
 * Derivers run in registration order, so register dependencies first
 * (e.g. ship data before ship physics).
 */
export interface EntityDeriver<Data = unknown> {
    name: string;
    /** The component this deriver attaches. Skipped if present. */
    provided: Component<Data>;
    /** Components the entity must already have for this to apply. */
    requires: readonly UnknownComponent[];
    /**
     * Derives the component from pre-warmed game data caches. Returns
     * undefined if the data is not available (completeEntity treats
     * this as an error, since it loads the entity's data first).
     */
    derive: (entity: Entity, gameData: SimulationGameDataInterface) => Data | undefined;
}

export const EntityDeriversResource =
    new Resource<EntityDeriver[]>('EntityDerivers');

/** Registers a deriver, creating the registry resource if needed. */
export function registerEntityDeriver<Data>(world: World, deriver: EntityDeriver<Data>) {
    let derivers = world.resources.get(EntityDeriversResource);
    if (!derivers) {
        derivers = [];
        world.resources.set(EntityDeriversResource, derivers);
    }
    derivers.push(deriver as EntityDeriver);
}

/**
 * Runs the registered derivers on an entity whose game data is already
 * loaded. Synchronous, so it can run at snapshot restore.
 */
export function deriveEntityComponents(world: World, entity: Entity) {
    const derivers = world.resources.get(EntityDeriversResource) ?? [];
    const gameData = world.resources.get(SimulationGameDataResource);
    if (!gameData) {
        return;
    }
    // Run to a fixpoint so derivers can depend on each other's outputs
    // regardless of registration order.
    const warned = new Set<string>();
    let progressed = true;
    while (progressed) {
        progressed = false;
        for (const deriver of derivers) {
            if (entity.components.has(deriver.provided)) {
                continue;
            }
            if (!deriver.requires.every(component => entity.components.has(component))) {
                continue;
            }
            const value = deriver.derive(entity, gameData);
            if (value === undefined) {
                // Requirements are met but the data is missing: a cache
                // miss, which completeEntity's loading should prevent.
                if (!warned.has(deriver.name)) {
                    warned.add(deriver.name);
                    console.warn(`Deriver ${deriver.name} could not derive `
                        + `${deriver.provided.name}: game data not loaded`);
                }
                continue;
            }
            entity.components.set(deriver.provided, value);
            progressed = true;
        }
    }
}
