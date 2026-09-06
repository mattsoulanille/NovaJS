import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';
import { Plugin } from 'nova_ecs/plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';

/**
 * ============================================================================
 * përs unique characters (spawning only; see the gaps below)
 * ============================================================================
 *
 * A përs is a named AI personality: "when ships are created, there is
 * a 5% chance that a specific AI-person will also be created" (EVN
 * Bible pp. 47-49). The deterministic NPC spawn machinery
 * (npc_spawn_plugin.ts) implements exactly that: each spawn draw rolls
 * the 5% from the shared seeded Random against the system's genesis
 * përs table (LinkSyst eligibility + staged game data), so every peer
 * spawns the same people at the same ticks. The person's name is shown
 * in place of the ship class name on the target display
 * (status_bar.ts), which is what this component carries.
 *
 * IMPLEMENTED: eligibility (LinkSyst, ActiveOn against an empty bit
 * set — the same shared-vs-personal constraint as flët AppearOn: one
 * player's mission bits cannot make a person exist for everyone),
 * ship class, government, AI type, custom name/subtitle, at most one
 * living instance of a person per system, deterministic spawn timing.
 *
 * DOCUMENTED GAPS (hooks for future work):
 *  - Hail quotes, comm quotes, hail picts, LinkMission offers, and
 *    boarding grants (GrantClass/Count/Chance, Credits booty) are
 *    parsed and plumbed (novadatainterface/pers_data.ts) but inert:
 *    hailing and boarding do not exist in the engine.
 *  - Per-player përs-alive tracking: the original's pilot file
 *    records which people have been killed and stops spawning them.
 *    Spawning is shared-sim state here, so it draws from the shared
 *    genesis table; a killed person can reappear on the next
 *    eligible spawn draw.
 *  - ShieldMod, custom weapon loadouts, ship paint color, and the
 *    escape-pod/grudge flags are carried in PersData but not applied
 *    to the spawned ship (shields and weapons are provider-derived
 *    from the ship class).
 */

export const PersType = t.type({
    /** PersData id, e.g. 'nova:131'. */
    id: t.string,
    /** The person's name (shown in place of the ship class name). */
    name: t.string,
    /** The person's subtitle ('' if none). */
    subtitle: t.string,
});
export type Pers = t.TypeOf<typeof PersType>;
export const PersComponent = new Component<Pers>('PersComponent');

export const PersPlugin: Plugin = {
    name: 'PersPlugin',
    build(world) {
        world.resources.get(SerializerResource)
            ?.addComponent(PersComponent, PersType);
    },
};
