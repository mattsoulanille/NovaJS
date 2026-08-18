import { Component } from 'nova_ecs/component';

/**
 * Ship ids of escorts hired in the bar this landing, carried on the
 * docked player entity until launch. Display-side bookkeeping only:
 * browser.ts pops this component off the entity before re-adding it
 * to the simulation and spawns each escort through the same
 * input-record addEntity path the relaunched player ship uses, so the
 * spawns are deterministic across peers.
 *
 * This component covers only escorts hired THIS landing. Escorts the
 * player already had are a different mechanism: they follow the player's
 * lifecycle (landing with them, departing with them, jumping with them)
 * through PlayerEscortComponent and the carried-escort roster — see
 * nova_plugin/player_escort_plugin.ts and landed_escorts.ts.
 *
 * PERSISTENCE. Once spawned, hired escorts are ordinary escorts: they
 * follow the player through jumps and gates (PlayerEscortComponent and
 * the sweep systems in nova_plugin/player_escort_plugin.ts) and are
 * written into the save as whole serialized entities (`escorts`, added
 * in SAVE_VERSION 2 — see save_game.ts, `SavedEscort`). What is NOT
 * saved is this component itself: it is display-side bookkeeping on the
 * docked ship, popped by browser.ts at lift-off, and it is not part of
 * SaveData — so a save written while docked, between hiring at the bar
 * and lifting off, does not carry the not-yet-spawned hires.
 */
export const PendingEscortsComponent =
    new Component<string[]>('PendingEscorts');
