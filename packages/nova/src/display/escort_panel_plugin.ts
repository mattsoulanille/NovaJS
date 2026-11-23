import * as PIXI from 'pixi.js';
import { getDefaultInterfaceColorsData, INTERFACE_COLORS_ID, InterfaceColorsData } from 'novadatainterface/interface_colors_data';
import { Plugin } from 'nova_ecs/plugin';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { SingletonComponent, World } from 'nova_ecs/world';
import { DisplayAssetDataResource, SimulationGameDataResource } from '../nova_plugin/core/index.js';
import { BayFighterComponent, escortParent } from '../nova_plugin/escorts/index.js';
import { escortCategoryOf, EscortCommandComponent, PlayerShipSelector } from '../nova_plugin/player/index.js';
import { ShipComponent, ShipDataComponent } from '../nova_plugin/ship/index.js';
import { MenuControls } from '../spaceport/menu_controls.js';
import { DockedShipResource } from './docked_ship.js';
import {
    ESCORT_PANEL_BAR, ESCORT_PANEL_POSITION, ESCORT_PANEL_ROW_PITCH, ESCORT_PANEL_ROWS,
    ESCORT_PANEL_SIZE, ESCORT_PANEL_STRING_TABLE, EscortPanelController, EscortPanelEntry,
    EscortPanelRow, escortPanelRows, escortPanelStrings,
} from './escort_panel.js';
import { Stage } from './stage_resource.js';
import { showStatusMessage } from './status_message_plugin.js';

/**
 * The escort command panel's display-world state: its controller (which
 * the client's control routing filters in-space key presses through,
 * client/game_session.ts) and its view. Per display world, so the panel
 * is closed again after every jump, as a fresh simulation would expect.
 */
export interface EscortPanelState {
    controller: EscortPanelController;
    /**
     * Runs the self-close timer on by `deltaMs` of display time, then
     * re-derives the panel's rows, visibility and colours (every frame).
     */
    update(deltaMs: number): void;
    /** The rows as last drawn (the window hook reads them). */
    rows(): EscortPanelRow[];
    /** Takes the panel off the stage for good (plugin removal). */
    dispose(): void;
}
export const EscortPanelResource = new Resource<EscortPanelState>('EscortPanel');

/** Text of a category with no escorts. The doc says only "grey"; not
 * measured. */
const DISABLED_TEXT = 0x808080;
const TEXT = 0xffffff;
const FONT = { fontFamily: 'Geneva', fontSize: 10 } as const;
/** Inset of a row's text from the ends of its selection bar. */
const TEXT_INSET = 3;
/** The title's vertical centre (centred in the band above row 1). */
const TITLE_Y = 14;

/** The local player's DIRECT escorts in this display world: the ships its
 * orders reach (escort_command_plugin's escortParent). */
export function playerEscortEntries(world: World): EscortPanelEntry[] {
    let player: string | undefined;
    for (const [uuid, entity] of world.entities) {
        if (entity.components.has(PlayerShipSelector)) {
            player = uuid;
            break;
        }
    }
    if (player === undefined) {
        return [];
    }
    const gameData = world.resources.get(SimulationGameDataResource);
    const entries: EscortPanelEntry[] = [];
    for (const [, entity] of world.entities) {
        const command = entity.components.get(EscortCommandComponent);
        if (!command || escortParent(entity) !== player) {
            continue;
        }
        const shipId = entity.components.get(ShipComponent)?.id;
        const shipData = entity.components.get(ShipDataComponent)
            ?? (shipId ? gameData?.data.Ship.getCached(shipId) : undefined);
        entries.push({
            category: escortCategoryOf(shipData,
                entity.components.has(BayFighterComponent)),
            command: command.command,
        });
    }
    return entries;
}

class EscortPanelView {
    readonly container = new PIXI.Container();
    private readonly frame = new PIXI.Graphics();
    private readonly bar = new PIXI.Graphics();
    private readonly title = new PIXI.Text('', { ...FONT, fill: TEXT });
    private readonly labels: PIXI.Text[] = [];
    private readonly orders: PIXI.Text[] = [];
    private colors: InterfaceColorsData = getDefaultInterfaceColorsData();
    private drawn = '';

    constructor(onRowClicked: (row: number) => void) {
        this.container.name = 'EscortPanel';
        this.container.visible = false;
        this.container.addChild(this.frame, this.bar);
        this.title.anchor.set(0.5, 0.5);
        this.title.position.set(ESCORT_PANEL_SIZE.width / 2, TITLE_Y);
        this.container.addChild(this.title);
        for (let row = 0; row < ESCORT_PANEL_ROWS; row++) {
            const y = ESCORT_PANEL_BAR.y + row * ESCORT_PANEL_ROW_PITCH
                + ESCORT_PANEL_BAR.height / 2;
            const label = new PIXI.Text('', FONT);
            label.anchor.set(0, 0.5);
            label.position.set(ESCORT_PANEL_BAR.x + TEXT_INSET, y);
            const order = new PIXI.Text('', FONT);
            order.anchor.set(1, 0.5);
            order.position.set(ESCORT_PANEL_BAR.x + ESCORT_PANEL_BAR.width
                - TEXT_INSET, y);
            this.labels.push(label);
            this.orders.push(order);
            this.container.addChild(label, order);
        }
        // A click anywhere on the panel is a click on UI (tap targeting's
        // hit test), never on a ship behind it; a click on a row picks it.
        // Hovering does nothing.
        this.container.eventMode = 'static';
        this.container.hitArea = new PIXI.Rectangle(0, 0,
            ESCORT_PANEL_SIZE.width, ESCORT_PANEL_SIZE.height);
        this.container.on('pointerdown', event => {
            const local = this.container.toLocal(event.global);
            const row = Math.floor((local.y - ESCORT_PANEL_BAR.y
                + (ESCORT_PANEL_ROW_PITCH - ESCORT_PANEL_BAR.height) / 2)
                / ESCORT_PANEL_ROW_PITCH);
            if (local.y >= ESCORT_PANEL_BAR.y - 2 && row >= 0
                && row < ESCORT_PANEL_ROWS) {
                onRowClicked(row);
            }
        });
        this.drawFrame();
    }

    setColors(colors: InterfaceColorsData) {
        this.colors = colors;
        this.drawn = '';
        this.drawFrame();
    }

    setTitle(title: string) {
        this.title.text = title;
    }

    render(rows: readonly EscortPanelRow[], selectedRow: number) {
        // Text re-rasterises on change only; skip identical frames.
        const key = JSON.stringify([rows, selectedRow]);
        if (key === this.drawn) {
            return;
        }
        this.drawn = key;
        this.bar.clear();
        this.bar.beginFill(this.colors.escortHighlight);
        this.bar.drawRect(ESCORT_PANEL_BAR.x,
            ESCORT_PANEL_BAR.y + selectedRow * ESCORT_PANEL_ROW_PITCH,
            ESCORT_PANEL_BAR.width, ESCORT_PANEL_BAR.height);
        this.bar.endFill();
        for (const [i, row] of rows.entries()) {
            const fill = row.enabled ? TEXT : DISABLED_TEXT;
            this.labels[i].text = row.label;
            this.labels[i].style.fill = fill;
            this.orders[i].text = row.order;
            this.orders[i].style.fill = fill;
        }
    }

    private drawFrame() {
        // The outline only: the space view shows through.
        this.frame.clear();
        this.frame.lineStyle(1, this.colors.floatingMapBorder, 1, 0);
        this.frame.drawRect(0, 0, ESCORT_PANEL_SIZE.width,
            ESCORT_PANEL_SIZE.height);
    }

    destroy() {
        this.container.destroy({ children: true });
    }
}

/**
 * Keeps the panel drawn and placed, and its self-close timer running on
 * the display world's own clock (client-local UI; the simulation never
 * sees the panel). See EscortPanelState.update.
 */
const DrawEscortPanel = new System({
    name: 'DrawEscortPanel',
    args: [EscortPanelResource, TimeResource, SingletonComponent] as const,
    step(state, time) {
        state.update(time.delta_ms);
    },
});

export const EscortPanelPlugin: Plugin = {
    name: 'EscortPanelPlugin',
    build(world) {
        const stage = world.resources.get(Stage);
        if (!stage) {
            throw new Error('Expected Stage to exist');
        }
        const displayAssets = world.resources.get(DisplayAssetDataResource);

        const controller = new EscortPanelController({
            hasEscorts: () => playerEscortEntries(world).length > 0,
            message: text => showStatusMessage(world, text),
        });
        const view = new EscortPanelView(row => controller.selectRow(row));
        view.setTitle(controller.strings.title);
        view.container.position.set(ESCORT_PANEL_POSITION.x,
            ESCORT_PANEL_POSITION.y);
        stage.addChild(view.container);

        // The words (STR# 2002) and colours (cölr) come from the data; the
        // built-in stock values stand in until they load, or if they don't.
        void displayAssets?.data.StringTable.get(ESCORT_PANEL_STRING_TABLE)
            .then(table => {
                controller.strings = escortPanelStrings(table.strings);
                view.setTitle(controller.strings.title);
            }).catch(() => { /* Keep the stock wording. */ });
        void displayAssets?.data.InterfaceColors.get(INTERFACE_COLORS_ID)
            .then(colors => view.setColors(colors))
            .catch(() => { /* Keep the stock colours. */ });

        let rows: EscortPanelRow[] = [];
        world.resources.set(EscortPanelResource, {
            controller,
            rows: () => rows,
            dispose() {
                controller.close();
                stage.removeChild(view.container);
                view.destroy();
            },
            update(deltaMs) {
                // Landing removes the ship from the world; the panel goes
                // with it rather than reappearing over the next launch.
                if (world.resources.get(DockedShipResource)?.current) {
                    controller.close();
                }
                // 250 frames after it opened or a row was last selected,
                // it closes itself. The count also runs while the full
                // map hides it (not measured on the original).
                controller.advance(deltaMs);
                // A landed screen or the full map owns the screen and the
                // keyboard while it is up.
                view.container.visible = controller.open
                    && MenuControls.focused === undefined;
                if (!view.container.visible) {
                    return;
                }
                rows = escortPanelRows(playerEscortEntries(world),
                    controller.strings);
                view.render(rows, controller.selectedRow);
            },
        });
        world.addSystem(DrawEscortPanel);

        if (typeof window !== 'undefined') {
            window.novaEscortPanel = {
                get open() {
                    return controller.open;
                },
                get selectedRow() {
                    return controller.selectedRow;
                },
                get framesOpen() {
                    return controller.framesOpen;
                },
                rows: () => rows,
            };
        }
    },
    remove(world) {
        world.removeSystem(DrawEscortPanel);
        world.resources.get(EscortPanelResource)?.dispose();
        world.resources.delete(EscortPanelResource);
    },
};
