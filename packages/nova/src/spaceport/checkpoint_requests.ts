/**
 * The client-side bus on which the landed UI asks for a pilot-history
 * checkpoint (title/pilot_history.ts) to be recorded, plus the pure label
 * helpers that name one.
 *
 * The venues know WHAT happened (a mission was accepted, three Battery
 * Packs were bought, a ship was traded in); only browser.ts knows how to
 * turn the player entity into a save envelope (escorts, the active system)
 * and which pilot's history to append to. So the venues publish a request
 * here — the label, and the entity whose state to snapshot — and the game
 * client subscribes once (browser.ts installCheckpointRecorder). With no
 * subscriber (every headless test) a request is a no-op.
 *
 * Purely player-local: nothing here reaches the simulation.
 */

import { Entity } from 'nova_ecs/entity';
import { Subject } from 'rxjs';
import type { CheckpointKind } from '../title/pilot_history.js';
import type { MissionEvent } from '../nova_plugin/missions/index.js';
import { displayName } from '../nova_plugin/core/index.js';

export interface CheckpointRequest {
    /** Human-readable, e.g. "Accepted: Delivery to Sirius". */
    label: string;
    kind: CheckpointKind;
    /**
     * The entity holding the state to snapshot: the docked ship as the
     * venue just committed it. Omitted, the recorder snapshots whatever
     * player entity it currently holds (docked or in flight).
     */
    entity?: Entity;
    /** The stellar (planet) global id where it happened, if known. */
    stellar?: string;
}

export const checkpointRequests = new Subject<CheckpointRequest>();

/** Asks the client to record a checkpoint. No-op without a subscriber. */
export function requestCheckpoint(request: CheckpointRequest): void {
    checkpointRequests.next(request);
}

/** Labels longer than this are cut with an ellipsis (list-row width). */
export const MAX_LABEL_LENGTH = 72;

export function truncateLabel(label: string,
    max: number = MAX_LABEL_LENGTH): string {
    return label.length <= max ? label : `${label.slice(0, max - 1)}…`;
}

/**
 * The checkpoint label for a mission event, or undefined for the event
 * types that are progress notices rather than state changes worth their
 * own checkpoint (cargo loaded/dropped, ship goal done — those ride the
 * next departure).
 */
export function missionEventLabel(
    event: Pick<MissionEvent, 'type' | 'missionName'>): string | undefined {
    // Mission names carry a "; note" author suffix the player never sees.
    const name = event.missionName ? displayName(event.missionName) : 'mission';
    switch (event.type) {
        case 'accepted': return truncateLabel(`Accepted: ${name}`);
        case 'completed': return truncateLabel(`Completed: ${name}`);
        case 'failed': return truncateLabel(`Failed: ${name}`);
        case 'aborted': return truncateLabel(`Aborted: ${name}`);
        case 'autoAborted': return truncateLabel(`Auto-aborted: ${name}`);
        case 'shipDone':
        case 'cargoLoaded':
        case 'cargoDropped':
            return undefined;
        default: {
            // An event kind from a newer build (MissionEventType is open on
            // the wire) is a progress notice as far as this build knows.
            const unknownType: never = event.type;
            void unknownType;
            return undefined;
        }
    }
}

/**
 * The checkpoint label for an outfitter visit: what was bought and sold,
 * comparing the outfit counts before and after ("Bought Battery Pack ×3,
 * Sold Blaster ×1"). Undefined when nothing changed. `nameOf` resolves an
 * outfit id to its display name (falls back to the id).
 */
export function describeOutfitChanges(
    before: Iterable<readonly [string, number]>,
    after: Iterable<readonly [string, number]>,
    nameOf: (id: string) => string | undefined): string | undefined {
    const prev = new Map<string, number>();
    for (const [id, count] of before) {
        prev.set(id, count);
    }
    const next = new Map<string, number>();
    for (const [id, count] of after) {
        next.set(id, count);
    }
    const bought: string[] = [];
    const sold: string[] = [];
    const ids = new Set([...prev.keys(), ...next.keys()]);
    for (const id of ids) {
        const delta = (next.get(id) ?? 0) - (prev.get(id) ?? 0);
        if (delta === 0) {
            continue;
        }
        const name = nameOf(id) ?? id;
        const item = `${name} ×${Math.abs(delta)}`;
        (delta > 0 ? bought : sold).push(item);
    }
    if (bought.length === 0 && sold.length === 0) {
        return undefined;
    }
    const parts: string[] = [];
    if (bought.length > 0) {
        parts.push(`Bought ${bought.join(', ')}`);
    }
    if (sold.length > 0) {
        parts.push(`Sold ${sold.join(', ')}`);
    }
    return truncateLabel(parts.join('; '));
}

/**
 * The state the in-flight change detector compares between saves: the
 * ship type and the set of active mission ids (structurally SaveData's
 * fields, so a caller can pass a SaveData).
 */
export interface FlightSnapshot {
    ship: string;
    missions?: ReadonlyArray<readonly [string, unknown]>;
}

/**
 * Names the changes the SIMULATION made to the player between two saves
 * — a ship captured by boarding, a mission accepted from a ship in flight
 * — which no landed venue commits and so no request announces. The
 * client's periodic save runs this against the state at the last
 * checkpoint and records one checkpoint for whatever it finds. Empty when
 * nothing checkpoint-worthy changed.
 */
export function describeFlightChanges(prev: FlightSnapshot | undefined,
    next: FlightSnapshot, names: {
        shipName: (id: string) => string | undefined,
        missionName: (id: string) => string | undefined,
    }): { label: string, kind: CheckpointKind }[] {
    if (!prev) {
        return [];
    }
    const found: { label: string, kind: CheckpointKind }[] = [];
    if (prev.ship !== next.ship) {
        found.push({
            label: truncateLabel(
                `Captured ${names.shipName(next.ship) ?? next.ship}`),
            kind: 'capture',
        });
    }
    const before = new Set((prev.missions ?? []).map(([id]) => id));
    const after = new Set((next.missions ?? []).map(([id]) => id));
    for (const id of after) {
        if (!before.has(id)) {
            found.push({
                label: truncateLabel(
                    `Accepted: ${names.missionName(id) ?? id}`),
                kind: 'mission',
            });
        }
    }
    for (const id of before) {
        if (!after.has(id)) {
            found.push({
                label: truncateLabel(
                    `Mission over: ${names.missionName(id) ?? id}`),
                kind: 'mission',
            });
        }
    }
    return found;
}
