/**
 * The title screen's ROLLBACK view for one pilot's checkpoint history
 * (title/pilot_history.ts): a galaxy map with the selected checkpoint's
 * system ringed and the path of the checkpoints before it drawn as a
 * route, a scrollable list of every checkpoint (date · place · label),
 * detail panes for the selected one (ship, credits, outfits, missions and
 * mission events, escorts; control bits behind a toggle), and Rewind /
 * Export copy / Cancel.
 *
 * Built like the landed menus (Button, MenuControls, the list-selection
 * wrap-around, the starmap's SystemGraph) but on a drawn panel rather
 * than a PICT frame: the original has no such screen, so there is no
 * original art to reproduce. Client-only; the sim is never involved.
 *
 * Headless driving: the container is named 'RollbackScreen', each list
 * row 'RollbackRow:<index>' (index into history.checkpoints), and the
 * buttons carry Button's 'Button:<label>' names.
 */

import * as PIXI from 'pixi.js';
import { SystemData } from 'novadatainterface/system_data';
import { firstValueFrom, Observable, Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { ControlEvent } from '../nova_plugin/controls_plugin.js';
import { displayName } from '../nova_plugin/display_name.js';
import { systemIsInhabited } from '../nova_plugin/landable.js';
import { Button } from '../spaceport/button.js';
import { wrapIndex } from '../spaceport/list_selection.js';
import { MenuControls } from '../spaceport/menu_controls.js';
import { MissionUniverse } from '../spaceport/mission_universe.js';
import { SystemGraph } from '../spaceport/starmap.js';
import { checkpointState, PilotHistory } from './pilot_history.js';
import {
    checkpointBits, checkpointDetails, checkpointPath, checkpointSystem,
    CheckpointRow, controlBitsText, detailLines, RollbackNames,
    rollbackRows,
} from './rollback_content.js';

export interface RollbackScreenInput {
    pilotName: string;
    history: PilotHistory;
    /** Downloads checkpoint `index` as its own pilot file. */
    onExport?: (index: number) => void;
}

export type RollbackResult =
    | { action: 'rewind', index: number }
    | { action: 'cancel' };

// Panel geometry (container-local; the caller centres the container).
export const ROLLBACK_PANEL = { width: 1000, height: 740 } as const;
const MAP = { x: 16, y: 34, width: 456, height: 419 } as const;
const DETAIL = { x: 16, y: 462, width: 456, height: 250 } as const;
const LIST = {
    x: 490, y: 48, width: 494, rows: 28, rowHeight: 13,
    dayWidth: 92, placeWidth: 118,
} as const;
const EVENTS = { x: 490, y: 430, width: 494, height: 250 } as const;
const BUTTON_Y = 700;
const PATH_LENGTH = 8;

const HEADER_FONT = {
    fontFamily: 'Geneva', fontSize: 14, fill: 0xffffff, align: 'left',
} as const;
const LABEL_FONT = {
    fontFamily: 'Geneva', fontSize: 10, fill: 0x808080, align: 'left',
} as const;
const STATUS_FONT = {
    ...LABEL_FONT, fill: 0xc0c0c0, wordWrap: true,
    wordWrapWidth: ROLLBACK_PANEL.width - 32,
} as const;
const ROW_FONT = {
    fontFamily: 'Geneva', fontSize: 10, fill: 0xffffff, align: 'left',
} as const;
const DETAIL_FONT = {
    fontFamily: 'Geneva', fontSize: 10, fill: 0xffffff, align: 'left',
    wordWrap: true, wordWrapWidth: DETAIL.width - 8, lineHeight: 13,
} as const;
const EVENTS_FONT = {
    ...DETAIL_FONT, wordWrapWidth: EVENTS.width - 8,
} as const;
const SELECTION_COLOR = 0x800000;
const PANEL_FILL = 0x0c0c14;
const PANEL_BORDER = 0x606070;

/** A one-character marker per checkpoint kind, for the list rows. */
export function kindMarker(kind: string): string {
    switch (kind) {
        case 'depart': return '>';
        case 'mission': return '*';
        case 'purchase': return '$';
        case 'capture': return '!';
        case 'rewind': return '<';
        case 'import': return '+';
        default: return ' ';
    }
}

export class RollbackScreen {
    readonly container = new PIXI.Container();
    readonly buildPromise: Promise<void>;
    private controls: MenuControls;
    private results = new Subject<RollbackResult>();

    private universe: MissionUniverse;
    private allSystems: SystemData[] = [];
    private graph?: SystemGraph;
    private graphBitsKey?: string;
    private mapHolder = new PIXI.Container();
    private outfitNames = new Map<string, string>();
    private shipNames = new Map<string, string>();

    private input?: RollbackScreenInput;
    private rows: CheckpointRow[] = [];
    /** Index into `rows` (newest first). */
    private selectedRow = 0;
    private scrollTop = 0;
    private bitsShown = false;
    private rewindArmed = false;

    private header = new PIXI.Text('', HEADER_FONT);
    private status = new PIXI.Text('', STATUS_FONT);
    private listContainer = new PIXI.Container();
    private highlight = new PIXI.Graphics();
    private detailText = new PIXI.Text('', DETAIL_FONT);
    private eventsText = new PIXI.Text('', EVENTS_FONT);
    private buttons: {
        rewind: Button, exportCopy: Button, bits: Button, cancel: Button,
    };

    constructor(private displayAssets: DisplayAssetDataInterface,
        private simulationData: SimulationGameDataInterface,
        controlEvents: Observable<ControlEvent>) {
        this.container.name = 'RollbackScreen';
        this.container.visible = false;
        this.universe = MissionUniverse.shared(simulationData);

        const panel = new PIXI.Graphics()
            .beginFill(PANEL_FILL, 0.97)
            .lineStyle(1, PANEL_BORDER)
            .drawRoundedRect(0, 0, ROLLBACK_PANEL.width, ROLLBACK_PANEL.height, 8)
            .endFill();
        // Swallow clicks so nothing behind the panel reacts.
        panel.eventMode = 'static';
        this.container.addChild(panel);

        this.header.position.set(16, 10);
        this.container.addChild(this.header);
        this.status.position.set(16, BUTTON_Y + 26);
        this.container.addChild(this.status);

        const mapFrame = new PIXI.Graphics()
            .lineStyle(1, PANEL_BORDER)
            .drawRect(MAP.x - 1, MAP.y - 1, MAP.width + 2, MAP.height + 2);
        this.container.addChild(mapFrame);
        this.mapHolder.position.set(MAP.x, MAP.y);
        this.container.addChild(this.mapHolder);

        const detailFrame = new PIXI.Graphics()
            .lineStyle(1, PANEL_BORDER)
            .drawRect(DETAIL.x - 1, DETAIL.y - 1, DETAIL.width + 2, DETAIL.height + 2);
        this.container.addChild(detailFrame);
        this.detailText.position.set(DETAIL.x + 4, DETAIL.y + 4);
        const detailMask = new PIXI.Graphics().beginFill(0xffffff)
            .drawRect(DETAIL.x, DETAIL.y, DETAIL.width, DETAIL.height).endFill();
        this.detailText.mask = detailMask;
        this.container.addChild(detailMask, this.detailText);

        const listHeader = new PIXI.Text('Date', LABEL_FONT);
        listHeader.position.set(LIST.x + 14, LIST.y - 14);
        const placeHeader = new PIXI.Text('Place', LABEL_FONT);
        placeHeader.position.set(LIST.x + 14 + LIST.dayWidth, LIST.y - 14);
        const eventHeader = new PIXI.Text('Event  (newest first)', LABEL_FONT);
        eventHeader.position.set(
            LIST.x + 14 + LIST.dayWidth + LIST.placeWidth, LIST.y - 14);
        this.container.addChild(listHeader, placeHeader, eventHeader);

        const listFrame = new PIXI.Graphics()
            .lineStyle(1, PANEL_BORDER)
            .drawRect(LIST.x - 1, LIST.y - 1, LIST.width + 2,
                LIST.rows * LIST.rowHeight + 2);
        this.container.addChild(listFrame);
        this.listContainer.position.set(LIST.x, LIST.y);
        const listMask = new PIXI.Graphics().beginFill(0xffffff)
            .drawRect(LIST.x, LIST.y, LIST.width, LIST.rows * LIST.rowHeight)
            .endFill();
        this.listContainer.mask = listMask;
        // Wheel over the list scrolls it.
        const listHit = new PIXI.Container();
        listHit.eventMode = 'static';
        listHit.hitArea = new PIXI.Rectangle(0, 0, LIST.width,
            LIST.rows * LIST.rowHeight);
        listHit.on('wheel', (event: PIXI.FederatedWheelEvent) => {
            this.scrollBy(event.deltaY > 0 ? 3 : -3);
        });
        listHit.position.set(LIST.x, LIST.y);
        this.container.addChild(listMask, listHit, this.listContainer);
        this.listContainer.addChild(this.highlight);

        const eventsFrame = new PIXI.Graphics()
            .lineStyle(1, PANEL_BORDER)
            .drawRect(EVENTS.x - 1, EVENTS.y - 1, EVENTS.width + 2, EVENTS.height + 2);
        this.container.addChild(eventsFrame);
        this.eventsText.position.set(EVENTS.x + 4, EVENTS.y + 4);
        const eventsMask = new PIXI.Graphics().beginFill(0xffffff)
            .drawRect(EVENTS.x, EVENTS.y, EVENTS.width, EVENTS.height).endFill();
        this.eventsText.mask = eventsMask;
        this.container.addChild(eventsMask, this.eventsText);

        this.buttons = {
            rewind: new Button(displayAssets, 'Rewind', 90,
                { x: LIST.x, y: BUTTON_Y }),
            exportCopy: new Button(displayAssets, 'Export copy', 90,
                { x: LIST.x + 125, y: BUTTON_Y }),
            bits: new Button(displayAssets, 'Show bits', 90,
                { x: LIST.x + 250, y: BUTTON_Y }),
            cancel: new Button(displayAssets, 'Cancel', 90,
                { x: LIST.x + 375, y: BUTTON_Y }),
        };
        for (const button of Object.values(this.buttons)) {
            this.container.addChild(button.container);
        }
        this.buttons.rewind.click.subscribe(() => this.rewind());
        this.buttons.exportCopy.click.subscribe(() => this.exportCopy());
        this.buttons.bits.click.subscribe(() => this.toggleBits());
        this.buttons.cancel.click.subscribe(() => this.cancel());

        this.controls = new MenuControls(controlEvents, {
            up: () => this.moveSelection(-1),
            down: () => this.moveSelection(1),
            left: () => this.moveSelection(-10),
            right: () => this.moveSelection(10),
            depart: () => this.cancel(),
            map: () => this.cancel(),
        });

        this.buildPromise = this.build();
    }

    private async build() {
        // Every system, for the map (the starmap loads the same set), and
        // the mission universe for planet/system/mission names.
        try {
            const systemIds = (await this.simulationData.ids).System;
            this.allSystems = await Promise.all(
                systemIds.map(s => this.simulationData.data.System.get(s)));
            await this.universe.load();
        } catch (e) {
            console.warn('Rollback view: galaxy data unavailable:', e);
        }
    }

    /**
     * Shows the view for a pilot's history and resolves with the player's
     * choice. Rewind resolves {action: 'rewind', index} (the caller
     * performs the rewind); Cancel/Escape resolve {action: 'cancel'}.
     */
    async show(input: RollbackScreenInput): Promise<RollbackResult> {
        this.input = input;
        this.rows = [];
        this.selectedRow = 0;
        this.scrollTop = 0;
        this.bitsShown = false;
        this.rewindArmed = false;
        this.header.text = `Pilot history — ${input.pilotName}`;
        this.status.text = '';
        this.buttons.bits.setLabel('Show bits');
        this.buttons.rewind.setLabel('Rewind');
        this.container.visible = true;
        this.controls.bind();
        this.status.text = 'Loading galaxy…';
        try {
            await this.buildPromise;
        } finally {
            this.status.text = '';
        }
        // Rows are named through the universe, so they wait for it.
        this.rows = rollbackRows(input.history, this.names());
        this.refreshAll();
        void this.resolveNamesForSelection();
        try {
            return await firstValueFrom(this.results);
        } finally {
            this.container.visible = false;
            this.controls.unbind();
        }
    }

    /** Closes from outside (the caller is going away). No-op when hidden. */
    dismiss() {
        if (this.container.visible) {
            this.cancel();
        }
    }

    // --- Names -----------------------------------------------------------

    private names(): RollbackNames {
        const universe = this.universe;
        return {
            planetName: id => universe.getPlanet(id)
                ? universe.planetName(id) : undefined,
            systemName: id => universe.systemName(id),
            systemOfPlanet: id => universe.systemIdOfPlanet(id),
            outfitName: id => this.outfitNames.get(id)
                ?? this.simulationData.data.Outfit.getCached(id)?.name,
            shipName: id => this.shipNames.get(id)
                ?? this.simulationData.data.Ship.getCached(id)?.name
                    ?.split(';')[0].trim(),
            missionName: id => {
                const name = universe.getMission(id)?.name;
                return name === undefined ? undefined : displayName(name);
            },
        };
    }

    /**
     * Loads the outfit/ship names the selected checkpoint shows (once per
     * id, cached), then redraws the details. Names not yet loaded show as
     * ids in the meantime.
     */
    private async resolveNamesForSelection() {
        const row = this.rows[this.selectedRow];
        if (!row || !this.input) {
            return;
        }
        const pending: Promise<void>[] = [];
        // Fetch whatever the selection shows that is not cached yet.
        const state = this.stateAt(row.index);
        const shipId = state?.ship;
        if (typeof shipId === 'string' && !this.shipNames.has(shipId)) {
            pending.push(this.simulationData.data.Ship.get(shipId).then(ship => {
                this.shipNames.set(shipId, ship.name.split(';')[0].trim());
            }, () => { /* keep the id */ }));
        }
        const outfits = state?.outfits;
        if (Array.isArray(outfits)) {
            for (const entry of outfits) {
                const id = Array.isArray(entry) ? entry[0] : undefined;
                if (typeof id !== 'string' || this.outfitNames.has(id)) {
                    continue;
                }
                pending.push(this.simulationData.data.Outfit.get(id).then(o => {
                    this.outfitNames.set(id, o.name);
                }, () => { /* keep the id */ }));
            }
        }
        if (pending.length === 0) {
            return;
        }
        const generation = this.selectedRow;
        await Promise.all(pending);
        if (this.selectedRow === generation && this.container.visible) {
            this.refreshDetails();
        }
    }

    private stateAt(index: number): { ship?: unknown, outfits?: unknown }
        | undefined {
        if (!this.input) {
            return undefined;
        }
        try {
            const envelope = checkpointState(this.input.history, index) as
                { data?: { ship?: unknown, outfits?: unknown } };
            return envelope.data;
        } catch {
            return undefined;
        }
    }

    // --- Rendering -------------------------------------------------------

    private refreshAll() {
        this.refreshList();
        this.refreshDetails();
        this.refreshMap();
        this.refreshButtons();
    }

    private refreshList() {
        for (const child of [...this.listContainer.children]) {
            if (child !== this.highlight) {
                this.listContainer.removeChild(child);
                child.destroy();
            }
        }
        this.highlight.clear();
        if (this.rows.length === 0) {
            const empty = new PIXI.Text(
                'No checkpoints yet — they are recorded on every departure.',
                ROW_FONT);
            empty.position.set(6, 4);
            this.listContainer.addChild(empty);
            return;
        }
        // Keep the selection inside the visible window.
        if (this.selectedRow < this.scrollTop) {
            this.scrollTop = this.selectedRow;
        } else if (this.selectedRow >= this.scrollTop + LIST.rows) {
            this.scrollTop = this.selectedRow - LIST.rows + 1;
        }
        this.scrollTop = Math.max(0, Math.min(this.scrollTop,
            Math.max(0, this.rows.length - LIST.rows)));
        const visible = this.rows.slice(this.scrollTop,
            this.scrollTop + LIST.rows);
        visible.forEach((row, i) => {
            const y = i * LIST.rowHeight;
            const rowIndex = this.scrollTop + i;
            if (rowIndex === this.selectedRow) {
                this.highlight.beginFill(SELECTION_COLOR)
                    .drawRect(0, y, LIST.width, LIST.rowHeight).endFill();
            }
            const hit = new PIXI.Container();
            hit.name = `RollbackRow:${row.index}`;
            hit.eventMode = 'static';
            hit.cursor = 'pointer';
            hit.hitArea = new PIXI.Rectangle(0, y, LIST.width, LIST.rowHeight);
            hit.on('pointerdown', () => this.select(rowIndex));
            this.listContainer.addChild(hit);

            const marker = new PIXI.Text(kindMarker(row.kind), ROW_FONT);
            marker.position.set(4, y);
            const day = new PIXI.Text(row.day, ROW_FONT);
            day.position.set(14, y);
            const place = new PIXI.Text(row.place, ROW_FONT);
            place.position.set(14 + LIST.dayWidth, y);
            const label = new PIXI.Text(row.label, ROW_FONT);
            label.position.set(14 + LIST.dayWidth + LIST.placeWidth, y);
            this.listContainer.addChild(marker, day, place, label);
        });
    }

    private refreshDetails() {
        const row = this.rows[this.selectedRow];
        if (!row || !this.input) {
            this.detailText.text = '';
            this.eventsText.text = '';
            return;
        }
        const details = checkpointDetails(this.input.history, row.index,
            this.names());
        this.detailText.text = detailLines(details).join('\n');
        const events = details.missionEvents.length > 0
            ? `Mission events here:\n${details.missionEvents.map(e => `  ${e}`).join('\n')}`
            : 'Mission events here: none';
        const missions = details.missions.length > 0
            ? `Active missions (${details.missions.length}):\n`
            + details.missions.map(m => `  ${m}`).join('\n')
            : 'Active missions: none';
        this.eventsText.text = [
            events, '', missions,
            ...(this.bitsShown ? ['', controlBitsText(details)] : []),
        ].join('\n');
    }

    /**
     * Rings the selected checkpoint's system on the map and draws the
     * path of the checkpoints before it as the route overlay. The graph
     * is rebuilt only when the checkpoint's control bits (NCB system
     * visibility) differ from the graph's; otherwise it is re-targeted.
     */
    private refreshMap() {
        const row = this.rows[this.selectedRow];
        if (!row || !this.input || this.allSystems.length === 0) {
            return;
        }
        const names = this.names();
        const history = this.input.history;
        const system = checkpointSystem(history, row.index, names);
        if (!system) {
            return;
        }
        const bits = checkpointBits(history, row.index);
        const key = [...bits].sort((a, b) => a - b).join(',');
        if (!this.graph || key !== this.graphBitsKey
            || !this.graph.hasSystem(system)) {
            if (this.graph) {
                this.mapHolder.removeChild(this.graph.container);
            }
            this.graph = new SystemGraph(this.allSystems, system, {
                playerBits: bits,
                size: { x: MAP.width, y: MAP.height },
                isSystemInhabited: s => systemIsInhabited(s.planets,
                    id => this.universe.getPlanet(id)),
            });
            this.graphBitsKey = key;
            this.mapHolder.addChild(this.graph.container);
        } else {
            this.graph.setCurrentSystem(system);
        }
        this.graph.setRouteState({
            pinned: checkpointPath(history, row.index, names, PATH_LENGTH),
        });
        this.graph.centerOn(system);
    }

    private refreshButtons() {
        const has = this.rows.length > 0;
        this.buttons.rewind.state = has ? 'normal' : 'grey';
        this.buttons.exportCopy.state = has && !!this.input?.onExport
            ? 'normal' : 'grey';
        this.buttons.bits.state = has ? 'normal' : 'grey';
    }

    // --- Interaction -----------------------------------------------------

    private select(rowIndex: number) {
        if (rowIndex < 0 || rowIndex >= this.rows.length) {
            return;
        }
        this.selectedRow = rowIndex;
        this.disarmRewind();
        this.refreshAll();
        void this.resolveNamesForSelection();
    }

    private moveSelection(delta: number) {
        if (this.rows.length === 0) {
            return;
        }
        // ±1 wraps around like every landed list; page steps clamp.
        const next = Math.abs(delta) === 1
            ? wrapIndex(this.selectedRow, delta, this.rows.length)
            : Math.max(0, Math.min(this.rows.length - 1,
                this.selectedRow + delta));
        this.select(next);
    }

    private scrollBy(delta: number) {
        this.scrollTop = Math.max(0, Math.min(this.scrollTop + delta,
            Math.max(0, this.rows.length - LIST.rows)));
        // Redraw the window without moving the selection.
        const keep = this.selectedRow;
        this.selectedRow = Math.max(this.scrollTop,
            Math.min(keep, this.scrollTop + LIST.rows - 1));
        if (this.selectedRow !== keep) {
            this.select(this.selectedRow);
        } else {
            this.refreshList();
        }
    }

    private toggleBits() {
        this.bitsShown = !this.bitsShown;
        this.buttons.bits.setLabel(this.bitsShown ? 'Hide bits' : 'Show bits');
        this.refreshDetails();
    }

    /**
     * Two presses to rewind: the first arms the button ("Confirm?"), the
     * second performs; changing the selection or cancelling disarms. Keeps
     * the confirmation inside the canvas (no native dialog to block a
     * headless driver) while still guarding against a stray click.
     */
    private rewind() {
        const row = this.rows[this.selectedRow];
        if (!row) {
            return;
        }
        if (!this.rewindArmed) {
            this.rewindArmed = true;
            this.buttons.rewind.setLabel('Confirm?');
            this.status.text = `Rewind to "${row.label}"? Press Rewind again `
                + 'to confirm. Later checkpoints are dropped, but the current '
                + 'save is kept as "Before rewind".';
            return;
        }
        this.disarmRewind();
        this.results.next({ action: 'rewind', index: row.index });
    }

    private disarmRewind() {
        if (this.rewindArmed) {
            this.rewindArmed = false;
            this.buttons.rewind.setLabel('Rewind');
            this.status.text = '';
        }
    }

    private exportCopy() {
        const row = this.rows[this.selectedRow];
        if (!row || !this.input?.onExport) {
            return;
        }
        this.input.onExport(row.index);
        this.status.text = `Exported "${row.label}".`;
    }

    private cancel() {
        this.disarmRewind();
        this.results.next({ action: 'cancel' });
    }
}
