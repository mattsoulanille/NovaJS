import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';

/**
 * The tag a mission's special ship wears in the shared simulation.
 *
 * Split out of mission_ship_plugin.ts (which owns the systems that
 * evaluate goals against it) because the tag is read far below the
 * mission machinery: the NPC AI's hulk selection, boarding, the
 * player-escort cap and the display's target pane all ask "is this a
 * mission ship?" without needing anything else from missions. Keeping
 * the component here lets those readers depend on player state alone
 * rather than on the whole mission module graph.
 */
export const MissionShipType = t.intersection([t.type({
    /** The owning player's active mission id (e.g. 'nova:258'). */
    mission: t.string,
    /** Entity uuid of the owning player's ship. */
    owner: t.string,
}), t.partial({
    /** An AuxShip: mission atmosphere, not part of the goal. */
    aux: t.boolean,
    /**
     * Spawned by a mission that auto-aborted at accept (the Derelict
     * Decoy's ambush, mïsn 133): the mission never joins the owner's
     * MissionsComponent, so the ship is tethered to the OWNER's presence
     * only — never to the mission being active. Without this the cleanup
     * in mission_ship_plugin deleted the ambush a few ticks after it
     * jumped in.
     */
    untethered: t.boolean,
    /**
     * The name this special ship wears, copied from the owner's
     * ActiveMission.shipName at spawn (mïsn ShipNameID; see
     * mission_ship_spawn.ts). Carried on the COMPONENT rather than on
     * Entity.name — Entity.name is a debugging label that never crosses
     * the serializer into the display world, so the target pane and the
     * hail dialog could not see it. Read by status_bar's target pane and
     * hail_dialog_plugin, exactly as PersComponent.name is: a named
     * special ship shows its name in place of its ship class.
     *
     * Absent for aux ships (the Bible gives them no names) and for
     * missions whose ShipNameID is -1.
     */
    name: t.string,
    /** The ShipSubtitle sibling of `name`, shown in place of the ship
     * class's own subtitle. Absent when the mission sets none. */
    subtitle: t.string,
})]);
export type MissionShip = t.TypeOf<typeof MissionShipType>;
export const MissionShipComponent =
    new Component<MissionShip>('MissionShipComponent');
