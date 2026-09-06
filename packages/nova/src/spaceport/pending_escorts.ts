import { Component } from 'nova_ecs/component';
import { Entity } from 'nova_ecs/entity';

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

/**
 * Moves a landing's hires (the transaction's `hired` list, which
 * hire_escort.ts appends to) onto the entity's PendingEscortsComponent,
 * and EMPTIES the list in the same step. Run by the transaction's flush
 * (landed_transaction.ts), so the bar's Leave is what moves them.
 *
 * The emptying is the point, not a tidy-up. The escort cap
 * (hire_escort.ts's `escortsHeld`, feeding escort_cap.ts's
 * cappedEscortCount as its `pending`) counts the component; the hire
 * dialog adds the visit list on top to count the pilots hired since the
 * last commit. That sum is right only while no hire is in both places at once
 * — so the one operation that copies one into the other also clears the
 * source, and there is no way to commit that leaves a hire counted twice.
 * Returns how many were committed.
 */
export function commitPendingEscorts(entity: Entity, hired: string[]): number {
    const count = hired.length;
    if (count === 0) {
        return 0;
    }
    const pending = entity.components.get(PendingEscortsComponent) ?? [];
    entity.components.set(PendingEscortsComponent, [...pending, ...hired]);
    hired.length = 0;
    return count;
}
