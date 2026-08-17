import { Entity } from 'nova_ecs/entity';
import { Plugin } from 'nova_ecs/plugin';
import { Query } from 'nova_ecs/query';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { EcsEvent } from 'nova_ecs/events';
import { Entities } from 'nova_ecs/arg_types';
import { Optional } from 'nova_ecs/optional';
import * as PIXI from 'pixi.js';
import { Observable } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { ControlAction } from '../nova_plugin/controls.js';
import { ControlEvent, ControlsSubject } from '../nova_plugin/controls_plugin.js';
import {
    BoardingComponent, BoardingState, capturable, captureChance,
} from '../nova_plugin/boarding_component.js';
import { CargoComponent } from '../nova_plugin/cargo_plugin.js';
import { FuelComponent } from '../nova_plugin/health_plugin.js';
import { PlayerShipSelector } from '../nova_plugin/player_ship_plugin.js';
import { ShipDataComponent } from '../nova_plugin/ship_plugin.js';
import { DisplayAssetDataResource } from '../nova_plugin/game_data_resource.js';
import { formatCredits } from './status_bar_content.js';
import { Button } from '../spaceport/button.js';
import {
    CAPTURE_FRAME, frameOrigin, PLUNDER_BUTTONS, PLUNDER_FRAME,
    PLUNDER_LINE_HEIGHT,
} from '../spaceport/hail_layout.js';
import { MenuControls } from '../spaceport/menu_controls.js';
import { ScreenSize } from './screen_size_plugin.js';
import { presentShipOffer } from './ship_mission_offer_plugin.js';
import { Stage } from './stage_resource.js';

/**
 * The plunder (PICT 8515) and capture-assignment (PICT 8516) dialogs.
 *
 * These are modal overlays that OPEN AND CLOSE by watching the synced
 * BoardingComponent on the local player's ship (BoardingUiSystem): the
 * simulation is the source of truth for whether a boarding is in
 * progress and what has already been taken, so the display can't own
 * that lifecycle with a promise the way the spaceport does. Every button
 * emits a PlunderActionEvent, which browser.ts forwards to the sim as a
 * control-event input (see the module docs in boarding_component.ts and
 * boarding_plugin.ts) — so the take/capture is replayed identically on
 * every peer, not applied locally.
 *
 * Layout is eyeballed against PICT 8515/8516 (capture_assignment.png);
 * pixel fidelity comes in the dedicated visual pass. Containers and
 * buttons are named for headless driving ('PlunderDialog',
 * 'CaptureAssignment', 'Button:Take Cargo', ...).
 */

/**
 * A plunder-dialog button press, forwarded by browser.ts to the sim as
 * a control-event input on the boarding ship.
 */
export const PlunderActionEvent =
    new EcsEvent<{ action: ControlAction }>('PlunderActionEvent');

// Geometry lives in spaceport/hail_layout.ts, measured off PICT 8515/8516's
// own art and space/board_ship.png (frame at screen 806,441) — see that file
// for the citations. The frame is 309x198, NOT the 320x200 this module used
// to assume, which pushed every element ~5px left and 1px up of the art.
const { x: ORIGIN_X, y: ORIGIN_Y } =
    frameOrigin(PLUNDER_FRAME.width, PLUNDER_FRAME.height);

/**
 * A Button's sprite starts at container.x + 0.2 (its 13px left cap is
 * anchored to END at button.ts's LEFT_POS = 13.2). hail_layout quotes the
 * measured SPRITE left edge, so placing one takes that back off.
 */
const BUTTON_CAP_INSET = 0.2;

/** Geneva 9.4 at the plunder readout's 14px pitch (PLUNDER_LINE_HEIGHT) —
 * the same bitmap face the comm dialogs and mission popups use. */
const TITLE_FONT: Partial<PIXI.ITextStyle> = {
    fontFamily: 'Geneva', fontSize: 9.4, fill: 0xffffff, align: 'left',
    wordWrap: false, lineHeight: PLUNDER_LINE_HEIGHT,
};
/** Row LABELS are dim in the references ("Cargo:", "Credits:"); the values
 * beside them are white. */
const LABEL_FONT: Partial<PIXI.ITextStyle> =
    { ...TITLE_FONT, fill: 0xa0a0a0 };
const BODY_FONT: Partial<PIXI.ITextStyle> = {
    ...TITLE_FONT, wordWrap: true,
    wordWrapWidth: PLUNDER_FRAME.well.width - 16,
};

const { x: CAP_ORIGIN_X, y: CAP_ORIGIN_Y } =
    frameOrigin(CAPTURE_FRAME.width, CAPTURE_FRAME.height);

/** Cargo / Credits / Ammo / Energy — the fixed four rows of the readout
 * table (space/board_ship.png). */
const PLUNDER_ROWS = 4;

/**
 * The plunder dialog's whole readable state — the booty summary lines and
 * which actions are actionable — derived from the SYNCED boarding state
 * and victim entity. Pure, and separated from the PIXI widget so the rules
 * can be pinned directly (the same split hail_dialog_plugin's
 * computeContext uses).
 *
 * ============================================================================
 * EVERY ROW IS DATA-DRIVEN (Matthew's ruling)
 * ============================================================================
 *
 * A row is live only when the victim actually HAS the thing it takes and
 * the boarder has not already taken it. There is no row whose enablement
 * is a constant, and none is inferred from the dialog's own history: each
 * one is a predicate over state the SIMULATION owns and the delta bridge
 * mirrors into this world —
 *
 *   Cargo    the victim's CargoComponent has tons left, and this session
 *            has not taken them (the sim empties the hold on the take, so
 *            the two agree even before the flag is read);
 *   Credits  the money booty frozen at board time is above zero;
 *   Ammo     the compatible rounds frozen at board time are above zero
 *            (the boarder must MOUNT a launcher for them — the sim's
 *            planAmmoPlunder decides, and the dialog only reads its sum);
 *   Energy   the victim's FuelComponent has fuel left;
 *   Capture  the contest is available: the victim is not being flown
 *            (`capturable`), no attempt has been made yet, and the
 *            boarder has crew to send (Bible, shïp Crew: "Ships with 0
 *            crew can't be boarded, nor can they capture any other
 *            ships").
 *
 * ONE ATTEMPT. `capture !== 'none'` greys the Capture row for good: the
 * player gets a single attempt per session, and a repelled one ends the
 * session outright (the dialog closes rather than sitting there with a
 * dead button). The 'failed' branch below is therefore a belt-and-braces
 * rendering of a state the sim clears on the same tick.
 *
 * Everything read here is simulation state — serializer-registered,
 * forwarded to this world by the bridge with every other synced
 * component, and not in PEER_LOCAL_COMPONENTS — so every peer looking at
 * the same victim greys the same buttons, off the SAME predicates the sim
 * consults: the dialog can never offer an action the simulation would
 * refuse. Where capture is impossible the odds readout goes with it
 * (there are no odds), replaced by a line saying why.
 */
/** One row of the plunder readout: a label/value pair, plus the optional
 * second pair the Energy row carries ("Capture Odds: 13%"). */
export interface PlunderRow {
    label: string;
    value: string;
    rightLabel?: string;
    rightValue?: string;
}

export function plunderDialogContent(boarding: BoardingState,
    target: Entity | undefined, playerCrew: number): {
        rows: PlunderRow[], notes: string[], lines: string[],
        enabledByAction: Record<string, boolean>
    } {
    const cargo = target?.components.get(CargoComponent);
    const cargoTons = cargo
        ? [...cargo.values()].reduce((a, b) => a + b, 0) : 0;
    const fuel = target?.components.get(FuelComponent);
    const targetCrew = target?.components.get(ShipDataComponent)?.crew ?? 0;
    // No capture is possible against a ship somebody is flying, and none
    // is possible with nobody to send across (Bible, shïp Crew).
    const captureBlocked = (target !== undefined && !capturable(target))
        || playerCrew <= 0;

    // Booty readout mirroring board_ship.png: Cargo / Credits / Ammo /
    // Energy, with capture odds inline. Cargo is summarised on one line
    // ("N tons of X" when a single commodity, else "N tons").
    const cargoKeys = cargo ? [...cargo.keys()].sort() : [];
    const cargoText = cargoTons <= 0 ? 'None'
        : cargoKeys.length === 1
            ? `${cargoTons} tons of ${cargoKeys[0]}`
            : `${cargoTons} tons`;
    const odds = boarding.capture === 'succeeded' || captureBlocked
        ? null : Math.round(captureChance(playerCrew, targetCrew) * 100);
    // The readout is a two-COLUMN table in the original (space/board_ship.png
    // sets the labels at frame x=11 and their values at x=61, with "Capture
    // Odds:" opening a second pair at x=131/207), not one space-padded string
    // — a proportional font never lines those up. `rows` carries the columns;
    // `lines` keeps the flat rendering for specs and for the notes below it.
    const rows: PlunderRow[] = [
        { label: 'Cargo:', value: cargoText },
        { label: 'Credits:', value: formatCredits(boarding.creditsAvailable) },
        {
            label: 'Ammo:',
            value: boarding.ammoAvailable > 0
                ? `${boarding.ammoAvailable}` : 'None',
        },
        {
            label: 'Energy:',
            value: `${fuel ? Math.floor(fuel.current) : 0}`,
            ...(odds === null ? {} : {
                rightLabel: 'Capture Odds:', rightValue: `${odds}%`,
            }),
        },
    ];
    const notes: string[] = [];
    if (target !== undefined && !capturable(target)) {
        notes.push('Her captain still holds the bridge: cannot capture.');
    } else if (playerCrew <= 0) {
        notes.push('You have no crew to send across: cannot capture.');
    } else if (boarding.capture === 'failed') {
        notes.push('You were repelled while attempting to capture!');
    }
    const lines = [
        ...rows.map(r => `${r.label}  ${r.value}`
            + (r.rightLabel ? `    ${r.rightLabel}  ${r.rightValue}` : '')),
        ...notes,
    ];

    return {
        rows, notes, lines,
        enabledByAction: {
            plunderCargo: !boarding.cargoTaken && cargoTons > 0,
            plunderCredits: !boarding.creditsTaken
                && boarding.creditsAvailable > 0,
            plunderFuel: !boarding.fuelTaken && !!fuel && fuel.current > 0,
            plunderAmmo: !boarding.ammoTaken && boarding.ammoAvailable > 0,
            // ONE attempt per session: any state but 'none' means it has
            // been used (see the module note).
            plunderCapture: boarding.capture === 'none' && !captureBlocked,
            plunderDone: true,
        },
    };
}

/** One selectable action row. */
interface Row {
    action: ControlAction;
    button: Button;
    /** Rendered width (pill + caps), for the selection highlight. */
    rendered: number;
    /** Whether the row is currently actionable (else greyed/skipped). */
    enabled: boolean;
}

class PlunderDialog {
    readonly container = new PIXI.Container();
    private controls: MenuControls;
    private title = new PIXI.Text('', TITLE_FONT);
    private body = new PIXI.Text('', BODY_FONT);
    private rows: Row[] = [];
    private selected = 0;
    private highlight = new PIXI.Graphics();
    /** The readout table's cells, one entry per PLUNDER_ROWS row. */
    private readout: {
        label: PIXI.Text, value: PIXI.Text,
        rightLabel: PIXI.Text, rightValue: PIXI.Text,
    }[] = [];

    constructor(private displayAssets: DisplayAssetDataInterface,
        controlEvents: Observable<ControlEvent>,
        private send: (action: ControlAction) => void) {
        this.container.name = 'PlunderDialog';
        this.container.visible = false;

        const shield = new PIXI.Graphics()
            .beginFill(0x000000, 0.001).drawRect(-4000, -4000, 8000, 8000)
            .endFill();
        shield.interactive = true;
        this.container.addChild(shield);

        // PICT 8515 is the plunder frame in stock Nova.
        const background = this.safeSprite(PLUNDER_FRAME.pict);
        // Top-left at the whole-pixel origin the original blits to (see
        // frameOrigin) rather than anchor-centred: 309 is odd, so centring
        // would land the art on a half pixel.
        background.anchor.set(0);
        background.position.set(ORIGIN_X, ORIGIN_Y);
        background.interactive = true;
        this.container.addChild(background);

        // The original's title line (space/board_ship.png), at the well's
        // measured pen.
        this.title.text = 'Select what to plunder from this ship:';
        this.title.position.set(ORIGIN_X + PLUNDER_FRAME.titleText.x,
            ORIGIN_Y + PLUNDER_FRAME.titleText.y);
        // The notes line ("cannot capture" / "you were repelled") sits under
        // the four-row table.
        this.body.position.set(ORIGIN_X + PLUNDER_FRAME.labelX,
            ORIGIN_Y + PLUNDER_FRAME.rowsTop
            + PLUNDER_ROWS * PLUNDER_LINE_HEIGHT);
        this.container.addChild(this.highlight, this.title, this.body);
        // Four label/value row pairs (plus the Energy row's second pair),
        // laid out in the two measured columns and filled by refresh().
        for (let i = 0; i < PLUNDER_ROWS; i++) {
            const y = ORIGIN_Y + PLUNDER_FRAME.rowsTop
                + i * PLUNDER_LINE_HEIGHT;
            const cells = {
                label: new PIXI.Text('', LABEL_FONT),
                value: new PIXI.Text('', TITLE_FONT),
                rightLabel: new PIXI.Text('', LABEL_FONT),
                rightValue: new PIXI.Text('', TITLE_FONT),
            };
            cells.label.position.set(ORIGIN_X + PLUNDER_FRAME.labelX, y);
            cells.value.position.set(ORIGIN_X + PLUNDER_FRAME.valueX, y);
            cells.rightLabel.position.set(
                ORIGIN_X + PLUNDER_FRAME.rightLabelX, y);
            cells.rightValue.position.set(
                ORIGIN_X + PLUNDER_FRAME.rightValueX, y);
            this.readout.push(cells);
            this.container.addChild(cells.label, cells.value,
                cells.rightLabel, cells.rightValue);
        }

        // Action grid mirroring the original 8515 button block: Energy /
        // Cargo / Ammo across the top, Credits + the wider Capture Ship below,
        // then a centered Abort. "Energy" is the victim's fuel transfer; the
        // labels, order, widths and positions are PLUNDER_BUTTONS, measured
        // by template-matching the cap sprites on board_ship.png.
        for (const spec of PLUNDER_BUTTONS) {
            const button = new Button(this.displayAssets, spec.label,
                spec.width, {
                    x: ORIGIN_X + spec.x - BUTTON_CAP_INSET,
                    y: ORIGIN_Y + spec.y,
                });
            const action = spec.action as ControlAction;
            button.click.subscribe(() => this.activate(action));
            this.container.addChild(button.container);
            this.rows.push({
                action, button, rendered: spec.width + 26, enabled: true,
            });
        }

        this.controls = new MenuControls(controlEvents, {
            up: () => this.move(-1),
            down: () => this.move(1),
            accept: () => this.activate(this.rows[this.selected]?.action),
            // Escape closes the session (same as Done). 'b' deliberately
            // does NOTHING here: the player spams 'b' while lining up the
            // approach, and the press that lands after the dialog opened
            // was closing it again before they could read it. The modal
            // MenuControls swallows the key so it can't reach the sim's
            // BoardingGateSystem either.
            depart: () => this.activate('plunderDone'),
        });
    }

    private safeSprite(id: string): PIXI.Sprite {
        try {
            return this.displayAssets.spriteFromPict(id);
        } catch {
            // Missing PICT: a plain dark panel keeps the flow driveable.
            const g = new PIXI.Graphics().beginFill(0x101820, 0.95)
                .lineStyle(1, 0x88aacc)
                .drawRect(ORIGIN_X, ORIGIN_Y, PLUNDER_FRAME.width,
                    PLUNDER_FRAME.height).endFill();
            const tex = new PIXI.Sprite();
            tex.addChild(g);
            return tex as unknown as PIXI.Sprite;
        }
    }

    private activate(action: ControlAction | undefined) {
        if (!action) {
            return;
        }
        const row = this.rows.find(r => r.action === action);
        if (row && !row.enabled) {
            return;
        }
        this.send(action);
    }

    private move(delta: number) {
        const enabledIndices = this.rows
            .map((r, i) => (r.enabled ? i : -1)).filter(i => i >= 0);
        if (enabledIndices.length === 0) {
            return;
        }
        const pos = enabledIndices.indexOf(this.selected);
        const next = pos < 0
            ? enabledIndices[0]
            : enabledIndices[(pos + delta + enabledIndices.length)
                % enabledIndices.length];
        this.selected = next;
        this.refreshHighlight();
    }

    open() {
        if (this.container.visible) {
            return;
        }
        this.container.visible = true;
        this.controls.bind();
    }

    close() {
        if (!this.container.visible) {
            return;
        }
        this.container.visible = false;
        this.controls.unbind();
    }

    /** Refreshes button enable/label state and the booty summary from
     * the synced boarding + victim state. `playerCrew` is the boarder's
     * crew, for the capture-odds readout. */
    refresh(boarding: BoardingState, target: Entity | undefined,
        playerCrew: number) {
        const { rows, notes, enabledByAction } =
            plunderDialogContent(boarding, target, playerCrew);
        this.readout.forEach((cells, i) => {
            const row = rows[i];
            cells.label.text = row?.label ?? '';
            cells.value.text = row?.value ?? '';
            cells.rightLabel.text = row?.rightLabel ?? '';
            cells.rightValue.text = row?.rightValue ?? '';
        });
        this.body.text = notes.join('\n');

        for (const row of this.rows) {
            row.enabled = enabledByAction[row.action] ?? true;
            if (row.button.state !== 'clicked') {
                row.button.state = row.enabled ? 'normal' : 'grey';
            }
        }
        if (!this.rows[this.selected]?.enabled) {
            this.move(1);
        }
        this.refreshHighlight();
    }

    private refreshHighlight() {
        this.highlight.clear();
        const row = this.rows[this.selected];
        if (!row || !row.enabled) {
            return;
        }
        const pos = row.button.container.position;
        this.highlight.beginFill(0x8b0000, 0.4)
            .drawRect(pos.x - 2, pos.y - 2, row.rendered + 4, 29).endFill();
    }
}

/** The capture-assignment dialog (PICT 8516): keep the captured ship as
 * an escort, or release it (Done). Bible alternatives (swap to it, sell
 * it) are seams that need the ship-swap / dock-sell paths. */
class CaptureAssignmentDialog {
    readonly container = new PIXI.Container();
    private controls: MenuControls;

    constructor(displayAssets: DisplayAssetDataInterface,
        controlEvents: Observable<ControlEvent>,
        send: (action: ControlAction) => void) {
        this.container.name = 'CaptureAssignment';
        this.container.visible = false;

        const shield = new PIXI.Graphics()
            .beginFill(0x000000, 0.001).drawRect(-4000, -4000, 8000, 8000)
            .endFill();
        shield.interactive = true;
        this.container.addChild(shield);

        let background: PIXI.Sprite;
        try {
            background = displayAssets.spriteFromPict(CAPTURE_FRAME.pict);
        } catch {
            const g = new PIXI.Graphics().beginFill(0x101820, 0.95)
                .lineStyle(1, 0x88aacc)
                .drawRect(CAP_ORIGIN_X, CAP_ORIGIN_Y,
                    CAPTURE_FRAME.width, CAPTURE_FRAME.height).endFill();
            background = new PIXI.Sprite();
            background.addChild(g);
        }
        background.anchor?.set(0);
        background.position.set(CAP_ORIGIN_X, CAP_ORIGIN_Y);
        background.interactive = true;
        this.container.addChild(background);

        // The question goes in the 8516 frame's own black well. The original
        // asks a longer question (escort vs. trading places with her captain)
        // and offers a third choice NovaJS does not model — see
        // CAPTURE_FRAME's note.
        const title = new PIXI.Text('You have captured the ship!', {
            ...TITLE_FONT, wordWrap: true,
            wordWrapWidth: CAPTURE_FRAME.well.width - 18,
        });
        title.position.set(CAP_ORIGIN_X + CAPTURE_FRAME.text.x,
            CAP_ORIGIN_Y + CAPTURE_FRAME.text.y);
        this.container.addChild(title);

        // Two pills centred in the frame at 120 wide with a 32px pitch, as
        // capture_assignment.png's inset shows them.
        const capButton = (label: string, row: number) =>
            new Button(displayAssets, label, CAPTURE_FRAME.buttonWidth, {
                x: CAP_ORIGIN_X + CAPTURE_FRAME.buttonX - BUTTON_CAP_INSET,
                y: CAP_ORIGIN_Y + CAPTURE_FRAME.buttonTop
                    + row * CAPTURE_FRAME.buttonPitch,
            });
        const escort = capButton('Keep as Escort', 0);
        escort.click.subscribe(() => send('plunderCaptureEscort'));
        const release = capButton('Release', 1);
        release.click.subscribe(() => send('plunderDone'));
        this.container.addChild(escort.container, release.container);

        this.controls = new MenuControls(controlEvents, {
            accept: () => send('plunderCaptureEscort'),
            depart: () => send('plunderDone'),
        });
    }

    open() {
        if (this.container.visible) {
            return;
        }
        this.container.visible = true;
        this.controls.bind();
    }

    close() {
        if (!this.container.visible) {
            return;
        }
        this.container.visible = false;
        this.controls.unbind();
    }
}

/**
 * Owns both dialogs and switches between them from the synced state.
 *
 * ============================================================================
 * THE BOARD-OFFERED MISSION COMES FIRST (përs Flags 0x0200)
 * ============================================================================
 *
 * A përs whose Flags 0x0200 is set offers "the ship's LinkMission when
 * boarding it instead of when hailing it" (EVN Bible). When the player
 * boards such a hull, the mission offer is shown BEFORE the plunder
 * dialog, and the plunder dialog is held closed until the player has
 * answered — which is both what the original does and what the stock text
 * requires. mïsn 134's offer opens "You match velocities with the derelict
 * ship and dock with it. Passing through the airlock you are surprised to
 * encounter the surviving crew of the vessel, who are overjoyed at their
 * rescue" — it is the boarding itself, and would read as nonsense after a
 * plunder screen. mïsn 133's does the same for the trap.
 *
 * ONE ATTEMPT PER SESSION. The presentation is async and the update system
 * is not, so the attempt is kicked off once per boarded target (`offered`)
 * and `holding` suppresses the plunder dialog meanwhile. If the offer turns
 * out not to apply — no përs, no mission, already taken — the promise
 * resolves false and the plunder dialog opens on the very next frame, so
 * an ordinary boarding is unaffected but for one frame of nothing.
 *
 * The plunder session itself is SIM state and keeps running throughout:
 * this only decides which dialog is on screen. A session that ends while
 * the offer is up (the target is destroyed, say) simply finds no plunder
 * dialog to close.
 */
class BoardingUi {
    readonly plunder: PlunderDialog;
    readonly assignment: CaptureAssignmentDialog;
    /** Targets a board-trigger offer has already been attempted for. */
    private offered = new Set<string>();
    /** The target whose offer popup is currently up, if any. */
    private holding?: string;

    constructor(displayAssets: DisplayAssetDataInterface,
        controlEvents: Observable<ControlEvent>,
        send: (action: ControlAction) => void,
        private screen: { x: number, y: number },
        /** Presents a boarding-triggered offer; the plugin wires this to
         * presentShipOffer. Omitted in specs that only drive the dialogs. */
        private offerMission?:
            (targetUuid: string) => Promise<boolean>) {
        this.plunder = new PlunderDialog(displayAssets, controlEvents, send);
        this.assignment =
            new CaptureAssignmentDialog(displayAssets, controlEvents, send);
    }

    reposition() {
        const x = this.screen.x / 2;
        const y = this.screen.y / 2;
        this.plunder.container.position.set(x, y);
        this.assignment.container.position.set(x, y);
    }

    update(boarding: BoardingState | undefined, target: Entity | undefined,
        playerCrew: number) {
        this.reposition();
        if (!boarding) {
            this.plunder.close();
            this.assignment.close();
            // A new session against the same hull can never happen (one
            // plunder per life segment), but the set is per-display-world
            // state and there is no reason to grow it across systems.
            this.offered.clear();
            this.holding = undefined;
            return;
        }
        if (this.offerMission && !this.offered.has(boarding.target)) {
            this.offered.add(boarding.target);
            this.holding = boarding.target;
            const uuid = boarding.target;
            void this.offerMission(uuid).catch(e => {
                console.warn('Board-offered mission failed:', e);
            }).finally(() => {
                if (this.holding === uuid) {
                    this.holding = undefined;
                }
            });
        }
        if (this.holding === boarding.target) {
            // The offer popup owns the screen (and the keyboard, through
            // its own MenuControls) until the player answers.
            this.plunder.close();
            this.assignment.close();
            return;
        }
        if (boarding.capture === 'succeeded') {
            this.plunder.close();
            this.assignment.open();
        } else {
            this.assignment.close();
            this.plunder.open();
            this.plunder.refresh(boarding, target, playerCrew);
        }
    }
}

const BoardingUiResource = new Resource<BoardingUi>('BoardingUi');

// Runs each frame for the local player's ship (PlayerShipSelector),
// opening/closing/refreshing the dialogs from its synced
// BoardingComponent. Optional so it still runs (to close the dialogs)
// when no boarding is in progress.
const PlayerBoardingQuery = new Query(
    [PlayerShipSelector, Optional(BoardingComponent),
        Optional(ShipDataComponent)] as const);
const BoardingUiSystem = new System({
    name: 'BoardingUiSystem',
    args: [BoardingUiResource, PlayerBoardingQuery, Entities] as const,
    step(ui, players, entities) {
        const boarding = players[0]?.[1] ?? undefined;
        const playerCrew = players[0]?.[2]?.crew ?? 0;
        const target = boarding
            ? entities.get(boarding.target) : undefined;
        ui.update(boarding ?? undefined, target, playerCrew);
    },
});

export const BoardingDisplayPlugin: Plugin = {
    name: 'BoardingDisplayPlugin',
    build(world) {
        const displayAssets = world.resources.get(DisplayAssetDataResource);
        const controls = world.resources.get(ControlsSubject);
        const stage = world.resources.get(Stage);
        const screen = world.resources.get(ScreenSize);
        if (!displayAssets || !controls || !stage || !screen) {
            throw new Error('BoardingDisplayPlugin missing display resources');
        }
        const send = (action: ControlAction) =>
            world.emit(PlunderActionEvent, { action });
        const ui = new BoardingUi(displayAssets, controls, send, screen,
            // përs Flags 0x0200: the boarding trigger for a ship-offered
            // mission. A no-op for every hull that isn't such a përs.
            targetUuid => presentShipOffer(world, targetUuid, 'board'));
        stage.addChild(ui.plunder.container);
        stage.addChild(ui.assignment.container);
        world.resources.set(BoardingUiResource, ui);
        world.addSystem(BoardingUiSystem);
    },
    remove(world) {
        world.removeSystem(BoardingUiSystem);
        const stage = world.resources.get(Stage);
        const ui = world.resources.get(BoardingUiResource);
        if (stage && ui) {
            stage.removeChild(ui.plunder.container);
            stage.removeChild(ui.assignment.container);
        }
        world.resources.delete(BoardingUiResource);
    },
};
