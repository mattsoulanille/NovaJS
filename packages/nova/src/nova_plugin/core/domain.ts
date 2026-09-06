import { Plugin } from 'nova_ecs/plugin';

/**
 * A domain of the simulation: one directory under nova_plugin/ whose
 * index.ts re-exports its modules and exports one of these.
 *
 * Domains form a DAG. `dependsOn` names the other domains this one's
 * modules import from (through their index — never a deep import) and
 * a spec asserts it equals the actual import graph, both ways: an
 * undeclared import and a stale declaration both fail. The graph is
 * the design: a domain may read everything below it and nothing above.
 *
 * `plugins` is the domain's share of the simulation, in the relative
 * order SystemPlugin registers them. It is NOT the case that composing
 * domains as blocks reproduces the simulation: the World orders
 * unconstrained systems by registration order (#43), and today's
 * registration interleaves domains (ShipPlugin, then travel's
 * controller, then core's MovementPlugin, ...). SystemPlugin therefore
 * keeps the flat, explicit registration list; a spec checks that list
 * against every domain's `plugins` (same members, same relative order)
 * and against a frozen snapshot of `world.systemNames`.
 */
export interface Domain {
    readonly name: string;
    /** Domains whose index this domain's modules import from. */
    readonly dependsOn: readonly string[];
    /** This domain's simulation plugins, in SystemPlugin's relative order. */
    readonly plugins: readonly Plugin[];
}

/**
 * The domain as one Plugin: its `plugins` in order. For building a
 * world from a subset of the game (tools, focused specs); see the
 * caveat on `Domain` before using it to build the simulation.
 */
export function domainPlugin(domain: Domain): Plugin {
    return {
        name: `${domain.name}Domain`,
        build(world) {
            for (const plugin of domain.plugins) {
                world.addPlugin(plugin);
            }
        },
    };
}
