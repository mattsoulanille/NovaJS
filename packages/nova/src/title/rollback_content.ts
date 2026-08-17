/**
 * The pure content of the title screen's rollback view: which rows the
 * checkpoint list shows, and what the detail panes say for a selected
 * checkpoint. Kept free of PIXI (like plunderDialogContent) so it can be
 * specced against a history built from real-shaped saves.
 *
 * Everything reads the checkpoint's SAVE STATE (checkpointState) plus the
 * checkpoint's own meta; ids are turned into names through the injected
 * `RollbackNames`, which the screen backs with the game data and falls
 * back to the raw id for anything not loaded.
 */

import { formatDate } from '../nova_plugin/calendar.js';
import { checkpointState, PilotHistory } from './pilot_history.js';

/**
 * The list's compact date ("1 Feb 1177"): calendar.ts's formatDate minus
 * the weekday, which the narrow Date column has no room for.
 */
export function shortDate(date: { day: number, month: number, year: number }):
    string {
    return formatDate(date).replace(/^[A-Za-z]+, /, '');
}

/** Id -> display-name resolvers (return undefined for "unknown"). */
export interface RollbackNames {
    planetName(id: string): string | undefined;
    systemName(id: string): string | undefined;
    /** The system a planet is in (for a checkpoint that only knows its
     * stellar, and for mission destinations). */
    systemOfPlanet(id: string): string | undefined;
    outfitName(id: string): string | undefined;
    shipName(id: string): string | undefined;
    missionName(id: string): string | undefined;
}

/** A resolver that names nothing (ids show raw). */
export const RAW_NAMES: RollbackNames = {
    planetName: () => undefined,
    systemName: () => undefined,
    systemOfPlanet: () => undefined,
    outfitName: () => undefined,
    shipName: () => undefined,
    missionName: () => undefined,
};

/** One row of the checkpoint list (newest first). */
export interface CheckpointRow {
    /** Index into history.checkpoints (0 = oldest). */
    index: number;
    id: string;
    /** The pilot's calendar date, formatted ("Feb 13, 1183"), or "—". */
    day: string;
    /** Stellar name where it happened, else the system name, else "—". */
    place: string;
    label: string;
    kind: string;
}

export interface CheckpointDetails {
    label: string;
    kind: string;
    day: string;
    place: string;
    /** "In <system>" when the checkpoint knows its system. */
    system: string;
    ship: string;
    credits: string;
    /** Owned outfits, name × count, sorted by name. */
    outfits: { name: string, count: number }[];
    /** Active missions at that point, by name. */
    missions: string[];
    /**
     * What happened to missions AT this checkpoint versus the previous
     * one: the checkpoint's own mission label (accepted/completed/...)
     * plus the derived set difference ("+ name" / "− name").
     */
    missionEvents: string[];
    /** Set control bits, ascending. */
    controlBits: number[];
    escortCount: number;
    /** Set ranks (global ids), if any. */
    ranks: string[];
}

/** The save-data fields the content reads (structural, not the codec). */
interface SaveLike {
    ship?: unknown;
    outfits?: unknown;
    system?: unknown;
    credits?: unknown;
    date?: unknown;
    missions?: unknown;
    novaControlBits?: unknown;
    ranks?: unknown;
    escorts?: unknown;
}

function saveOf(history: PilotHistory, index: number): SaveLike {
    const envelope = checkpointState(history, index) as { data?: SaveLike };
    return envelope?.data ?? {};
}

function isDate(v: unknown): v is { day: number, month: number, year: number } {
    return typeof v === 'object' && v !== null
        && typeof (v as { day?: unknown }).day === 'number'
        && typeof (v as { month?: unknown }).month === 'number'
        && typeof (v as { year?: unknown }).year === 'number';
}

function tuples(v: unknown): [string, unknown][] {
    if (!Array.isArray(v)) {
        return [];
    }
    return v.filter((e): e is [string, unknown] =>
        Array.isArray(e) && typeof e[0] === 'string');
}

/** How many outfits detailLines spells out before summarizing the rest. */
export const MAX_OUTFIT_LINES = 30;

/** The stellar/system place text for a checkpoint. */
export function checkpointPlace(checkpoint: { stellar?: string, system?: string },
    names: RollbackNames): string {
    if (checkpoint.stellar) {
        return names.planetName(checkpoint.stellar) ?? checkpoint.stellar;
    }
    if (checkpoint.system) {
        return names.systemName(checkpoint.system) ?? checkpoint.system;
    }
    return '—';
}

/** The list rows, NEWEST FIRST (the row you most likely want is on top). */
export function rollbackRows(history: PilotHistory | undefined,
    names: RollbackNames): CheckpointRow[] {
    if (!history) {
        return [];
    }
    const rows: CheckpointRow[] = history.checkpoints.map((c, index) => ({
        index,
        id: c.id,
        day: c.date ? shortDate(c.date) : '—',
        place: checkpointPlace(c, names),
        label: c.label,
        kind: c.kind ?? 'other',
    }));
    return rows.reverse();
}

/**
 * The map's "current" system for a checkpoint: its own system, or the
 * system its stellar is in, or (last resort) the save's system.
 */
export function checkpointSystem(history: PilotHistory, index: number,
    names: RollbackNames): string | undefined {
    const c = history.checkpoints[index];
    if (c.system) {
        return c.system;
    }
    if (c.stellar) {
        const system = names.systemOfPlanet(c.stellar);
        if (system) {
            return system;
        }
    }
    const system = saveOf(history, index).system;
    return typeof system === 'string' ? system : undefined;
}

/**
 * The systems of the `count` checkpoints BEFORE `index`, nearest first,
 * consecutive duplicates collapsed and the selected checkpoint's own
 * system dropped from the front — i.e. the waypoints, in order, of the
 * path that led here. For the map's route overlay.
 */
export function checkpointPath(history: PilotHistory, index: number,
    names: RollbackNames, count = 8): string[] {
    const here = checkpointSystem(history, index, names);
    const path: string[] = [];
    let last = here;
    for (let i = index - 1; i >= 0 && path.length < count; i--) {
        const system = checkpointSystem(history, i, names);
        if (!system || system === last) {
            continue;
        }
        path.push(system);
        last = system;
    }
    return path;
}

/** The set control bits of the save at `index` (empty when unknown). */
export function checkpointBits(history: PilotHistory, index: number):
    Set<number> {
    const bits = tuples(saveOf(history, index).novaControlBits)
        .map(([bit]) => Number(bit))
        .filter(bit => Number.isInteger(bit));
    return new Set(bits);
}

/** Everything the detail panes show for checkpoint `index`. */
export function checkpointDetails(history: PilotHistory, index: number,
    names: RollbackNames): CheckpointDetails {
    const checkpoint = history.checkpoints[index];
    const save = saveOf(history, index);
    const previous = index > 0 ? saveOf(history, index - 1) : undefined;

    const shipId = typeof save.ship === 'string' ? save.ship : undefined;
    const ship = shipId ? (names.shipName(shipId) ?? shipId) : '—';
    const credits = typeof save.credits === 'number'
        ? `${save.credits.toLocaleString()} cr` : '—';

    const outfits = tuples(save.outfits)
        .filter((e): e is [string, number] => typeof e[1] === 'number' && e[1] > 0)
        .map(([id, count]) => ({ name: names.outfitName(id) ?? id, count }))
        .sort((a, b) => a.name.localeCompare(b.name));

    const missionIds = tuples(save.missions).map(([id]) => id);
    const missions = missionIds.map(id => names.missionName(id) ?? id);

    const missionEvents: string[] = [];
    if ((checkpoint.kind ?? '') === 'mission') {
        missionEvents.push(checkpoint.label);
    }
    if (previous) {
        const before = new Set(tuples(previous.missions).map(([id]) => id));
        const after = new Set(missionIds);
        for (const id of after) {
            if (!before.has(id)) {
                missionEvents.push(`+ ${names.missionName(id) ?? id}`);
            }
        }
        for (const id of before) {
            if (!after.has(id)) {
                missionEvents.push(`− ${names.missionName(id) ?? id}`);
            }
        }
    }

    const controlBits = [...checkpointBits(history, index)]
        .sort((a, b) => a - b);
    const escorts = Array.isArray(save.escorts) ? save.escorts.length : 0;
    const ranks = Array.isArray(save.ranks)
        ? save.ranks.filter((r): r is string => typeof r === 'string') : [];
    const systemId = checkpointSystem(history, index, names);

    return {
        label: checkpoint.label,
        kind: checkpoint.kind ?? 'other',
        day: checkpoint.date ? shortDate(checkpoint.date)
            : isDate(save.date) ? shortDate(save.date) : '—',
        place: checkpointPlace(checkpoint, names),
        system: systemId ? (names.systemName(systemId) ?? systemId) : '—',
        ship,
        credits,
        outfits,
        missions,
        missionEvents,
        controlBits,
        escortCount: escorts,
        ranks,
    };
}

/**
 * The detail pane's text lines: the fixed facts, then the outfits and
 * missions as compact lists (a name × count per line, wrapped by the
 * caller's text width). Kept here so the screen only positions text.
 */
export function detailLines(details: CheckpointDetails): string[] {
    const lines = [
        `${details.label}`,
        `${details.day} · ${details.place}`
        + (details.system !== '—' && details.system !== details.place
            ? ` (${details.system})` : ''),
        `Ship: ${details.ship}`,
        `Credits: ${details.credits}`,
    ];
    if (details.escortCount > 0) {
        lines.push(`Escorts: ${details.escortCount}`);
    }
    if (details.ranks.length > 0) {
        lines.push(`Ranks: ${details.ranks.length}`);
    }
    lines.push('');
    // The pane has room for a few dozen entries; a hoard is summarized.
    const shown = details.outfits.slice(0, MAX_OUTFIT_LINES);
    const more = details.outfits.length - shown.length;
    lines.push(details.outfits.length > 0
        ? `Outfits (${details.outfits.length}): `
        + shown.map(o => `${o.name} ×${o.count}`).join(', ')
        + (more > 0 ? `, … and ${more} more` : '')
        : 'Outfits: none');
    lines.push('');
    lines.push(details.missions.length > 0
        ? `Missions: ${details.missions.join('; ')}`
        : 'Missions: none');
    if (details.missionEvents.length > 0) {
        lines.push(`Mission events: ${details.missionEvents.join('; ')}`);
    }
    return lines;
}

/** The collapsed-by-default control-bits line. */
export function controlBitsText(details: CheckpointDetails): string {
    return details.controlBits.length === 0
        ? 'Control bits: none set'
        : `Control bits (${details.controlBits.length}): `
        + details.controlBits.join(' ');
}
