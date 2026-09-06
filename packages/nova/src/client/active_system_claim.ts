/**
 * The active-system claim a transition makes on its way into a system:
 * name it as the active system and join its room, in one step whose undo
 * is registered on the transition's scope.
 *
 * `enterSystem` (browser.ts) tears the old system down, names the new one
 * and joins its room BEFORE any of the long waits — the world build, the
 * Worker, the snapshot. A rejection in that window used to leave the name
 * standing with no world behind it: inert (the pump guards on the bridge,
 * the save on the display world, and the recovery paths re-enter through
 * `jumpTo`, which overwrites it), but a name that lied about where the
 * player was, and a room joined under this peer's uuid that only the NEXT
 * teardown would leave (review of PR #145, finding 6).
 *
 * The undo is guarded: it releases the claim only if the claim is still
 * this transition's — the name unchanged and no world published — so a
 * newer transition's claim on the same or another system is never undone
 * by an older transition's late failure (the same guard the Worker cleanup
 * uses on `simulationWorker`).
 *
 * Client-local module: nothing here touches simulation state.
 */

import { TransitionScope } from './session_transitions.js';

/** The module-level "where the player is" slot this claim writes. */
export interface ActiveSystemSlot {
    get(): string | undefined;
    set(systemId: string | undefined): void;
    /**
     * Whether a world stands behind the active system: once a transition
     * has published one, its claim is no longer undone by anything.
     */
    published(): boolean;
}

export interface SystemRooms<Room> {
    join(systemId: string): Room;
    leave(systemId: string): void;
}

/**
 * Names `to` as the active system and joins its room. If the transition
 * running under `scope` rejects before it publishes a world, the claim is
 * released again: the room is left and the name cleared.
 */
export function claimActiveSystem<Room>(scope: TransitionScope, to: string,
    rooms: SystemRooms<Room>, slot: ActiveSystemSlot): Room {
    slot.set(to);
    const room = rooms.join(to);
    scope.onFailure(() => {
        if (slot.get() === to && !slot.published()) {
            rooms.leave(to);
            slot.set(undefined);
        }
    });
    return room;
}
