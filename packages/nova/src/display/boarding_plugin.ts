import { Entity } from 'nova_ecs/entity';
import { Plugin } from 'nova_ecs/plugin';
import { SingletonComponent, World } from 'nova_ecs/world';
import { Query } from 'nova_ecs/query';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { EcsEvent } from 'nova_ecs/events';
import { Entities, UUID } from 'nova_ecs/arg_types';
import { Optional } from 'nova_ecs/optional';
import * as PIXI from 'pixi.js';
import { Observable } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import {
    ControlAction, ControlEvent, ControlsSubject, DisplayAssetDataResource,
    SimulationGameDataResource,
} from '../nova_plugin/core/index.js';
import {
    BoardingComponent, BoardingGovtLookup, BoardingState, capturable,
    CargoComponent, FuelComponent, isDerelict,
    ShipDataComponent,
} from '../nova_plugin/ship/index.js';
import {
    cappedEscortCount, MAX_ESCORTS, MAX_ESCORTS_MESSAGE,
} from '../nova_plugin/escorts/index.js';
import { PlayerShipSelector } from '../nova_plugin/player/index.js';
import { CapturedShip } from '../nova_plugin/encounters/index.js';
import { ShipComponent } from '../nova_plugin/ship/index.js';
import { SystemIdResource } from '../nova_plugin/core/index.js';
import { MissionUniverse } from '../spaceport/mission_universe.js';
import { buildCaptureSetStrings } from '../spaceport/ship_mission_accept.js';
import {
    CAPTURED_SHIP_NAME_PROMPT_INDEX, CAPTURED_SHIP_NAME_PROMPT_TEXT,
    CapturedShipNamePrompt,
} from '../spaceport/ship_name_prompt.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { STANDARD_CARGO_NAMES } from '../nova_plugin/missions/index.js';
import { formatCredits, standardCargoIndex } from './status_bar_content.js';
import { Button } from '../spaceport/button.js';
import {
    CAPTURE_FRAME, frameOrigin, PLUNDER_BUTTONS, PLUNDER_FRAME,
    PLUNDER_LINE_HEIGHT,
} from '../spaceport/hail_layout.js';
import { MenuControls } from '../spaceport/menu_controls.js';
import {
    boardShipDoneStatusOf, presentBoardShipDone, ShipDoneBoardStatus,
} from './mission_ship_done_plugin.js';
import { ScreenSize, screenCentre } from './screen_size_plugin.js';
import { presentShipOffer } from './ship_mission_offer_plugin.js';
import { Stage } from './stage_resource.js';
import { SpaceportAmbientSystem } from "./spaceport_plugin.js";

/**
 * How long the plunder dialog is held back waiting for the simulation to
 * settle a board/rescue goal ('missionWait'). The answer normally arrives
 * within a frame or two — the credit and the boarding session are written
 * by systems in the same simulation tick — so this is a ceiling, not a
 * delay: about a second at 60fps, after which the ordinary plunder dialog
 * opens.
 */
const SHIP_DONE_WAIT_FRAMES = 60;

/**
 * The plunder dialog (PICT 8515) and the capture prompt laid over it (PICT
 * 8516, scaled).
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
 * Layout is measured off space/board_ship.png and capture_assignment.png
 * (spaceport/hail_layout.ts PLUNDER_FRAME / CAPTURE_FRAME). Containers and
 * buttons are named for headless driving ('PlunderDialog',
 * 'CaptureAssignment', 'Button:Take Cargo', ...).
 */

/**
 * A plunder-dialog button press, forwarded by browser.ts to the sim as
 * a control-event input on the boarding ship.
 */
export const PlunderActionEvent =
    new EcsEvent<{ action: ControlAction }>('PlunderActionEvent');

/**
 * The capture prompt's "Use As My Ship", answered: the rename prompt's name
 * and the swap's set strings resolved (encounters/boarding_plugin.ts
 * CapturedShipType), forwarded by game_session.ts to the sim as a
 * `captureShip` input record.
 */
export const CaptureShipEvent =
    new EcsEvent<{ capture: CapturedShip }>('CaptureShipEvent');

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
 *            (`capturable`), no attempt has been made yet, the
 *            boarder has crew to send (Bible, shïp Crew: "Ships with 0
 *            crew can't be boarded, nor can they capture any other
 *            ships"), and the player is UNDER THE ESCORT CAP (ruling
 *            #250: at MAX_ESCORTS hired-or-captured escorts the option
 *            is greyed, not refused on press — escort_cap.ts's count
 *            over the display world, which carries the synced
 *            PlayerEscort / BayFighter / MissionShip markers).
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

/**
 * The name the plunder readout shows for one CargoComponent key. The
 * keys are internal ("cargo:<0-5>", "junk:<globalID>", "mission:<id>";
 * cargo_plugin.ts) and used to be printed verbatim — "12 tons of
 * cargo:3". Standard commodities read from the STR# 4000 names the
 * status bar uses; a jünk commodity reads its full jünk name (the status
 * bar abbreviates; a sentence does not need to) once its data is cached,
 * and mission freight is just "mission cargo".
 */
export function cargoKeyDisplayName(key: string,
    gameData?: SimulationGameDataInterface): string {
    const stdIndex = standardCargoIndex(key);
    if (stdIndex !== null) {
        return STANDARD_CARGO_NAMES[stdIndex] ?? `Cargo ${stdIndex}`;
    }
    if (key.startsWith('junk:')) {
        const junk = gameData?.data.Junk.getCached(key.slice(5));
        return junk?.name || 'cargo';
    }
    if (key.startsWith('mission:')) {
        return 'mission cargo';
    }
    return key;
}

export function plunderDialogContent(boarding: BoardingState,
    target: Entity | undefined, playerCrew: number,
    cargoName: (key: string) => string = key => cargoKeyDisplayName(key),
    /** Whether the player already has MAX_ESCORTS hired-or-captured
     * escorts (escort_cap.ts), in which case Capture is greyed (#250). */
    atEscortCap = false,
    /** Government data by id, for the derelict rule (isDerelict). */
    lookupGovt: BoardingGovtLookup = () => undefined): {
        rows: PlunderRow[], notes: string[], lines: string[],
        enabledByAction: Record<string, boolean>
    } {
    const cargo = target?.components.get(CargoComponent);
    const cargoTons = cargo
        ? [...cargo.values()].reduce((a, b) => a + b, 0) : 0;
    const fuel = target?.components.get(FuelComponent);
    // No capture is possible against a ship somebody is flying or a
    // derelict (ruling #378), none is possible with nobody to send across
    // (Bible, shïp Crew), and none at the escort cap (ruling #250).
    const captureBlocked =
        (target !== undefined && !capturable(target, lookupGovt))
        || playerCrew <= 0 || atEscortCap;
    // A DERELICT reads "Capture Odds: 0%" beside the greyed button, as the
    // original shows it on every derelict board (boarding_component.ts,
    // isDerelict); the other blocked cases drop the odds and say why.
    const derelict = target !== undefined && isDerelict(target, lookupGovt);

    // Booty readout mirroring board_ship.png: Cargo / Credits / Ammo /
    // Energy, with capture odds inline. Cargo is summarised on one line
    // ("N tons of X" when a single commodity, else "N tons").
    const cargoKeys = cargo ? [...cargo.keys()].sort() : [];
    const cargoText = cargoTons <= 0 ? 'None'
        : cargoKeys.length === 1
            ? `${cargoTons} tons of ${cargoName(cargoKeys[0])}`
            : `${cargoTons} tons`;
    const odds = derelict && boarding.capture !== 'succeeded' ? 0
        : boarding.capture === 'succeeded' || captureBlocked ? null
            // This board's odds, drawn as the session opened: the very
            // number the simulation rolls the capture against.
            : boarding.captureOdds;
    // The readout is a two-COLUMN table in the original (space/board_ship.png
    // sets the labels at frame x=11 and their values at x=61, with "Capture
    // Odds:" opening a second pair at x=131/207), not one space-padded string
    // — a proportional font never lines those up. `rows` carries the columns;
    // `lines` keeps the flat rendering for specs and for the notes below it.
    const rows: PlunderRow[] = [
        { label: 'Cargo:', value: cargoText },
        // Once taken, a row reads 'None' (Matthew, 2026-11-23: the money
        // still showed after Credits had been taken).
        {
            label: 'Credits:',
            value: !boarding.creditsTaken && boarding.creditsAvailable > 0
                ? formatCredits(boarding.creditsAvailable) : 'None',
        },
        {
            label: 'Ammo:',
            value: !boarding.ammoTaken && boarding.ammoAvailable > 0
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
    if (derelict) {
        // The original says nothing: 0% and a grey button.
    } else if (target !== undefined && !capturable(target, lookupGovt)) {
        notes.push('Her captain still holds the bridge: cannot capture.');
    } else if (playerCrew <= 0) {
        notes.push('You have no crew to send across: cannot capture.');
    } else if (atEscortCap && boarding.capture === 'none') {
        // Why Capture is grey at the escort cap (rulings #161 / #250):
        // the same STR# 2002 #123 line the bar's hire dialog gives, off
        // the same constant. A note beside a greyed button, not a refusal
        // — nothing is pressed to see it, and nothing happens on a press.
        notes.push(MAX_ESCORTS_MESSAGE);
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

/**
 * Which of the boarding dialogs owns the screen.
 *
 *  'none'       no session — nothing is up.
 *  'offer'      a board-triggered mission offer (përs Flags 0x0200) or a
 *               mission's ShipDoneText is being read; it comes FIRST and
 *               holds the others back, because those texts ARE the
 *               boarding narration.
 *  'offerOnly'  that text has been read, and it was the WHOLE boarding:
 *               nothing else is shown and the session is ended (see
 *               below).
 *  'capture'    the ship was taken; the capture prompt is up, over the
 *               plunder dialog.
 *  'missionWait' the boarded hull is one of the local player's own
 *               board/rescue special ships and the simulation has not yet
 *               said what the boarding did to the goal. Nothing is shown
 *               for those few frames, so the plunder table cannot flash
 *               up and be replaced by the mission's ShipDoneText (see
 *               display/mission_ship_done_plugin.ts).
 *  'plunder'    the ordinary case.
 *
 * ============================================================================
 * THE OFFER REPLACES THE PLUNDER DIALOG — IT DOES NOT PRECEDE IT
 * ============================================================================
 * (Matthew's ruling, authoritative)
 *
 * Boarding a ship that offers a mission shows the mission text and that is
 * the end of the boarding: no plunder screen, no capture screen, whether
 * the player accepted or refused. mïsn 134's offer opens "You match
 * velocities with the derelict ship and dock with it. Passing through the
 * airlock you are surprised to encounter the surviving crew of the vessel,
 * who are overjoyed at their rescue" — that IS the boarding, start to
 * finish, and a plunder table sliding up behind it reads as nonsense
 * (rob the people you just rescued?). mïsn 133's trap does the same.
 *
 * This used to render 'plunder' the moment the offer resolved. It now
 * ends the session instead, and the sim hands the hulk's one plunder back
 * (see boarding_plugin's endBoardingForOffer), so the derelict is still
 * robbable on a LATER boarding once its offer has been taken and there is
 * no mission left to show. An ordinary hulk — no përs, no mission, offer
 * already spent — never reaches 'offerOnly' at all: presentShipOffer
 * resolves false and the very next frame renders 'plunder' as before.
 *
 * Pure, so the ordering is pinned without a PIXI stage — the same split
 * plunderDialogContent uses for the dialog's rules.
 */
export type BoardingDialogPhase =
    'none' | 'offer' | 'offerOnly' | 'capture' | 'missionWait' | 'plunder';

export function boardingDialogPhase(boarding: BoardingState | undefined,
    /** A mission text for THIS boarding is on screen (a përs offer, or a
     * mission's ShipDoneText). */
    offering: boolean,
    /** A mission text for THIS boarding has been shown and dismissed. */
    offerMade = false,
    /** The boarded hull is one of the local player's own board/rescue
     * special ships and the goal outcome has not arrived yet. */
    settling = false): BoardingDialogPhase {
    if (!boarding) {
        return 'none';
    }
    if (offering) {
        return 'offer';
    }
    if (offerMade) {
        return 'offerOnly';
    }
    if (boarding.capture === 'succeeded') {
        return 'capture';
    }
    // After the capture check: a captured mission ship stops being one
    // (convertToEscort drops its MissionShipComponent), so the prize
    // dialog must not be held behind a goal that no longer exists.
    return settling ? 'missionWait' : 'plunder';
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
    /** Resolves a cargo key to the name the readout shows (see
     * cargoKeyDisplayName); the plugin points it at the game data. */
    cargoName: (key: string) => string = key => cargoKeyDisplayName(key);
    /** Government data by id, for the derelict capture rule; the plugin
     * points it at the game data. */
    lookupGovt: BoardingGovtLookup = () => undefined;

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
            return tex;
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
     * crew (none: no capture); `atEscortCap` greys Capture. */
    refresh(boarding: BoardingState, target: Entity | undefined,
        playerCrew: number, atEscortCap: boolean) {
        const { rows, notes, enabledByAction } = plunderDialogContent(
            boarding, target, playerCrew, this.cargoName, atEscortCap,
            this.lookupGovt);
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

/** The capture prompt's question: stock STR# 2002 0-based 117, verbatim. The
 * dialog reads it out of the game data and keeps this as the fallback. */
export const CAPTURE_PROMPT_TEXT = 'Do you want to use this ship as an '
    + 'escort, or would you rather trade places with its captain and use it '
    + 'as your own ship?';
export const CAPTURE_PROMPT_STRING_TABLE = 'nova:2002';
export const CAPTURE_PROMPT_INDEX = 117;

/** The capture prompt's two answers. */
export type CaptureAnswer = 'ship' | 'escort';

/**
 * The capture prompt's two answers, top to bottom, as the original stacks
 * them (space/capture_assignment.png): Use As My Ship over Use As Escort.
 * There is no third (NovaJS used to offer a "Release" the original does
 * not have). The prompt only ever appears below the escort cap: at the cap
 * the plunder dialog greys Capture Ship (reference "Capture, wave 33",
 * finding 7), so no capture can succeed there.
 *
 * Both answers send a `captureShip` record (CaptureShipEvent) carrying the
 * prize class's OnCapture deltas: Use As Escort at once (`escort: true`,
 * useCapturedShipAsEscort), Use As My Ship after asking for the new hull's
 * name (BoardingUi's rename) and with the old class's OnRetire too. Cancel
 * on that rename ABANDONS the capture instead: 'plunderDone' ends the
 * session with nothing changed (useCapturedShip).
 */
export const CAPTURE_PROMPT_BUTTONS: readonly {
    label: string, answer: CaptureAnswer,
}[] = [
    { label: 'Use As My Ship', answer: 'ship' },
    { label: 'Use As Escort', answer: 'escort' },
];

/**
 * The capture prompt (PICT 8516 scaled into CAPTURE_FRAME's 257x114 rect),
 * laid over the still-open plunder dialog (BoardingUi's 'capture' phase
 * keeps it up underneath, as the original does). Its full-screen shield
 * keeps the plunder buttons behind it from being clicked, and its
 * MenuControls, bound on top of the plunder dialog's, take the keyboard.
 *
 * KEYS: the buttons' letters, `m` = Use As My Ship and `e` = Use As
 * Escort (MEASURED, reference "The capture prompt's keys and the rename
 * alert's Cancel (CU leftover), wave 46", finding 1). Return, `u` (wave
 * 45, finding 8) and `a` (wave 46) do nothing, and nor does Escape, so the
 * prompt is only ever closed by one of its two answers. The letters ride
 * the 'map' and 'escorts' actions (settings/controls.json KeyM / KeyE),
 * which the in-flight map and escort panel already give up while a menu
 * owns the keyboard.
 */
export class CaptureAssignmentDialog {
    readonly container = new PIXI.Container();
    private controls: MenuControls;
    private question = new PIXI.Text(CAPTURE_PROMPT_TEXT, {
        ...TITLE_FONT, wordWrap: true,
        wordWrapWidth: CAPTURE_FRAME.textWrapWidth,
        lineHeight: CAPTURE_FRAME.lineHeight,
    });

    constructor(private displayAssets: DisplayAssetDataInterface,
        controlEvents: Observable<ControlEvent>,
        answer: (answer: CaptureAnswer) => void) {
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
            // Scaled, nearest-neighbour, into the measured rect (see
            // CAPTURE_FRAME): the original draws the 267x128 art into
            // 257x114.
            background.texture.baseTexture.scaleMode =
                PIXI.SCALE_MODES.NEAREST;
            // As a scale, not a width: the texture may still be loading.
            background.scale.set(
                CAPTURE_FRAME.width / CAPTURE_FRAME.artWidth,
                CAPTURE_FRAME.height / CAPTURE_FRAME.artHeight);
        } catch {
            const g = new PIXI.Graphics().beginFill(0x101820, 0.95)
                .lineStyle(1, 0x88aacc)
                .drawRect(0, 0, CAPTURE_FRAME.width, CAPTURE_FRAME.height)
                .endFill();
            background = new PIXI.Sprite();
            background.addChild(g);
        }
        background.anchor?.set(0);
        background.position.set(CAP_ORIGIN_X, CAP_ORIGIN_Y);
        background.interactive = true;
        this.container.addChild(background);

        this.question.name = 'CapturePromptText';
        this.question.position.set(CAP_ORIGIN_X + CAPTURE_FRAME.text.x,
            CAP_ORIGIN_Y + CAPTURE_FRAME.text.y);
        this.container.addChild(this.question);

        CAPTURE_PROMPT_BUTTONS.forEach(({ label, answer: which }, row) => {
            const button = new Button(displayAssets, label,
                CAPTURE_FRAME.buttonWidth, {
                    x: CAP_ORIGIN_X + CAPTURE_FRAME.buttonX - BUTTON_CAP_INSET,
                    y: CAP_ORIGIN_Y + CAPTURE_FRAME.buttonTop
                        + row * CAPTURE_FRAME.buttonPitch,
                });
            button.click.subscribe(() => answer(which));
            this.container.addChild(button.container);
        });

        this.controls = new MenuControls(controlEvents, {
            map: () => answer('ship'),
            escorts: () => answer('escort'),
        });
        void this.loadQuestion();
    }

    /** The question out of STR# 2002, keeping the built-in wording when the
     * data set has none (the mission board's pattern). */
    private async loadQuestion() {
        try {
            const table = await this.displayAssets.data.StringTable
                .get(CAPTURE_PROMPT_STRING_TABLE);
            const text = table.strings[CAPTURE_PROMPT_INDEX];
            if (text?.trim() && !this.question.destroyed) {
                this.question.text = text;
            }
        } catch {
            // Keep the built-in wording.
        }
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
 * THE BOARD-OFFERED MISSION IS THE WHOLE BOARDING (përs Flags 0x0200)
 * ============================================================================
 *
 * A përs whose Flags 0x0200 is set offers "the ship's LinkMission when
 * boarding it instead of when hailing it" (EVN Bible). When the player
 * boards such a hull the mission offer is shown INSTEAD OF the plunder
 * dialog, and once it is answered the boarding is over — see
 * boardingDialogPhase for the ruling and the stock text that demands it.
 *
 * ONE ATTEMPT PER SESSION. The presentation is async and the update system
 * is not, so the attempt is kicked off once per boarded target (`offered`)
 * and `holding` suppresses the plunder dialog meanwhile. If the offer turns
 * out not to apply — no përs, no mission, already taken — the promise
 * resolves false and the plunder dialog opens on the very next frame, so
 * an ordinary boarding is unaffected but for one frame of nothing. If it
 * DID apply, `made` remembers so, and the session is closed out through
 * the sim (once, guarded by `ended`) rather than falling through to the
 * plunder dialog.
 *
 * The plunder session itself is SIM state and keeps running throughout:
 * this only decides which dialog is on screen and, in the offer case, asks
 * the simulation to end the session. A session that ends while the offer
 * is up (the target is destroyed, say) simply finds no plunder dialog to
 * close, and the 'plunderOfferOnly' edge is idempotent — the sim's action
 * system ends an already-ended session by deleting a component that is
 * already gone.
 *
 * ============================================================================
 * A BOARDING THAT COMPLETES A MISSION'S SHIP GOAL (mïsn ShipGoal 2 / 5)
 * ============================================================================
 *
 * The second thing a boarding can BE, rather than precede. When the hull
 * is one of the local player's own special ships and boarding it completes
 * the mission's ship goal, the mission's ShipDoneText is what the original
 * shows — at that moment, in space (EVN Bible: "the desc to show when you
 * complete the special ship goal"). It rides this same one-text-and-done
 * path: `shipDone.status` is consulted every frame while the session is
 * open, the plunder dialog is held back ('missionWait') until the
 * simulation says what the boarding did to the goal, and when it says
 * "complete" the text is presented on the shared popup and the boarding
 * ends with it, through the very same 'plunderOfferOnly' action.
 *
 * THAT ACTION IS SAFE HERE, and deliberately so: endBoardingForOffer hands
 * the hulk's plunder back only for a hull carrying a PersComponent, which
 * a mission special ship never does (mission_ship_spawn stamps
 * MissionShipComponent instead), so for these hulls it is an ordinary
 * session end. That matters — the goal credit READS the `plundered`
 * record, so handing it back would un-credit the boarding that just
 * completed the goal.
 *
 * A hull with neither a përs offer nor a completing goal reaches neither
 * path and gets the plunder dialog exactly as before.
 */
class BoardingUi {
    readonly plunder: PlunderDialog;
    readonly assignment: CaptureAssignmentDialog;
    /** Targets a board-trigger offer has already been attempted for. */
    private offered = new Set<string>();
    /** The target whose offer popup is currently up, if any. */
    private holding?: string;
    /** Targets whose offer was actually MADE (and answered): the boarding
     * is over for them, and no plunder dialog is owed. */
    private made = new Set<string>();
    /** Targets whose session we have already asked the sim to end. */
    private ended = new Set<string>();
    /** Targets a ShipDoneText presentation has been started for. */
    private shipDoneTried = new Set<string>();
    /** Frames spent holding the plunder dialog back waiting for the sim
     * to settle a board/rescue goal (see SHIP_DONE_WAIT_FRAMES). */
    private settleFrames = 0;
    /** The target of the session on screen (the capture prompt's answers
     * name no target of their own). */
    private current?: string;
    /** The target whose "Use As My Ship" rename prompt is up, or whose
     * "Use As Escort" set strings are being resolved. */
    private renaming?: string;
    /** Targets an answer has been SENT for: the capture prompt stays down
     * while the record makes its way to the sim and back. */
    private tradedFor = new Set<string>();

    constructor(displayAssets: DisplayAssetDataInterface,
        controlEvents: Observable<ControlEvent>,
        private send: (action: ControlAction) => void,
        private screen: { x: number, y: number },
        /** Presents a boarding-triggered offer; the plugin wires this to
         * presentShipOffer. Omitted in specs that only drive the dialogs. */
        private offerMission?:
            (targetUuid: string) => Promise<boolean>,
        /** The mission ShipDoneText half (see the class note); the plugin
         * wires it to mission_ship_done_plugin. Omitted in specs that
         * only drive the dialogs. */
        private shipDone?: {
            status: (targetUuid: string) => ShipDoneBoardStatus,
            present: (targetUuid: string) => Promise<boolean>,
        },
        /** "Use As My Ship": asks for the new hull's name and sends the
         * `captureShip` record (or, on Cancel, abandons the capture),
         * resolving whether anything was sent; `dismiss`
         * takes a rename prompt down when the session ends under it;
         * `escort` is "Use As Escort", which sends the record at once. The
         * plugin wires them to useCapturedShip / useCapturedShipAsEscort.
         * Omitted in specs that only drive the dialogs. */
        private useAsShip?: {
            ask: (targetUuid: string) => Promise<boolean>,
            dismiss: () => void,
            escort: (targetUuid: string) => Promise<boolean>,
        }) {
        this.plunder = new PlunderDialog(displayAssets, controlEvents, send);
        this.assignment = new CaptureAssignmentDialog(displayAssets,
            controlEvents, answer => this.answerCapture(answer));
    }

    /**
     * The capture prompt's answer. Both take the prompt down: Use As My
     * Ship runs the rename (the original shows the rename alert over the
     * plunder dialog alone, 63-use1.png), Use As Escort only resolves the
     * prize class's OnCapture. The prompt stays down while the record is
     * on its way, and comes back only if the answer was not sent after
     * all.
     */
    private answerCapture(answer: CaptureAnswer) {
        const target = this.current;
        if (!this.useAsShip || target === undefined
            || this.renaming !== undefined || this.tradedFor.has(target)) {
            return;
        }
        this.renaming = target;
        this.assignment.close();
        const sending = answer === 'escort'
            ? this.useAsShip.escort(target) : this.useAsShip.ask(target);
        void sending.then(sent => {
            if (sent) {
                this.tradedFor.add(target);
            }
        }).catch(e => {
            console.warn(answer === 'escort' ? 'Use As Escort failed:'
                : 'Use As My Ship failed:', e);
        }).finally(() => {
            if (this.renaming === target) {
                this.renaming = undefined;
            }
        });
    }

    reposition() {
        const { x, y } = screenCentre(this.screen);
        this.plunder.container.position.set(x, y);
        this.assignment.container.position.set(x, y);
    }

    update(boarding: BoardingState | undefined, target: Entity | undefined,
        playerCrew: number, atEscortCap = false) {
        // Fast idle path: when no boarding session is active and no dialog or
        // capture state is open, skip repositioning and closing every frame.
        if (!boarding && this.current === undefined && this.holding === undefined
            && this.renaming === undefined && this.offered.size === 0
            && this.made.size === 0 && this.ended.size === 0
            && this.shipDoneTried.size === 0 && this.tradedFor.size === 0
            && this.settleFrames === 0
            && !this.plunder.container.visible
            && !this.assignment.container.visible) {
            return;
        }
        this.reposition();
        this.current = boarding?.target;
        if (boarding && this.offerMission
            && !this.offered.has(boarding.target)) {
            this.offered.add(boarding.target);
            this.holding = boarding.target;
            const uuid = boarding.target;
            void this.offerMission(uuid).then(offered => {
                if (offered) {
                    // An offer was really made and answered, so this
                    // boarding is finished (see the class note).
                    this.made.add(uuid);
                }
            }).catch(e => {
                console.warn('Board-offered mission failed:', e);
            }).finally(() => {
                if (this.holding === uuid) {
                    this.holding = undefined;
                }
            });
        }
        // The mission-goal text, once the përs offer has had its turn
        // (they are mutually exclusive: `holding` covers the frames the
        // offer promise is in flight, and a hull that offered one is
        // finished with by `made`).
        let settling = false;
        if (boarding && this.shipDone
            && this.holding !== boarding.target
            && !this.made.has(boarding.target)
            && !this.shipDoneTried.has(boarding.target)) {
            const uuid = boarding.target;
            const status = this.shipDone.status(uuid);
            if (status === 'show') {
                this.shipDoneTried.add(uuid);
                this.holding = uuid;
                void this.shipDone.present(uuid).then(shown => {
                    if (shown) {
                        // Shown and dismissed: that was the boarding.
                        this.made.add(uuid);
                    }
                }).catch(e => {
                    console.warn('Mission ship-done text failed:', e);
                }).finally(() => {
                    if (this.holding === uuid) {
                        this.holding = undefined;
                    }
                });
            } else if (status === 'wait') {
                // Bounded: if the answer never comes (a mission ship the
                // simulation stopped tracking, say), fall through to the
                // ordinary plunder dialog rather than showing nothing for
                // the rest of the session.
                this.settleFrames++;
                settling = this.settleFrames <= SHIP_DONE_WAIT_FRAMES;
            }
        }
        const phase = boardingDialogPhase(boarding,
            !!boarding && this.holding === boarding.target,
            !!boarding && this.made.has(boarding.target),
            settling);
        switch (phase) {
            case 'none':
                this.plunder.close();
                this.assignment.close();
                // A new session against the same hull is possible again
                // once the offer is spent (the sim hands the plunder
                // back), and these are per-display-world sets anyway, so
                // there is no reason to grow them across sessions.
                this.offered.clear();
                this.made.clear();
                this.ended.clear();
                this.shipDoneTried.clear();
                this.settleFrames = 0;
                this.holding = undefined;
                this.tradedFor.clear();
                // The session ended under a rename prompt (the prize
                // destroyed, say): nothing is left to rename.
                if (this.renaming !== undefined) {
                    this.useAsShip?.dismiss();
                }
                return;
            case 'offer':
                // The offer popup owns the screen (and the keyboard,
                // through its own MenuControls) until it is answered.
                this.plunder.close();
                this.assignment.close();
                return;
            case 'offerOnly':
                // Answered, and that was the whole boarding: nothing else
                // is shown, and the session is ended sim-side. Sent ONCE
                // per target — `update` runs every frame and the synced
                // BoardingComponent takes a bridge round trip to
                // disappear, so without the guard this would spam the
                // input path for as long as that takes.
                this.plunder.close();
                this.assignment.close();
                if (!this.ended.has(boarding!.target)) {
                    this.ended.add(boarding!.target);
                    this.send('plunderOfferOnly');
                }
                return;
            case 'capture':
                // The prompt is laid OVER the plunder dialog, which stays
                // up (and current) beneath it, as in the original
                // (space/capture_assignment.png). Opened first, so the
                // prompt's MenuControls go on top of the plunder's.
                this.plunder.open();
                this.plunder.refresh(boarding!, target, playerCrew,
                    atEscortCap);
                // Down while Use As My Ship's rename is up or its record
                // is on the way (answerCapture).
                if (this.renaming === boarding!.target
                    || this.tradedFor.has(boarding!.target)) {
                    this.assignment.close();
                } else {
                    this.assignment.open();
                }
                return;
            case 'missionWait':
                // Nothing on screen while the simulation settles the
                // board/rescue goal; the next few frames either present
                // the ShipDoneText or fall through to 'plunder'.
                this.plunder.close();
                this.assignment.close();
                return;
            case 'plunder':
                this.assignment.close();
                this.plunder.open();
                this.plunder.refresh(boarding!, target, playerCrew,
                    atEscortCap);
                return;
        }
    }
}

const BoardingUiResource = new Resource<BoardingUi>('BoardingUi');

/** The capture's rename prompt, for headless driving (confirm / type /
 * cancel through its `alert`). */
export const CapturedShipNamePromptResource =
    new Resource<CapturedShipNamePrompt>('CapturedShipNamePrompt');

/** This client's own ship in the display world. */
function localPlayerShip(world: World): Entity | undefined {
    for (const entity of world.entities.values()) {
        if (entity.components.has(PlayerShipSelector)) {
            return entity;
        }
    }
    return undefined;
}

/**
 * "Use As My Ship", the owner's half: asks "Now rename this captured
 * ship:" (CapturedShipNamePrompt, its wording out of STR# 2002 118), then
 * resolves the swap's set strings — the old class's OnRetire and the
 * prize class's OnCapture — against a detached copy of the pilot
 * (buildCaptureSetStrings) and emits the `captureShip` record
 * (CaptureShipEvent). Resolves whether it was sent: not when the classes
 * cannot be read, or when the capture no longer stands once the prompt is
 * answered (the session ended under it) — the sim would refuse the record
 * anyway (applyCaptureShip), this only spares the round trip.
 *
 * CANCEL ABANDONS THE CAPTURE (MEASURED, reference "The capture prompt's
 * keys and the rename alert's Cancel (CU leftover), wave 46", finding 2):
 * the alert and the plunder dialog close with no status line, the player
 * keeps his hull and hold, and the prize stays a disabled hulk that has
 * had its one board ("You can't board this ship."). That is exactly a
 * plunder session ended with Done, so Cancel sends `abandon` ('plunderDone'
 * on the ordinary control-input path: every peer ends the same session on
 * the same tick, and the hulk's `plundered` record, stamped when the
 * session opened, refuses the next board). Nothing is sent for a capture
 * that no longer stands (a prompt dismissed because the session ended).
 *
 * Read off the display world's mirror, never written; the pilot is read
 * AFTER the prompt, so the set strings run against the state the player
 * is in when they confirm.
 */
export async function useCapturedShip(world: World,
    gameData: SimulationGameDataInterface,
    displayAssets: DisplayAssetDataInterface,
    namePrompt: CapturedShipNamePrompt, screen: { x: number, y: number },
    abandon: () => void, targetUuid: string): Promise<boolean> {
    const prizeId = world.entities.get(targetUuid)?.components
        .get(ShipComponent)?.id;
    if (prizeId === undefined) {
        return false;
    }
    const prize = await gameData.data.Ship.get(prizeId);
    let prompt = CAPTURED_SHIP_NAME_PROMPT_TEXT;
    try {
        const table = await displayAssets.data.StringTable
            .get(CAPTURE_PROMPT_STRING_TABLE);
        const text = table.strings[CAPTURED_SHIP_NAME_PROMPT_INDEX];
        if (text?.trim()) {
            prompt = text;
        }
    } catch {
        // Keep the built-in wording.
    }
    const { x, y } = screenCentre(screen);
    namePrompt.container.position.set(x, y);
    const name = await namePrompt.ask(prize.name, prompt);

    const player = localPlayerShip(world);
    const boarding = player?.components.get(BoardingComponent);
    const oldId = player?.components.get(ShipComponent)?.id;
    if (!player || oldId === undefined || boarding?.target !== targetUuid
        || boarding.capture !== 'succeeded') {
        return false;
    }
    if (name === undefined) {
        abandon();
        return true;
    }
    const retired = await gameData.data.Ship.get(oldId);
    const effects = await buildCaptureSetStrings(player, retired, prize,
        gameData, MissionUniverse.shared(gameData),
        { systemId: world.resources.get(SystemIdResource) });
    world.emit(CaptureShipEvent, { capture: { name, ...effects } });
    return true;
}

/**
 * "Use As Escort", the owner's half: resolves the prize class's OnCapture
 * against a detached copy of the pilot (buildCaptureSetStrings with no
 * retired class: the pilot keeps his hull, GUESS) and emits the
 * `captureShip` record with `escort: true` (CaptureShipEvent). Resolves
 * whether it was sent: not when the prize's class cannot be read, or when
 * the capture no longer stands (the sim would refuse the record anyway,
 * applyCaptureShip). Read off the display world's mirror, never written.
 */
async function useCapturedShipAsEscort(world: World,
    gameData: SimulationGameDataInterface, targetUuid: string)
    : Promise<boolean> {
    const prizeId = world.entities.get(targetUuid)?.components
        .get(ShipComponent)?.id;
    const player = localPlayerShip(world);
    const boarding = player?.components.get(BoardingComponent);
    if (prizeId === undefined || !player || boarding?.target !== targetUuid
        || boarding.capture !== 'succeeded') {
        return false;
    }
    const prize = await gameData.data.Ship.get(prizeId);
    const effects = await buildCaptureSetStrings(player, undefined, prize,
        gameData, MissionUniverse.shared(gameData),
        { systemId: world.resources.get(SystemIdResource) });
    world.emit(CaptureShipEvent,
        { capture: { name: '', escort: true, ...effects } });
    return true;
}

// Runs each frame for the local player's ship (PlayerShipSelector),
// opening/closing/refreshing the dialogs from its synced
// BoardingComponent. Optional so it still runs (to close the dialogs)
// when no boarding is in progress.
const PlayerBoardingQuery = new Query(
    [PlayerShipSelector, Optional(BoardingComponent),
        Optional(ShipDataComponent), UUID] as const);
export const BoardingUiSystem = new System({
    name: 'BoardingUiSystem',
    args: [BoardingUiResource, PlayerBoardingQuery, Entities,
        SingletonComponent] as const,
    step(ui, players, entities) {
        const boarding = players[0]?.[1] ?? undefined;
        const playerCrew = players[0]?.[2]?.crew ?? 0;
        const playerUuid = players[0]?.[3];
        const target = boarding
            ? entities.get(boarding.target) : undefined;
        // The escort cap, off the same count and the same synced markers
        // the sim's capture gate reads (ruling #250). The player is in
        // flight while boarding, so the client's carried rosters are
        // empty and the display world is the whole fleet.
        const atEscortCap = boarding !== undefined && playerUuid !== undefined
            && cappedEscortCount(playerUuid, { world: entities })
                >= MAX_ESCORTS;
        ui.update(boarding ?? undefined, target, playerCrew, atEscortCap);
    },
    // #156 pin (shared: *): BoardingDisplayPlugin registers after
    // SpaceportPlugin.
    after: [SpaceportAmbientSystem],
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
        const gameData = world.resources.get(SimulationGameDataResource);
        const namePrompt = new CapturedShipNamePrompt(controls);
        const ui = new BoardingUi(displayAssets, controls, send, screen,
            // përs Flags 0x0200: the boarding trigger for a ship-offered
            // mission. A no-op for every hull that isn't such a përs.
            targetUuid => presentShipOffer(world, targetUuid, 'board'),
            // mïsn ShipGoal 2/5: boarding one of your own special ships
            // shows the mission's ShipDoneText. A no-op for every hull
            // that isn't one (MissionShipDonePlugin must be built first —
            // see display_plugin.ts).
            {
                status: targetUuid =>
                    boardShipDoneStatusOf(world, targetUuid),
                present: targetUuid =>
                    presentBoardShipDone(world, targetUuid),
            },
            // The capture prompt's "Use As My Ship": the rename, then the
            // `captureShip` record.
            gameData ? {
                ask: targetUuid => useCapturedShip(world, gameData,
                    displayAssets, namePrompt, screen, () => {
                        // Not from a world being torn down (remove()
                        // cancels the prompt, then drops the resource
                        // before the answer's continuation runs).
                        if (world.resources.get(
                            CapturedShipNamePromptResource) === namePrompt) {
                            send('plunderDone');
                        }
                    }, targetUuid),
                dismiss: () => namePrompt.alert.cancel(),
                escort: targetUuid => useCapturedShipAsEscort(world,
                    gameData, targetUuid),
            } : undefined);
        // jünk commodity names for the booty line come from the game data.
        ui.plunder.cargoName = key => cargoKeyDisplayName(key, gameData);
        // Derelict govts (gövt 0x0800) grey Capture at 0% (ruling #378).
        ui.plunder.lookupGovt = govtId => gameData?.data.Govt.getCached(govtId);
        stage.addChild(ui.plunder.container);
        stage.addChild(ui.assignment.container);
        stage.addChild(namePrompt.container);
        world.resources.set(BoardingUiResource, ui);
        world.resources.set(CapturedShipNamePromptResource, namePrompt);
        world.addSystem(BoardingUiSystem);
    },
    remove(world) {
        world.removeSystem(BoardingUiSystem);
        const ui = world.resources.get(BoardingUiResource);
        if (ui) {
            // A dialog still up while its world dies would keep its
            // MenuControls bound (see Menu.dismiss); then the dialogs are
            // destroyed, children included, so their Text canvases and
            // Graphics go with the world instead of leaking per transit
            // (review #40). Sprite textures are the asset cache's.
            ui.plunder.close();
            ui.assignment.close();
            ui.plunder.container.destroy({ children: true });
            ui.assignment.container.destroy({ children: true });
        }
        world.resources.delete(BoardingUiResource);
        const namePrompt = world.resources.get(CapturedShipNamePromptResource);
        if (namePrompt) {
            // An open prompt resolves (and its keyboard listeners go) first.
            namePrompt.alert.cancel();
            namePrompt.container.destroy({ children: true });
        }
        world.resources.delete(CapturedShipNamePromptResource);
    },
};
