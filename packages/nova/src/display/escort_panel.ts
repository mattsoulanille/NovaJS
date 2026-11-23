// The escort command panel: what `e` (controls.json `escorts`, the
// original's escortMenuKey) shows over the space view. Measured on the
// reference Mac in an 832x604 window (docs/reference_experiments.md,
// "E-view: the escort command panel"):
//
//  * A floating 160x120 box at (15,150) with a 1px outline in cölr
//    FloatingMap and NO background (the stars show through).
//  * "Escort Commands" centred at the top, then five rows 18px apart:
//    `1) All Ships`, `2) Fighters`, `3) Medium Ships`, `4) Warships`,
//    `5) Freighters`. Rows 2-5 show the category's current order
//    right-aligned; a category with no escorts is drawn grey.
//  * The selected row sits on a 153x13 bar of cölr EscortHilite.
//
// Behaviour (the doc's table): `e` toggles it, opening on row 1 every
// time; with no escorts it does not open and the status line says so.
// 1-5 and clicks pick a row; f/d/v/c give the selected category (row 1:
// every category) Attack/Defend/Hold Position/Formation, and with the
// panel closed they go to every category. Up/Down close it and still fly
// the ship; Left/Right just turn. It never pauses the game and never
// times out.
//
// This module is the panel's logic, free of PIXI so it can be specced:
// the control-event filter (EscortPanelController) and the rows
// (escortPanelRows). escort_panel_plugin.ts draws it and wires it in.
//
// MULTIPLAYER. The panel is client-local UI; only orders reach the
// simulation, as ordinary control input. A row-2..5 order carries that
// category's selector action as a 'start' edge in the SAME batch, so the
// same input record (nova_plugin/player/escort_command.ts
// ESCORT_CATEGORY_SELECTORS). Selecting a row sends nothing at all.
import type { ControlAction, ControlEvent } from '../nova_plugin/core/index.js';
import {
    ESCORT_CATEGORIES, ESCORT_CATEGORY_SELECTORS, EscortCategory, EscortCommand,
} from '../nova_plugin/player/index.js';

/** The panel's outer box, in UI-logical pixels. */
export const ESCORT_PANEL_SIZE = { width: 160, height: 120 };
/**
 * Where the box's top-left corner goes. The original's 832x604 window has
 * it at (15,150). The only floating element measured at both window sizes,
 * the `h` minimap, keeps the same 150px top at 1920x1080 (and the same
 * 16px gap to the status bar it is anchored to), so floating panels are
 * placed at fixed offsets, not scaled: this one keeps (15,150) from the
 * top-left corner at every size.
 */
export const ESCORT_PANEL_POSITION = { x: 15, y: 150 };
/** The selection bar, relative to the box: x 19-171, rows 18px apart from
 * row 1's y 180-192 (absolute, in the 832x604 measurement). */
export const ESCORT_PANEL_BAR = { x: 4, y: 30, width: 153, height: 13 };
export const ESCORT_PANEL_ROW_PITCH = 18;
export const ESCORT_PANEL_ROWS = 5;

/**
 * The panel's words: stock Nova's STR# 2002 ("misc strings"), which the
 * plugin reads at build time; these are the fallbacks. The indexes are
 * 0-based into the table's strings.
 */
export const ESCORT_PANEL_STRINGS = {
    title: 'Escort Commands',
    noEscorts: 'You don\'t have any escorts.',
    allShips: 'All Ships',
    categories: {
        fighter: 'Fighters',
        medium: 'Medium Ships',
        warship: 'Warships',
        freighter: 'Freighters',
    } as Record<EscortCategory, string>,
    orders: {
        defend: 'Defend',
        attack: 'Attack',
        holdPosition: 'Hold Position',
        returnToBay: 'Return to Hangar',
        formation: 'Formation',
    } as Record<EscortCommand, string>,
};
export type EscortPanelStrings = typeof ESCORT_PANEL_STRINGS;
export const ESCORT_PANEL_STRING_TABLE = 'nova:2002';
export const ESCORT_PANEL_STRING_INDEXES = {
    title: 132,
    noEscorts: 50,
    allShips: 143,
    categories: { fighter: 139, medium: 140, warship: 141, freighter: 142 },
    orders: {
        defend: 144, attack: 145, holdPosition: 146, returnToBay: 147,
        formation: 148,
    },
} as const;

/** Reads the panel's strings out of STR# 2002, keeping each fallback where
 * the table has nothing usable. */
export function escortPanelStrings(table: readonly string[] | undefined):
    EscortPanelStrings {
    const pick = (index: number, fallback: string) =>
        table?.[index]?.trim() ? table[index] : fallback;
    const i = ESCORT_PANEL_STRING_INDEXES;
    const f = ESCORT_PANEL_STRINGS;
    return {
        title: pick(i.title, f.title),
        noEscorts: pick(i.noEscorts, f.noEscorts),
        allShips: pick(i.allShips, f.allShips),
        categories: Object.fromEntries(ESCORT_CATEGORIES.map(c =>
            [c, pick(i.categories[c], f.categories[c])])) as
            Record<EscortCategory, string>,
        orders: Object.fromEntries((Object.keys(f.orders) as EscortCommand[])
            .map(o => [o, pick(i.orders[o], f.orders[o])])) as
            Record<EscortCommand, string>,
    };
}

/** One of the player's direct escorts, as the panel sees it. */
export interface EscortPanelEntry {
    category: EscortCategory;
    command: EscortCommand;
}

export interface EscortPanelRow {
    label: string;
    /** The category's current order; empty for row 1. */
    order: string;
    /** False draws the row grey: no escorts in it. */
    enabled: boolean;
}

/**
 * The five rows. Orders are kept per escort, so a category's order is the
 * one most of its escorts are on (one that finished an attack has gone
 * back to Formation by itself); a tie goes to the deliberate order over
 * Formation (ORDER_PRECEDENCE). An empty category shows Formation, what a
 * brand-new escort starts on.
 */
export function escortPanelRows(entries: readonly EscortPanelEntry[],
    strings: EscortPanelStrings): EscortPanelRow[] {
    const rows: EscortPanelRow[] = [{
        label: `1) ${strings.allShips}`,
        order: '',
        enabled: entries.length > 0,
    }];
    for (const [i, category] of ESCORT_CATEGORIES.entries()) {
        const counts = new Map<EscortCommand, number>();
        for (const entry of entries) {
            if (entry.category === category) {
                counts.set(entry.command, (counts.get(entry.command) ?? 0) + 1);
            }
        }
        let order: EscortCommand = 'formation';
        let best = 0;
        for (const command of ORDER_PRECEDENCE) {
            const count = counts.get(command) ?? 0;
            if (count > best) {
                order = command;
                best = count;
            }
        }
        rows.push({
            label: `${i + 2}) ${strings.categories[category]}`,
            order: strings.orders[order],
            enabled: best > 0,
        });
    }
    return rows;
}

/** Tie-break for escortPanelRows: a deliberate order outranks Formation,
 * the state escorts drift back to by themselves. */
const ORDER_PRECEDENCE: readonly EscortCommand[] =
    ['attack', 'defend', 'holdPosition', 'returnToBay', 'formation'];

/** The order keys: f, d, v, c (and NovaJS's Alt+C return-to-bay). */
const ORDER_ACTIONS = new Set<ControlAction>(
    ['attack', 'defend', 'holdPosition', 'formation', 'returnToBay']);
/** Thrust and reverse close the panel (and still fly the ship). */
const CLOSING_ACTIONS = new Set<ControlAction>(['accelerate', 'reverse']);
/** Rows 1-5 answer to the stellar-selection number keys while open. */
const ROW_ACTIONS = new Map<ControlAction, number>(
    [1, 2, 3, 4, 5].map(n => [`selectStellar${n}` as ControlAction, n - 1]));
/** Row 2..5 -> the category selector its orders carry. */
const ROW_SELECTORS: readonly (ControlAction | undefined)[] = [undefined,
    ...ESCORT_CATEGORIES.map(c => ESCORT_CATEGORY_SELECTORS[c])];

export interface EscortPanelHost {
    /** Whether the local player has any direct escorts right now. */
    hasEscorts(): boolean;
    /** Puts a line on the status line. */
    message(text: string): void;
}

/**
 * The panel's state and its say over the keyboard. `filter` takes one
 * batch of in-space control events and returns what should go on to the
 * simulation and the rest of the client: `e` and the row keys are
 * consumed while they act on the panel, and an order on rows 2-5 gains
 * its category selector.
 */
export class EscortPanelController {
    open = false;
    selectedRow = 0;
    strings: EscortPanelStrings = ESCORT_PANEL_STRINGS;

    constructor(private readonly host: EscortPanelHost) { }

    filter(events: readonly ControlEvent[]): ControlEvent[] {
        const passed: ControlEvent[] = [];
        for (const event of events) {
            if (event.action === 'escorts') {
                if (event.state === 'start') {
                    this.toggle();
                }
                continue; // The simulation has no use for it.
            }
            if (!this.open) {
                passed.push(event);
                continue;
            }
            const row = ROW_ACTIONS.get(event.action);
            if (row !== undefined && event.state !== false) {
                if (event.state === 'start') {
                    this.selectRow(row);
                }
                continue;
            }
            if (event.state === 'start' && ORDER_ACTIONS.has(event.action)) {
                const selector = ROW_SELECTORS[this.selectedRow];
                if (selector) {
                    passed.push({ action: selector, state: 'start' });
                }
            } else if (event.state === 'start'
                && CLOSING_ACTIONS.has(event.action)) {
                this.close();
            }
            passed.push(event);
        }
        return passed;
    }

    selectRow(row: number) {
        if (row >= 0 && row < ESCORT_PANEL_ROWS) {
            this.selectedRow = row;
        }
    }

    close() {
        this.open = false;
    }

    private toggle() {
        if (this.open) {
            this.close();
            return;
        }
        if (!this.host.hasEscorts()) {
            this.host.message(this.strings.noEscorts);
            return;
        }
        this.open = true;
        this.selectedRow = 0;
    }
}
