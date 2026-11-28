import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';
import { Plugin } from 'nova_ecs/plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';

/**
 * ============================================================================
 * përs unique characters (spawning and identity; see the gaps below)
 * ============================================================================
 *
 * A përs is a named AI personality: "when ships are created, there is
 * a 5% chance that a specific AI-person will also be created" (EVN
 * Bible pp. 47-49). The deterministic NPC spawn machinery
 * (npc_spawn_plugin.ts) implements exactly that: each spawn draw rolls
 * the 5% from the shared seeded Random against the system's genesis
 * përs table (LinkSyst eligibility + staged game data), so every peer
 * spawns the same people at the same ticks. The people a sÿst's own
 * Person list names are also rolled once at their percent when the
 * system is populated, traffic or not (spawnListedPersons: the Bible's
 * "Want to make a 'pers' type ship always appear? Put its ID into one
 * of the Person fields"). The person's name is shown
 * in place of the ship class name on the target display
 * (status_bar.ts), which is what this component carries.
 *
 * IMPLEMENTED: eligibility (LinkSyst, ActiveOn against an empty bit
 * set — the same shared-vs-personal constraint as flët AppearOn: one
 * player's mission bits cannot make a person exist for everyone),
 * ship class, government, AI type, custom name/subtitle, at most one
 * living instance of a person per system, deterministic spawn timing.
 *
 * ELSEWHERE: hailing and boarding exist, and read the person through
 * this component. The comm quote and hail pict show in the hail dialog
 * (nova_plugin/reputation/hail.ts, display/hail_dialog_plugin.ts); the
 * HailQuote and the LinkMission offer, on hail or on boarding, with
 * their hail-gating and after-accept flags, live in
 * spaceport/ship_mission_offer.ts and display/ship_mission_offer_plugin.ts.
 *
 * DOCUMENTED GAPS (hooks for future work):
 *  - Boarding grants (GrantClass/Count/Chance) and the përs Credits
 *    booty are parsed (novadatainterface/pers_data.ts) but inert: a
 *    boarded person yields the same booty as any hull of its class.
 *    Flags 0x0100 (deactivate after the LinkMission is accepted) and
 *    0x8000 (disaster info when hailed) are inert too.
 *  - Per-player përs-alive tracking: the original's pilot file
 *    records which people have been killed and stops spawning them.
 *    Spawning is shared-sim state here, so it draws from the shared
 *    genesis table; a killed person can reappear on the next
 *    eligible spawn draw.
 *  - ShieldMod, custom weapon loadouts, ship paint color, Aggress,
 *    Coward and the escape-pod/grudge flags are carried in PersData but
 *    not applied to the spawned ship (shields and weapons are
 *    provider-derived from the ship class). The grudge is only
 *    approximated, by "attacking the player", for gating the hail offer.
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
