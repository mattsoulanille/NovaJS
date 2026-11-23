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
     * then return to formation. Given with no target (the player had
     * none), the order stands and the escort keeps formation. */
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
     * time; absent when there was none). defend: the intruder currently
     * being engaged. */
    target: t.string,
})]);
export type EscortCommandState = t.TypeOf<typeof EscortCommandState>;

/**
 * The escort command panel's four categories (`e`; rows 2-5 after
 * "All Ships"), from shïp EscortType: "Tells Nova which of the four
 * categories of escorts to put this ship type into when organizing the
 * escort control menu" (EVN Bible).
 */
export const ESCORT_CATEGORIES =
    ['fighter', 'medium', 'warship', 'freighter'] as const;
export type EscortCategory = typeof ESCORT_CATEGORIES[number];

/**
 * The control actions that narrow an escort order to one category. They
 * have no keybinding: the escort panel (display/escort_panel.ts) puts the
 * selected row's action, as a 'start' edge, in the SAME input record as
 * the order key, and EscortCommandInputSystem reads only that edge — so a
 * selector left held by an earlier record never narrows a later order,
 * and nothing about the panel's state has to live in the simulation.
 * With no selector edge an order reaches every category (row 1, or the
 * panel closed).
 */
export const ESCORT_CATEGORY_SELECTORS = {
    fighter: 'escortSelectFighters',
    medium: 'escortSelectMedium',
    warship: 'escortSelectWarships',
    freighter: 'escortSelectFreighters',
} as const satisfies Record<EscortCategory, string>;

/** shïp inherentAI 1, "Wimpy trader". */
const AI_WIMPY_TRADER = 1;
/** shïp inherentAI 3, "Warship". */
const AI_WARSHIP = 3;

/**
 * Which panel category an escort belongs to. shïp EscortType 0-3 is taken
 * as given (0 Fighter, 1 Medium Ship, 2 Warship, 3 Freighter).
 *
 * EscortType -1 is "Have the game try to figure it out at runtime"
 * (Bible), and how the original does that is unknown. Every stock hull
 * sets 0-3 explicitly; -1 occurs only in plug-ins (Arpia, Star Wars Mod).
 * The guess here follows how the stock data itself assigns types:
 *  - a ship launched from a bay is a Fighter (every stock bay ship is 0);
 *  - inherentAI 1, wimpy trader, is a Freighter (36 of the 37 stock
 *    wimpy-trader hulls are 3);
 *  - inherentAI 3, warship, is a Warship (92 of 141);
 *  - anything else (brave traders, interceptors) is Medium, the
 *    commonest type for both.
 * Out-of-range values and a hull whose data is missing get the same
 * guess.
 */
export function escortCategoryOf(
    ship: { escortType: number, inherentAI: number } | undefined,
    bayLaunched: boolean): EscortCategory {
    const explicit = ship ? ESCORT_CATEGORIES[ship.escortType] : undefined;
    if (explicit) {
        return explicit;
    }
    if (bayLaunched) {
        return 'fighter';
    }
    if (ship?.inherentAI === AI_WIMPY_TRADER) {
        return 'freighter';
    }
    if (ship?.inherentAI === AI_WARSHIP) {
        return 'warship';
    }
    return 'medium';
}

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
    /** Restrict formation escorts' opportunistic turret
     * fire to the ship the player currently targets (still only if
     * that ship is iff-hostile). */
    restrictTurretsToTarget: t.boolean,
});
export type EscortOrders = t.TypeOf<typeof EscortOrders>;
export const EscortOrdersComponent = new Component<EscortOrders>('EscortOrders');
