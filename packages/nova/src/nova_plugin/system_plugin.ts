import { Plugin } from "nova_ecs/plugin";
import { domainPlugin } from "./core/index.js";
import { DOMAINS } from "./domains.js";

/**
 * The simulation: every domain's plugins, composed domain by domain.
 *
 * THE ORDER OF THIS LIST IS NOT A DETERMINISM INPUT. The World sorts
 * systems by their declared before/after edges and tie-breaks the
 * unconstrained pairs by name (#156), so registration order — of the
 * domains here, of the plugins within a domain — cannot change the
 * system order. What guarantees that is system_ambiguity_test: every
 * pair of systems that could observe its order (a shared event and
 * shared state in their args) has a declared path between them, and
 * the count of pairs without one is pinned at 0.
 *
 * Most of those paths are semantic (`after: [TimeSystem]`, `before:
 * [MovementSystem]`). The rest are the '#237 pins': edges that record
 * the order the game shipped with before the tie-break changed —
 * SystemPlugin used to be a flat, hand-interleaved plugin list, and
 * an unconstrained pair ran in that list's order. Each pin names what
 * the pair shares ('shared: entity', 'shared: *' for a system that
 * reaches everything through Entities/GetArg/RunQuery/GetWorld). A
 * pin may be removed once the pair provably does not interact (the
 * ambiguity guard says whether it still counts); it must not be
 * flipped without the determinism harness.
 *
 * Users must add the multiplayer plugin and a display plugin, and set
 * the NovaData resource.
 */
const DOMAIN_PLUGINS: readonly Plugin[] = DOMAINS.map(domainPlugin);

export const SystemPlugin: Plugin = {
    name: 'SystemPlugin',
    build(world) {
        for (const plugin of DOMAIN_PLUGINS) {
            world.addPlugin(plugin);
        }
    }
};
