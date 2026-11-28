import { Sound } from '@pixi/sound';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { texturesFromFrames } from '../display/textures_from_frames.js';
import { isReturnPress, isTextEntryActive } from '../input_focus.js';
import {
    LOGO_TICKS, nextLogoFrame, ROLL_IN_END_SOUND, ROLL_IN_START_SOUND,
    RollInCue, SLIDE_ROWS, TickClock, TitleRollIn,
} from './title_rollin.js';

/** The six title-screen commands, one per corner button. */
export type TitleAction =
    'newPilot' | 'openPilot' | 'quit' | 'enterShip' | 'setPrefs' | 'about';

/** Single-letter hotkeys for the six commands, matching the original
 * EV Nova title screen. Active only while the title owns the keyboard
 * (see `onKeyDown`). */
const HOTKEYS: { readonly [key: string]: TitleAction } = {
    n: 'newPilot',
    o: 'openPilot',
    q: 'quit',
    e: 'enterShip',
    p: 'setPrefs',
    a: 'about',
};

/**
 * The title command a bare key press maps to, or undefined for keys that
 * aren't hotkeys. Case-insensitive. A held modifier (Cmd/Ctrl/Alt) is not
 * a hotkey, so browser shortcuts like Cmd+Q keep working. Pure (no DOM),
 * so the mapping and modifier rule are unit-testable; the enabled /
 * text-entry gating that guards it lives in `onKeyDown`.
 */
export function hotkeyActionFor(
    event: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean },
): TitleAction | undefined {
    if (event.metaKey || event.ctrlKey || event.altKey) {
        return undefined;
    }
    return HOTKEYS[event.key.toLowerCase()];
}

/** One line of the bottom status readout (label + value). */
export interface TitleStatus {
    pilotName: string;
    shipName: string;
    shipClass: string;
    shipSubtitle: string;
    legalStatus: string;
    combatRating: string;
    date: string;
}

/**
 * The two "Ship Class:" lines. The original prints the shïp's name on the
 * first line and its subtitle field under it: shïp 129 (name "Heavy
 * Shuttle", subtitle "Version A") reads "Heavy Shuttle / Version A" in
 * title_screen/title_screen.png. A name's ";comment" suffix (the editor
 * note on variants like "Heavy Shuttle;Second-Hand - poor") is never shown.
 * No second line when the subtitle is empty or just repeats the name.
 */
export function shipClassLines(name: string, subtitle = ''):
    [string, string] {
    const shipClass = name.split(';')[0].trim();
    const second = subtitle.trim();
    return [shipClass, second === shipClass ? '' : second];
}

interface ButtonSpec {
    /** SpriteSheet id (rlëD) holding the button's normal/pressed frames. */
    sheet: string;
    /** The roll-in row (SLIDE_ROWS index) whose landing draws it. */
    row: number;
    /** Human label, used only for the scene-graph container name. */
    label: string;
    action: TitleAction;
    /** Frame index in the rollover sheet (8020) for this button's emblem. */
    rollover: number;
    /** Top-left of the button art in background-local (1024x768) coords. */
    x: number;
    y: number;
}

// Native background (PICT 8000) is 1024x768; the layout is measured in
// that space with the origin at the frame's center (512,384). Positions
// were read off the 1920x1080 reference capture (title_screen.png).
const BG_W = 1024;
const BG_H = 768;
const BG_CX = BG_W / 2;
const BG_CY = BG_H / 2;
/** Top of the pilot block's text boxes, background-local: the first
 * label's ink starts at y 626 (screen 783 on title_screen.png). */
const STATUS_TOP = 623;

/** One pilot-block line: a dim label, or (label '') a bright value. */
type StatusLine = [label: string, value?: string];

/**
 * Splits the pilot block into its two colour layers, line for line, so the
 * dim labels and the bright values share one line grid. Values are
 * indented two spaces under their labels, as in the original.
 */
export function statusLayers(lines: StatusLine[]): [string, string] {
    const labels = lines.map(([label, value]) =>
        value === undefined ? label : '');
    const values = lines.map(([, value]) =>
        value === undefined ? '' : `  ${value}`);
    return [labels.join('\n'), values.join('\n')];
}

// The corner buttons: sheet id -> label/action/rollover-frame, with the
// art's top-left in background-local coords.
const BUTTONS: ButtonSpec[] = [
    { sheet: 'nova:8050', label: 'New Pilot', action: 'newPilot', rollover: 0, row: 0, x: 349, y: 400 },
    { sheet: 'nova:8053', label: 'Enter Ship', action: 'enterShip', rollover: 3, row: 0, x: 555, y: 401 },
    { sheet: 'nova:8051', label: 'Open Pilot', action: 'openPilot', rollover: 1, row: 1, x: 344, y: 464 },
    { sheet: 'nova:8054', label: 'Set Prefs', action: 'setPrefs', rollover: 4, row: 1, x: 581, y: 464 },
    { sheet: 'nova:8052', label: 'Quit Nova', action: 'quit', rollover: 2, row: 2, x: 345, y: 528 },
    { sheet: 'nova:8055', label: 'About Nova', action: 'about', rollover: 5, row: 2, x: 580, y: 528 },
];

/** Rollover frame shown in the center emblem when nothing is hovered. */
const IDLE_ROLLOVER_FRAME = 6;
/** Center emblem (rollover sheet 8020) art top-left in bg-local coords. */
const EMBLEM_X = 444;
const EMBLEM_Y = 465;
/** Title animation (PICT 8010) center in bg-local coords, and its
 * per-frame height (the PICT is a vertical 7-frame filmstrip). */
const TITLE_CX = 518;
const TITLE_CY = 266;
const TITLE_FRAME_W = 654;
const TITLE_FRAME_H = 209;
const TITLE_FRAMES = 7;

/** Button-feedback snds (the original's title UI): 600 on press, 601 on
 * release. (602/603 belong to the roll-in: title_rollin.ts.) */
const SOUND_DOWN = 'nova:600';
const SOUND_UP = 'nova:601';
/** UI click volume. The in-game SFX bus runs hot (~0.045); a click needs
 * to register over it without being harsh. */
const UI_SOUND_VOLUME = 0.2;

interface TitleButton {
    spec: ButtonSpec;
    container: PIXI.Container;
    sprite: PIXI.Sprite;
    normal: PIXI.Texture;
    pressed: PIXI.Texture;
}

/**
 * The game's entry screen — the EV Nova title with its six corner
 * buttons, rendered from the original's own resources (background PICT
 * 8000, animated title PICT 8010, rollover emblems rlëD 8020, and the
 * per-button rlëD sheets 8050-8055).
 *
 * Client-only: it draws directly on the Pixi stage and never touches
 * simulation or multiplayer state. A button activation (mouse or
 * keyboard) is published on `action`; the orchestrator (browser.ts)
 * decides what to do — open a dialog, or enter the game world.
 */
export class TitleScreen {
    readonly container = new PIXI.Container();
    /** Emits when a corner button is activated (click / Enter). */
    readonly action = new Subject<TitleAction>();

    /** Positioned at the background's center; everything hangs off it in
     * background-local coords minus (512,384). */
    private readonly frame = new PIXI.Container();
    private buttons: TitleButton[] = [];
    private emblem = new PIXI.Sprite();
    private emblemTextures: PIXI.Texture[] = [];
    private titleSprite = new PIXI.Sprite();
    private titleTextures: PIXI.Texture[] = [];
    /** Each status column is two Texts on the same 12 px grid: the dim
     * labels and the bright values (see statusStyle). */
    private leftStatus = new PIXI.Text('');
    private leftValues = new PIXI.Text('');
    private rightStatus = new PIXI.Text('');
    private rightValues = new PIXI.Text('');
    private downSound?: Sound;
    private upSound?: Sound;
    private rollInStartSound?: Sound;
    private rollInEndSound?: Sound;
    /** One sprite per roll-in row, showing its slide strip's frames. */
    private slideSprites: PIXI.Sprite[] = [];
    private slideTextures: PIXI.Texture[][] = [];
    /** The current roll-in (a finished one between appearances). */
    private rollIn = new TitleRollIn(SLIDE_ROWS, true);
    private readonly rollInClock = new TickClock();
    private logoTicks = 0;
    /**
     * Every roll-in sound cue as it happens, and whether it was played
     * (false while the page's audio is still locked by the autoplay rule,
     * or the snd failed to load). For headless checks.
     */
    readonly rollInCues = new Subject<RollInCue & { played: boolean }>();

    private hovered?: TitleButton;
    /** Keyboard selection index into `buttons` (column-major order). */
    private selected = -1;
    private enabled = false;
    private titleFrameIndex = 0;
    private screenW = 1920;
    private screenH = 1080;

    readonly buildPromise: Promise<void>;

    constructor(private displayAssets: DisplayAssetDataInterface) {
        this.container.name = 'TitleScreen';
        this.container.visible = false;
        this.frame.name = 'TitleFrame';
        this.container.addChild(this.frame);
        this.buildPromise = this.build();
        document.addEventListener('keydown', this.onKeyDown);
        document.addEventListener('keyup', this.onKeyUp);
    }

    /**
     * The pilot block's face: the cölr resource's menu font (Geneva 9; our
     * Geneva-9 stand-in is 9.4 px, as elsewhere) on a 12 px pitch, labels
     * in its menuDim red (0x800000) and values in menuBright (0xff0000) —
     * the colours and pitch title_screen/title_screen.png shows.
     */
    private statusStyle(value: boolean): Partial<PIXI.ITextStyle> {
        return {
            fontFamily: 'Geneva', fontSize: 9.4,
            fill: value ? 0xff0000 : 0x800000,
            align: 'left', lineHeight: 12,
        };
    }

    private async build() {
        const assets = this.displayAssets;

        // Button-feedback snds. Load them up front (the first click is a
        // user gesture, so playback is allowed then), but never let a
        // missing/failed snd break the title — some plug-in scenarios may
        // not ship 600/601.
        void assets.data.Sound.get(SOUND_DOWN)
            .then(sound => { this.downSound = sound; })
            .catch(e => console.warn(`Title down sound ${SOUND_DOWN}:`, e));
        void assets.data.Sound.get(SOUND_UP)
            .then(sound => { this.upSound = sound; })
            .catch(e => console.warn(`Title up sound ${SOUND_UP}:`, e));
        void assets.data.Sound.get(ROLL_IN_START_SOUND)
            .then(sound => { this.rollInStartSound = sound; })
            .catch(e => console.warn(
                `Title roll-in sound ${ROLL_IN_START_SOUND}:`, e));
        void assets.data.Sound.get(ROLL_IN_END_SOUND)
            .then(sound => { this.rollInEndSound = sound; })
            .catch(e => console.warn(
                `Title roll-in sound ${ROLL_IN_END_SOUND}:`, e));

        // Background frame (PICT 8000), drawn at native size, centered.
        const bgTexture = await assets.textureFromPictAsync('nova:8000');
        const bg = new PIXI.Sprite(bgTexture);
        bg.anchor.set(0.5);
        bg.name = 'TitleBackground';
        // So clicks on the background don't fall through to the game.
        bg.interactive = true;
        // A mouse-down anywhere on the title skips the roll-in, as in the
        // original (buttons skip it from their own handler).
        bg.on('pointerdown', () => this.skipRollIn());
        this.frame.addChildAt(bg, 0);

        // The roll-in's slide strips (PICTs 8030-8032), one sprite per
        // row over the centre panel, under the buttons and the emblem.
        // A missing strip only loses that row's slide: its buttons still
        // appear when the row lands.
        for (const [i, row] of SLIDE_ROWS.entries()) {
            const sprite = new PIXI.Sprite();
            sprite.name = `TitleSlide${i}`;
            sprite.position.set(row.x - BG_CX, row.y - BG_CY);
            sprite.visible = false;
            this.frame.addChild(sprite);
            this.slideSprites.push(sprite);
            this.slideTextures.push([]);
            try {
                const strip = await assets.textureFromPictAsync(row.pict);
                // Nearest, like the logo: no bleed between strip frames.
                strip.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
                for (let f = 0; f < row.frames; f++) {
                    this.slideTextures[i].push(new PIXI.Texture(
                        strip.baseTexture, new PIXI.Rectangle(
                            0, f * row.height, row.width, row.height)));
                }
            } catch (e) {
                console.warn(`Title slide strip ${row.pict}:`, e);
            }
        }

        // Animated title (PICT 8010): a vertical 7-frame filmstrip. Slice
        // it into per-frame sub-textures sharing the one base texture.
        const titleTexture = await assets.textureFromPictAsync('nova:8010');
        const base = titleTexture.baseTexture;
        // The title is a vertical filmstrip drawn at native scale; nearest
        // sampling stops a frame's edge rows from bleeding in the next
        // frame (which would show as a seam over the background starfield).
        base.scaleMode = PIXI.SCALE_MODES.NEAREST;
        for (let i = 0; i < TITLE_FRAMES; i++) {
            this.titleTextures.push(new PIXI.Texture(base,
                new PIXI.Rectangle(0, i * TITLE_FRAME_H,
                    TITLE_FRAME_W, TITLE_FRAME_H)));
        }
        this.titleSprite.texture = this.titleTextures[0];
        this.titleSprite.anchor.set(0.5);
        this.titleSprite.name = 'TitleLogo';
        this.titleSprite.position.set(TITLE_CX - BG_CX, TITLE_CY - BG_CY);
        this.frame.addChild(this.titleSprite);

        // Center emblem (rollover sheet 8020): the ATMOS logo at rest,
        // and one icon per corner button on hover.
        this.emblemTextures = await this.loadSheet('nova:8020');
        this.emblem.texture = this.emblemTextures[IDLE_ROLLOVER_FRAME]
            ?? this.emblemTextures[0];
        this.emblem.name = 'TitleEmblem';
        this.emblem.position.set(EMBLEM_X - BG_CX, EMBLEM_Y - BG_CY);
        this.frame.addChild(this.emblem);

        // The six corner buttons.
        for (const spec of BUTTONS) {
            const textures = await this.loadSheet(spec.sheet);
            const container = new PIXI.Container();
            // Named for scene-graph queries (headless UI driving), like
            // the spaceport's buttons.
            container.name = `Button:${spec.label}`;
            container.position.set(spec.x - BG_CX, spec.y - BG_CY);
            const sprite = new PIXI.Sprite(textures[0]);
            container.addChild(sprite);
            // An explicit hit area (the art's rectangle, which is what the
            // sprite's bounds gave before), so a button whose row is still
            // sliding in (sprite hidden) can still be pressed: in the
            // original a click there skips the roll-in and is tracked as
            // that button's press.
            container.hitArea = new PIXI.Rectangle(0, 0,
                textures[0]?.width ?? 0, textures[0]?.height ?? 0);
            container.interactive = true;
            container.cursor = 'pointer';
            const button: TitleButton = {
                spec, container, sprite,
                normal: textures[0], pressed: textures[1] ?? textures[0],
            };
            container.on('pointerover', () => this.setHover(button));
            container.on('pointerout', () => {
                // Leaving clears the hover (emblem) AND any in-progress
                // press frame (a press-then-drag-off must not stick). Not
                // a release, so no up sound here.
                this.setPressed(button, false);
                this.clearHover(button);
            });
            container.on('pointerdown', () => {
                this.skipRollIn();
                this.setPressed(button, true);
                this.playSound(this.downSound);
            });
            container.on('pointerup', () => {
                this.playSound(this.upSound);
                this.activate(button);
            });
            container.on('pointerupoutside', () => {
                // Released off the button (press-then-drag-off): the button
                // still went down and up, so play the up snd and revert.
                this.setPressed(button, false);
                this.playSound(this.upSound);
            });
            this.frame.addChild(container);
            this.buttons.push(button);
        }

        // Bottom status readout: two red columns, each a dim label layer
        // and a bright value layer on the same line grid.
        const columns: [PIXI.Text, PIXI.Text, string, number][] = [
            [this.leftStatus, this.leftValues, 'Left', 322],
            [this.rightStatus, this.rightValues, 'Right', 632],
        ];
        for (const [labels, values, side, x] of columns) {
            labels.style = new PIXI.TextStyle(this.statusStyle(false));
            labels.name = `TitleStatus${side}`;
            values.style = new PIXI.TextStyle(this.statusStyle(true));
            values.name = `TitleStatus${side}Values`;
            for (const text of [labels, values]) {
                text.position.set(x - BG_CX, STATUS_TOP - BG_CY);
                this.frame.addChild(text);
            }
        }

        this.applyRollIn();
        this.layout();
    }

    /** Loads a rlëD SpriteSheet and returns its per-frame textures. */
    private async loadSheet(id: string): Promise<PIXI.Texture[]> {
        const framesData = await this.displayAssets.data
            .SpriteSheetFrames.get(id);
        return texturesFromFrames(framesData.frames);
    }

    /** Swaps a button between its normal (frame 0) and pressed (frame 1)
     * art. The second frame is the PRESSED state — shown only while the
     * pointer is actually down on the button, never for hover or keyboard
     * selection (those change only the center emblem). */
    private setPressed(button: TitleButton, pressed: boolean) {
        button.sprite.texture = pressed ? button.pressed : button.normal;
    }

    /** Fires a one-shot UI snd. Each play() spawns its own instance, so
     * rapid clicks overlap cleanly. No-op if the snd never loaded. */
    private playSound(sound?: Sound) {
        if (!sound) {
            return;
        }
        sound.volume = UI_SOUND_VOLUME;
        try {
            sound.play();
        } catch (e) {
            console.warn('Title sound play failed:', e);
        }
    }

    /**
     * Plays a roll-in cue's snd, but only into an audio context that is
     * already running: the title first appears before any user gesture,
     * and a sound started into a context the autoplay rule still holds
     * suspended would come out late, all at once, on the first click.
     * The original's sounds belong to the moment, so a locked context
     * drops them instead. `?mute` is honoured by the global volume.
     */
    private playRollInCue(cue: RollInCue) {
        const sound = cue.kind === 'start'
            ? this.rollInStartSound : this.rollInEndSound;
        const played = sound !== undefined && audioRunning(sound);
        if (played) {
            this.playSound(sound);
        }
        this.rollInCues.next({ ...cue, played });
    }

    /** A click during the roll-in lands every row at once (no end snd). */
    private skipRollIn() {
        if (this.rollIn.skip()) {
            this.applyRollIn();
        }
    }

    /** Draws the roll-in's current state: each row's strip frame or its
     * buttons, and the emblem's fade. */
    private applyRollIn() {
        for (const [i, sprite] of this.slideSprites.entries()) {
            const view = this.rollIn.row(i);
            const texture = view.kind === 'slide'
                ? this.slideTextures[i][view.frame] : undefined;
            sprite.visible = texture !== undefined;
            if (texture) {
                sprite.texture = texture;
            }
        }
        for (const button of this.buttons) {
            button.sprite.visible =
                this.rollIn.row(button.spec.row).kind === 'buttons';
        }
        this.emblem.alpha = this.rollIn.emblemOpacity;
    }

    private setHover(button: TitleButton) {
        this.hovered = button;
        this.selected = this.buttons.indexOf(button);
        this.updateEmblem();
    }

    private clearHover(button: TitleButton) {
        // Moving the mouse off a button returns to rest. `setHover` also
        // set `selected` (so Enter activates the hovered button), so
        // clearing only `hovered` would leave the emblem lit via the
        // keyboard-selection fallback in updateEmblem. Drop the selection
        // too. Keyboard navigation is unaffected: it leaves `hovered`
        // undefined, so this guard never fires for it.
        if (this.hovered === button) {
            this.hovered = undefined;
            this.selected = -1;
            this.updateEmblem();
        }
    }

    /** Shows the hovered/selected button's rollover emblem in the center
     * (the ATMOS logo at rest). The button ART never changes here: its
     * second frame is the PRESSED state (see setPressed), not a hover
     * highlight, so hover and keyboard selection swap only the emblem. */
    private updateEmblem() {
        const active = this.hovered
            ?? (this.selected >= 0 ? this.buttons[this.selected] : undefined);
        const frame = active?.spec.rollover ?? IDLE_ROLLOVER_FRAME;
        if (this.emblemTextures[frame]) {
            this.emblem.texture = this.emblemTextures[frame];
        }
    }

    private activate(button: TitleButton) {
        if (!this.enabled) {
            return;
        }
        this.setPressed(button, false);
        this.action.next(button.spec.action);
    }

    /** Keys that "press" a title command: Enter/Space activate the current
     * selection, and the six letter hotkeys. These get the button-down /
     * button-up snds, mirroring a mouse press. */
    private isActivationKey(event: KeyboardEvent): boolean {
        return isReturnPress(event) || event.key === ' '
            || hotkeyActionFor(event) !== undefined;
    }

    private onKeyDown = (event: KeyboardEvent) => {
        // Ignore keys while the title is disabled (a dialog is open, or the
        // game is running) or while any text field owns the keyboard (e.g.
        // typing a pilot name into the New Pilot dialog): the letter
        // hotkeys below must never fire mid-typing.
        if (!this.enabled || isTextEntryActive()) {
            return;
        }
        // Button-down snd on the initial press of an activation key (not on
        // auto-repeat). The matching up snd fires from onKeyUp.
        if (!event.repeat && this.isActivationKey(event)) {
            this.playSound(this.downSound);
        }
        // Letter hotkeys for the six commands (n/o/q/e/p/a).
        const action = hotkeyActionFor(event);
        if (action) {
            const button = this.buttons.find(b => b.spec.action === action);
            if (button) {
                this.selected = this.buttons.indexOf(button);
                this.hovered = undefined;
                this.updateEmblem();
                this.activate(button);
                event.preventDefault();
                return;
            }
        }
        // Column-major grid: indices 0/1 top row, 2/3 middle, 4/5 bottom.
        // Even indices are the left column, odd the right.
        switch (event.key) {
            case 'ArrowUp':
                this.moveSelection(-2);
                event.preventDefault();
                break;
            case 'ArrowDown':
                this.moveSelection(2);
                event.preventDefault();
                break;
            case 'ArrowLeft':
                this.moveSelection(-1);
                event.preventDefault();
                break;
            case 'ArrowRight':
                this.moveSelection(1);
                event.preventDefault();
                break;
            case 'Enter':
            case ' ':
                if (this.selected >= 0 && !event.altKey) {
                    this.activate(this.buttons[this.selected]);
                    event.preventDefault();
                }
                break;
            default:
                break;
        }
    };

    private onKeyUp = (event: KeyboardEvent) => {
        // Button-up snd on release of an activation key, mirroring a mouse
        // release. Gated like onKeyDown so a release into a text field (or
        // once the title stops owning the keyboard) stays silent.
        if (!this.enabled || isTextEntryActive()) {
            return;
        }
        if (this.isActivationKey(event)) {
            this.playSound(this.upSound);
        }
    };

    private moveSelection(delta: number) {
        const count = this.buttons.length;
        if (this.selected < 0) {
            this.selected = delta > 0 ? 0 : count - 1;
        } else {
            this.selected = (this.selected + delta + count) % count;
        }
        this.hovered = undefined;
        this.updateEmblem();
    }

    /** Fills the bottom status columns from the current pilot/save. */
    setStatus(status: TitleStatus) {
        const [leftLabels, leftValues] = statusLayers([
            ['Pilot Name:'], ['', status.pilotName], [''],
            ['Ship Name:'], ['', status.shipName], [''],
            ['Ship Class:'], ['', status.shipClass],
            ...(status.shipSubtitle
                ? [['', status.shipSubtitle] as StatusLine] : []),
        ]);
        this.leftStatus.text = leftLabels;
        this.leftValues.text = leftValues;
        const [rightLabels, rightValues] = statusLayers([
            ['Legal status in'], [' current system:'],
            ['', status.legalStatus], [''],
            ['Combat Rating:'], ['', status.combatRating], [''],
            ['Current Date:'], ['', status.date],
        ]);
        this.rightStatus.text = rightLabels;
        this.rightValues.text = rightValues;
    }

    /**
     * Shows the title and accepts input, starting the button roll-in (the
     * original plays it on every appearance: first open and every return
     * from the game). Input is live throughout, as in the original. A
     * page already in the background gets no roll-in (the original's
     * `inBackground` path).
     */
    show() {
        this.container.visible = true;
        this.enabled = true;
        this.rollIn = new TitleRollIn(SLIDE_ROWS, document.hidden);
        this.rollInClock.reset();
        this.applyRollIn();
        this.updateEmblem();
    }

    /** Hides the title (e.g. once the game world is entered). */
    hide() {
        this.container.visible = false;
        this.enabled = false;
    }

    /** Enables/disables input without hiding — used while a modal dialog
     * (About, New Pilot, ...) is open over the title. */
    setEnabled(enabled: boolean) {
        this.enabled = enabled;
        for (const button of this.buttons) {
            button.container.interactive = enabled;
        }
        if (!enabled) {
            this.hovered = undefined;
            this.selected = -1;
            // Clear the emblem and drop any stuck pressed frame.
            for (const button of this.buttons) {
                this.setPressed(button, false);
            }
            this.updateEmblem();
        }
    }

    /**
     * Advances the title's animations on the original's 60 Hz tick: the
     * logo's flames (a random other frame every 5 ticks) and the button
     * roll-in. Call each frame. Both stand still while a title dialog is
     * up (the original's modal dialogs run their own loop: About opened
     * mid roll-in froze the rows and the logo, and closing it resumed
     * them where they stood).
     */
    tick(deltaMs: number) {
        if (!this.container.visible) {
            return;
        }
        const ticks = this.rollInClock.advance(deltaMs);
        if (!this.enabled) {
            return;
        }
        for (let t = 0; t < ticks; t++) {
            this.logoTick();
            if (!this.rollIn.finished) {
                for (const cue of this.rollIn.tick()) {
                    this.playRollInCue(cue);
                }
                this.applyRollIn();
            }
        }
    }

    private logoTick() {
        if (this.titleTextures.length === 0
            || ++this.logoTicks < LOGO_TICKS) {
            return;
        }
        this.logoTicks = 0;
        this.titleFrameIndex = nextLogoFrame(this.titleFrameIndex,
            this.titleTextures.length);
        this.titleSprite.texture = this.titleTextures[this.titleFrameIndex];
    }

    /** Re-centers and scales the title to the current screen size. */
    resize(width: number, height: number) {
        this.screenW = width;
        this.screenH = height;
        this.layout();
    }

    private layout() {
        // Center the frame; scale down to fit small screens, never up
        // (the reference shows the 1024x768 art at native size on a
        // 1920x1080 display).
        const scale = Math.min(1,
            this.screenW / (BG_W + 16), this.screenH / (BG_H + 16));
        this.frame.scale.set(scale);
        this.frame.position.set(this.screenW / 2, this.screenH / 2);
    }

    destroy() {
        this.rollInCues.complete();
        document.removeEventListener('keydown', this.onKeyDown);
        document.removeEventListener('keyup', this.onKeyUp);
        this.container.destroy({ children: true });
    }
}

/**
 * Whether a snd can be heard right now: its context is not auto-paused
 * (window blurred) and, for Web Audio, already running (the autoplay rule
 * keeps it suspended until the first user gesture).
 */
function audioRunning(sound: Sound): boolean {
    const context = sound.context as {
        paused?: boolean, audioContext?: { state?: string },
    } | undefined;
    if (!context || context.paused) {
        return false;
    }
    const state = context.audioContext?.state;
    return state === undefined || state === 'running';
}
