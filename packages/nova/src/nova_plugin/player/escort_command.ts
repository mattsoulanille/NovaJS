import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';

/**
 * Escort command state (see escort_command_plugin.ts for the systems).
 * Split into its own module so bay_plugin (which stamps the default
 * command on launched fighters) and the command plugin (which imports
 * bay_plugin's return-home flow) don't form an import cycle.
 */

export const EscortCommand = t.union([
    /** Hold formation on the leader. The default; commands reset to
     * this at the boundaries where escorts are (re)created — entering
     * a system and lifting off from a planet. */
    t.literal('formation'),
    /** Attack the ship snapshotted in `target` until it is destroyed,
     * then return to formation. */
    t.literal('attack'),
    /** Fly formation, but engage any iff-hostile ship that comes
     * within DEFEND_RADIUS; `target` holds the current intruder. */
    t.literal('defend'),
    /** Come to rest relative to the system and stay put (no anchor:
     * knocked around, it stops again where it is). */
    t.literal('holdPosition'),
    /** Return to the parent's bay and dock (bay-launched fighters);
     * plain escorts just return to formation. */
    t.literal('returnToBay'),
]);
export type EscortCommand = t.TypeOf<typeof EscortCommand>;

export const EscortCommandState = t.intersection([t.type({
    command: EscortCommand,
}), t.partial({
    /** attack: the commanded victim (the player's target at command
     * time). defend: the intruder currently being engaged. */
    target: t.string,
})]);
export type EscortCommandState = t.TypeOf<typeof EscortCommandState>;

/**
 * Per-escort command state. Shared, serializer-registered simulation
 * state: commands arrive as player input records and must resolve
 * identically on every peer.
 */
export const EscortCommandComponent =
    new Component<EscortCommandState>('EscortCommand');

/**
 * Per-player escort orders, carried on the player's SHIP as
 * serializable sim state — deliberately NOT a client-local display
 * setting: `restrictTurretsToTarget` gates whether escort turrets FIRE,
 * which is shared simulation behavior; a client-local toggle would make
 * each peer simulate different shots (an instant desync). Toggled
 * through the ordinary control-input path (the unbound
 * 'escortRestrictFire' action), so it rides input records like every
 * other piece of player intent.
 */
export const EscortOrders = t.type({
    /** Restrict formation escorts' opportunistic front-quadrant-turret
     * fire to the ship the player currently targets (still only if
     * that ship is iff-hostile). */
    restrictTurretsToTarget: t.boolean,
});
export type EscortOrders = t.TypeOf<typeof EscortOrders>;
export const EscortOrdersComponent = new Component<EscortOrders>('EscortOrders');
