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
 * `plugins` is the domain's share of the simulation. SystemPlugin
 * composes the simulation as `DOMAINS.map(domainPlugin)`, one block
 * per domain, which is sound because the system order does not depend
 * on registration order at all: the World sorts by declared edges and
 * tie-breaks by name (#156), and system_ambiguity_test guards that
 * every pair of systems that could observe its order has an edge
 * (#237). A plugin may still need to register after another when its
 * systems take a resource the other sets (addSystem checks that).
 */
export interface Domain {
    readonly name: string;
    /** Domains whose index this domain's modules import from. */
    readonly dependsOn: readonly string[];
    /** This domain's simulation plugins. */
    readonly plugins: readonly Plugin[];
}

/**
 * The domain as one Plugin: its `plugins` in order. SystemPlugin is
 * built from these; they also serve building a world from a subset of
 * the game (tools, focused specs).
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
