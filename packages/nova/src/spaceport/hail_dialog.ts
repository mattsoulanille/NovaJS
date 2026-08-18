import * as PIXI from 'pixi.js';
import { firstValueFrom, Observable, Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { ControlEvent } from '../nova_plugin/controls_plugin.js';
import { Button } from './button.js';
import {
    buttonRowY, commButtonSlots, COMM_ESCORT, COMM_HAGGLE, COMM_LINE_HEIGHT,
    COMM_PLANET, COMM_SHIP, CommFrameLayout, fitImage, frameOrigin,
} from './hail_layout.js';
import { MenuControls } from './menu_controls.js';

/**
 * ============================================================================
 * The communications (hail) dialog — client-side rendering
 * ============================================================================
 *
 * A modal overlay opened by the 'hail' key while in flight, on the same
 * MenuControls focus stack as the starmap / mission-info dialogs. It renders
 * one of the comms backgrounds (PICT 8511 ships, 8512 planets, 8513 escorts,
 * 8514 haggle/beg-for-mercy) with the target's image and greeting/response
 * text, plus context-appropriate buttons.
 *
 * This class is presentation only: what to show and which buttons to offer is
 * decided by hail_dialog_plugin (from the pure logic in nova_plugin/hail.ts),
 * and every button that has a SIMULATION effect calls back into the plugin,
 * which routes it through the deterministic input path (bridge.hail /
 * escort-command control events). The dialog never mutates the sim directly.
 *
 * The ESCORT comm dialog (PICT 8513) manages a hired escort — it does NOT
 * issue fleet commands (Attack / Defend / Formation / ...); commanding escorts
 * is the keyboard escort-controls' job. Per the reference screenshots
 * (hail/hail_escort.png and the upgrading/captured/sell variants) the button
 * column is, top to bottom: Upgrade Escort, Sell Escort, Release, Close
 * Channel. All three management actions depend on state NovaJS does not model
 * yet — a shipyard upgrade-transfer, an escort resale value, and per-escort
 * release (a future per-escort-control feature Matthew will spec separately) —
 * so they render as GREYED seams; only Close Channel is live. See the plugin
 * for the documented seams.
 */

/** Comms-dialog background PICT ids (see novajs-spaceport-ui memory map). */
export const HAIL_PICT_SHIP = 'nova:8511';
export const HAIL_PICT_PLANET = 'nova:8512';
export const HAIL_PICT_ESCORT = 'nova:8513';
export const HAIL_PICT_HAGGLE = 'nova:8514';

/** Interface beeps (snd resources) for the comm dialog: open, close, and a
 * generic button press. Local client UI sounds — routed through the display
 * audio path via the playSound callback, never the simulation. */
export const HAIL_SND_OPEN = 'nova:154';
export const HAIL_SND_CLOSE = 'nova:152';
export const HAIL_SND_BUTTON = 'nova:151';

/** What the plugin tells the dialog to display. Pure data, no world refs. */
export interface HailContext {
    /** Which comms background / layout to use. */
    variant: 'ship' | 'planet' | 'escort';
    /** Header line: govt comm name, person name, or planet name. */
    heading: string;
    /** A fully-qualified PICT global id for the target image (e.g. a ship's
     * 'nova:3001' pict, a pers hailPict which the parser already emits as
     * 'nova:4001', or a planet pict), or null for no image. Already prefixed —
     * the caller must NOT add another 'nova:'. */
    image: string | null;
    /**
     * Body: what the hailed party says as the channel OPENS — the
     * channel-open line for a ship or planet, the hostile group's line for a
     * hostile ship, or the escort status text. NOT the greeting: that is
     * {@link greeting}, which the Greetings button produces.
     */
    body: string;
    /**
     * What the Greetings button answers with (hail/greetings.png), when the
     * hailed party has a greeting to give. Absent for a hostile ship or a
     * non-talkative government, whose Greetings press simply restores the
     * line the channel opened with.
     */
    greeting?: string;
    /** Request-assistance offer (fuel/repair), when eligible. */
    assist?: { free: boolean };
    /**
     * A bribe offer. Against a hostile SHIP this is the beg-for-mercy price
     * (they let you go); at a STELLAR that is refusing you landing clearance
     * it is the price of being let in (`purpose: 'landing'`), which is the
     * only thing that changes about the haggle page.
     */
    bribe?: {
        amount: number, canAfford: boolean, purpose?: 'mercy' | 'landing',
        /**
         * What the hailed SHIP says once the demand is paid (STR# 3000
         * 135-139, "Okay, I'll leave you alone."). Present on a mercy offer
         * only: paying a PORT closes the channel instead, since the
         * clearance it just sold has to be re-derived by a fresh hail.
         */
        accepted?: string,
    };
    /** Escort-management dialog (escort variant only): show the Upgrade
     * Escort / Sell Escort / Release seam buttons above Close Channel. */
    escort?: boolean;
}

/** Callbacks the dialog fires. `requestAssistance`/`bribe` route to the
 * deterministic input path; `playSound` plays a local client UI beep through
 * the display audio path (no simulation involvement). */
export interface HailCallbacks {
    /**
     * Asks the hailed ship for aid, and returns WHAT IT SAID — an acceptance
     * ("All right, I'll help you."), a busy refusal ("I'm busy.") or a
     * pointless-request refusal ("You're not in any trouble."), all real lines
     * from the stock comm table. The simulation effect, if any, has already
     * been dispatched by the time this returns.
     *
     * The answer comes back from the one call rather than from a separate
     * "may I?" probe on purpose: probe-then-send would evaluate the ship's
     * state twice, and could dispatch a request the probe had just cleared.
     */
    requestAssistance(): string;
    bribe(): void;
    playSound(id: string): void;
}

/**
 * The comm dialogs' identity-block colours, sampled from the original-hardware
 * captures (1920x1080, frames blitted 1:1 — these are the game's own pixels):
 * on hail/hail_hostile.png the lower well's "Class:" / "Status:" labels are
 * 0x808080 grey, "Fed Destroyer" and "(Federation)" are white, and "Hostile"
 * is 0xdd0806 red. hail/hail.png and hail/hail_escort.png agree (a bare label
 * line such as "Hired Escort:" is grey, the name under it white).
 */
export const COMM_LABEL_COLOR = 0x808080;
export const COMM_VALUE_COLOR = 0xffffff;
export const COMM_HOSTILE_COLOR = 0xdd0806;

/** A stretch of identity text drawn in one colour. */
export interface CommTextRun {
    text: string;
    color: number;
}

/**
 * Splits an identity block (hail_dialog_plugin's shipIdentityBlock) into the
 * coloured runs the original draws, one array of runs per line:
 *
 *   "Class: Fed Destroyer" -> grey "Class: " + white "Fed Destroyer"
 *   "Status: Hostile"      -> grey "Status: " + RED "Hostile"
 *   "(Federation)"         -> white, whole
 *   "Hired Escort:"        -> grey, whole (a label with nothing after it)
 *
 * Pure and total, and it never alters the text: concatenating the runs back
 * together reproduces the block exactly. Only the Status line is red, and
 * "Hostile" is the only status the block ever carries.
 */
export function identityRuns(block: string): CommTextRun[][] {
    return block.split('\n').map(line => {
        const colon = line.indexOf(':');
        if (colon < 0) {
            return [{ text: line, color: COMM_VALUE_COLOR }];
        }
        // Keep the separating space with the LABEL, so the value run starts
        // at the first inked pixel of the value.
        const valueStart = /\S/.exec(line.slice(colon + 1));
        if (!valueStart) {
            // A bare label ("Hired Escort:", "Fighter:") — all dim.
            return [{ text: line, color: COMM_LABEL_COLOR }];
        }
        const split = colon + 1 + valueStart.index;
        const label = line.slice(0, split);
        return [
            { text: label, color: COMM_LABEL_COLOR },
            {
                text: line.slice(split),
                color: label.trimEnd() === 'Status:'
                    ? COMM_HOSTILE_COLOR : COMM_VALUE_COLOR,
            },
        ];
    });
}

/**
 * The comm dialogs' body font. Geneva 9.4px with an explicit 15px leading:
 * the same bitmap face and size the mission popups use (popup_layout's
 * POPUP_FONT), set to the looser line pitch these frames show — see
 * COMM_LINE_HEIGHT. NOT bold and not two different sizes: the references'
 * response and identity text are the same face, and the only variation is
 * colour (dim grey labels, white values).
 */
const HEADING_FONT: Partial<PIXI.ITextStyle> = {
    fontFamily: 'Geneva', fontSize: 9.4, fill: 0xffffff, align: 'left',
    wordWrap: false, lineHeight: COMM_LINE_HEIGHT,
};
const BODY_FONT: Partial<PIXI.ITextStyle> = {
    fontFamily: 'Geneva', fontSize: 9.4, fill: 0xffffff, align: 'left',
    wordWrap: true, wordWrapWidth: 240, lineHeight: COMM_LINE_HEIGHT,
};

/**
 * A Button's container.x is not quite its sprite's left edge: the left cap
 * (13px wide) is anchored to END at container.x + 13.2 (button.ts's
 * LEFT_POS), so the sprite's left edge lands at container.x + 0.2.
 * hail_layout quotes the measured SPRITE left edge, so placing one takes
 * that fifth of a pixel back off.
 */
const BUTTON_CAP_INSET = 0.2;

/** The frame layout for a context/phase (see hail_layout.ts). */
export function frameFor(phase: 'main' | 'haggle',
    variant: 'ship' | 'planet' | 'escort'): CommFrameLayout {
    if (phase === 'haggle') {
        return COMM_HAGGLE;
    }
    switch (variant) {
        case 'planet': return COMM_PLANET;
        case 'escort': return COMM_ESCORT;
        default: return COMM_SHIP;
    }
}

/**
 * Which offer the 'r' key ("recharge", the original's request-assistance
 * key) activates in the hail dialog: the assist button slot's occupant —
 * Request Assistance when eligible, or Beg for Mercy against a hostile
 * ship (the slot's replacement). Nothing on the haggle page (where the
 * offer buttons are Pay/Leave) or when neither offer exists.
 */
export function assistSlotAction(phase: 'main' | 'haggle',
    context?: { assist?: unknown, bribe?: unknown }):
    'assist' | 'beg' | undefined {
    if (phase !== 'main' || !context) {
        return undefined;
    }
    if (context.assist) {
        return 'assist';
    }
    if (context.bribe) {
        return 'beg';
    }
    return undefined;
}

/** Which page of the comm dialog is showing, and with what contents. */
export interface HailPage {
    phase: 'main' | 'haggle';
    context: HailContext;
}

/** A button press the page state machine understands. */
export type HailPress =
    /** The top button: ask for a hello. */
    | { kind: 'greetings' }
    /** The offer slot for a friendly ship, carrying WHAT IT ANSWERED. */
    | { kind: 'assist', answer: string }
    /** The offer slot for a hostile ship / a shut port: onto the haggle page. */
    | { kind: 'beg' }
    /** Pay the demand (the haggle page). */
    | { kind: 'pay' }
    /** Back out of the haggle page. */
    | { kind: 'cancel' };

/**
 * THE COMM DIALOG'S PAGE STATE MACHINE — pure, so the behaviour the
 * reference screenshots pin can be tested without a canvas (the same reason
 * button.ts's pressTransition is pure). {@link HailDialog} is then only the
 * drawing of whatever this returns; `'close'` means the channel shuts.
 *
 * `opening` is the context the channel opened with, which is what a Greetings
 * press restores for a party that has no greeting of its own.
 *
 * The rule the two nits come down to: A PRESS NEVER REMOVES ITS OWN BUTTON.
 * The offer slot is drawn from the context (hail_layout's commButtonSlots),
 * and no transition here clears `assist` or `bribe` — hail/hail.png,
 * hail/greetings.png and hail/request_assistance.png are the same three-row
 * column in every state, including after the ship has answered.
 */
export function hailPress(state: HailPage, press: HailPress,
    opening?: HailContext): HailPage | 'close' {
    const { phase, context } = state;
    switch (press.kind) {
        case 'greetings': {
            // The greeting the Greetings button exists for; a party with
            // none (a hostile ship, a silent govt) restores what the channel
            // opened with, which is what the button is good for after a
            // refusal has replaced the response text.
            const body = context.greeting ?? opening?.body ?? context.body;
            return body === context.body
                ? state : { phase, context: { ...context, body } };
        }
        case 'assist':
            // The answer goes in the well and THE OFFER STAYS — asking again
            // re-asks, and the answer is recomputed from live state.
            return context.assist
                ? { phase, context: { ...context, body: press.answer } }
                : state;
        case 'beg':
            return context.bribe ? { phase: 'haggle', context } : state;
        case 'cancel':
            return { phase: 'main', context };
        case 'pay': {
            const accepted = context.bribe?.accepted;
            if (accepted === undefined) {
                // A PORT's clearance has to be re-derived (the landing gate
                // reads the bribe the sim just recorded), so the channel
                // closes and a fresh hail reports the new verdict.
                return 'close';
            }
            // A SHIP takes the money and says so ("Okay, I'll leave you
            // alone." — STR# 3000 135-139): back to the main page with its
            // answer, Beg For Mercy still in its slot. A second press costs
            // nothing — applyHail refuses to charge for a reprieve it has
            // already granted this player.
            return { phase: 'main', context: { ...context, body: accepted } };
        }
    }
}

export class HailDialog {
    container = new PIXI.Container();
    private content = new PIXI.Container();
    private controls: MenuControls;
    private closed = new Subject<void>();
    private phase: 'main' | 'haggle' = 'main';
    private context?: HailContext;
    /** The context the channel opened with, so Greetings can restore it. */
    private opening?: HailContext;

    constructor(private displayAssets: DisplayAssetDataInterface,
        private controlEvents: Observable<ControlEvent>,
        private callbacks: HailCallbacks) {
        this.container.name = 'HailDialog';
        this.container.visible = false;

        // Modal shield: swallow clicks aimed past the dialog.
        const shield = new PIXI.Graphics()
            .beginFill(0x000000, 0.001)
            .drawRect(-4000, -4000, 8000, 8000)
            .endFill();
        shield.interactive = true;
        this.container.addChild(shield);
        this.container.addChild(this.content);

        this.controls = new MenuControls(controlEvents, {
            // 'y' toggles the dialog closed again; 'd'/Escape backs out.
            hail: () => this.closed.next(),
            depart: () => this.close(),
            // 'r': the assist slot — Request Assistance, or Beg for
            // Mercy when hostile (the slot's replacement).
            recharge: () => this.pressAssistSlot(),
        });
    }

    /** Shows the dialog for a computed context; resolves when dismissed. */
    async show(context: HailContext): Promise<void> {
        this.context = context;
        this.opening = context;
        this.phase = 'main';
        await this.render();
        this.container.visible = true;
        this.callbacks.playSound(HAIL_SND_OPEN);
        this.controls.bind();
        await firstValueFrom(this.closed);
        this.callbacks.playSound(HAIL_SND_CLOSE);
        this.controls.unbind();
        this.container.visible = false;
    }

    /**
     * The Greetings press (the top button in every ship/planet reference):
     * asks the hailed party for a hello. The channel itself opened with
     * "Channel open." (hail/hail.png); pressing Greetings is what puts
     * "Greetings." in the response well (hail/greetings.png), so this is the
     * ONLY thing that shows the greeting at all.
     *
     * NovaJS's greeting is a deterministic function of the target
     * (hail.ts's greetingText, seeded by its uuid) rather than a fresh random
     * pick, so pressing it repeatedly answers the same line — and a hailed
     * party with no greeting to give (a hostile ship, a non-talkative govt)
     * falls back to restoring whatever the channel opened with, which is what
     * the button is good for after a refusal has replaced the response text.
     */
    private pressGreetings() {
        this.beep();
        this.apply({ kind: 'greetings' });
    }

    /** The Beg for Mercy press: into the haggle page. */
    private pressBeg() {
        this.beep();
        this.apply({ kind: 'beg' });
    }

    /**
     * Runs one press through {@link hailPress} and redraws if anything moved.
     * All of the dialog's page behaviour lives in that pure function; this is
     * the only thing that turns its answer into pixels.
     */
    private apply(press: HailPress) {
        if (!this.context) {
            return;
        }
        const next = hailPress({ phase: this.phase, context: this.context },
            press, this.opening);
        if (next === 'close') {
            this.close();
            return;
        }
        if (next.phase === this.phase && next.context === this.context) {
            return;
        }
        this.phase = next.phase;
        this.context = next.context;
        void this.render();
    }

    /**
     * The Request Assistance press. WHATEVER the ship answers — an acceptance
     * ("All right, I'll help you."), a busy refusal ("I'm busy.") or "you
     * don't need help" — the channel stays OPEN showing the line, so the
     * player actually hears the reply and closes the channel themselves.
     *
     * THE BUTTON STAYS. hail/request_assistance.png is the reference: the
     * ship has already answered "You're not in any trouble." and the Request
     * Assistance pill is still sitting in the middle slot, exactly where
     * hail.png had it. NovaJS used to drop the offer with the answer, so the
     * column silently collapsed to two rows and a player who asked too early
     * (before taking damage, or while the ship was busy) could never ask
     * again without closing and re-opening the channel. Re-asking is free:
     * the answer is recomputed from live state on every press (the plugin's
     * assistAnswer), and only an acceptance dispatches anything to the sim,
     * where applyHail re-checks the same predicates.
     */
    private pressAssist() {
        if (!this.context?.assist) {
            return;
        }
        this.beep();
        // ONE call decides and answers (see HailCallbacks.requestAssistance);
        // the sim effect, if any, is already dispatched by the time it
        // returns, and what comes back is the line to show.
        this.apply({
            kind: 'assist', answer: this.callbacks.requestAssistance(),
        });
    }

    /**
     * The 'r' key ("recharge", the original's request-assistance key):
     * presses whatever occupies the assist button slot on the main page —
     * see {@link assistSlotAction}.
     */
    private pressAssistSlot() {
        switch (assistSlotAction(this.phase, this.context)) {
            case 'assist':
                this.pressAssist();
                break;
            case 'beg':
                this.pressBeg();
                break;
        }
    }

    private close() {
        this.closed.next();
    }

    /** Local UI beep for a button press (not the closing "Close Channel",
     * whose close beep already covers it). */
    private beep() {
        this.callbacks.playSound(HAIL_SND_BUTTON);
    }

    /** Rebuilds the scene graph for the current phase/context. */
    private async render() {
        this.content.removeChildren().forEach(child => child.destroy());
        const context = this.context;
        if (!context) {
            return;
        }
        const frame = frameFor(this.phase, context.variant);
        // Load the background so it is ready before anything is laid out on
        // it. Its size comes from hail_layout (measured off the art), not
        // from the sprite, so a slow/missing texture cannot shift the layout.
        const background = await this.displayAssets
            .spriteFromPictAsync(frame.pict);
        // Positioned by its top-left at the WHOLE-PIXEL origin the original
        // blits to (frameOrigin), not centred with anchor 0.5: an odd-width
        // frame centred that way lands on a half pixel, which blurs the art
        // and drags every glyph laid on it a pixel left.
        const { x: originX, y: originY } =
            frameOrigin(frame.width, frame.height);
        background.anchor.set(0);
        background.position.set(originX, originY);
        background.interactive = true;
        this.content.addChild(background);

        if (this.phase === 'haggle') {
            this.renderHaggle(frame, originX, originY);
        } else {
            await this.renderMain(context, frame, originX, originY);
        }
    }

    /** Places a Button by its frame-local sprite box (hail_layout's
     * coordinates are the SPRITE's left edge; a Button draws its left cap
     * ending at container.x + BUTTON_CAP_INSET). */
    private placeButton(label: string, frame: CommFrameLayout,
        originX: number, originY: number, row: number): Button {
        return new Button(this.displayAssets, label, frame.buttonWidth, {
            x: originX + frame.buttonX - BUTTON_CAP_INSET,
            y: originY + buttonRowY(frame, row),
        });
    }

    private async renderMain(context: HailContext, frame: CommFrameLayout,
        originX: number, originY: number) {
        // Layout comes from hail_layout.ts, measured off each frame's own
        // PICT art and its reference capture. The comm dialog is:
        //   - the hailed party's RESPONSE in the upper black well,
        //   - WHO they are in the lower well,
        //   - a button column under them,
        //   - their picture in the framed pane on the right.
        // (Both texts used to be stacked in the upper area with the lower
        // well left empty.)

        // Target picture on the RIGHT, fitted to the frame's image pane.
        if (context.image && frame.imagePane) {
            try {
                const image = await this.displayAssets
                    .spriteFromPictAsync(context.image);
                image.anchor.set(0.5);
                const fit = fitImage(frame.imagePane, image.width,
                    image.height);
                image.scale.set(fit.scale);
                image.position.set(originX + fit.x, originY + fit.y);
                this.content.addChild(image);
            } catch {
                // Missing pict: skip the image, keep the text.
            }
        }

        // Upper well: what they said.
        const response = new PIXI.Text(context.body, {
            ...BODY_FONT,
            wordWrapWidth: frame.responseWell.width
                - (frame.responseText.x - frame.responseWell.x) - 4,
        });
        response.position.set(originX + frame.responseText.x,
            originY + frame.responseText.y);
        this.content.addChild(response);

        // Lower well: who they are, in the reference's colours — dim labels,
        // white values, and a RED status (identityRuns). Each line is laid
        // out as a row of runs, the pen advancing by each run's own width, so
        // the block still starts at the measured infoText origin and keeps
        // the frames' 15px leading.
        if (frame.infoWell) {
            const wrapWidth = frame.infoWell.width
                - (frame.infoText.x - frame.infoWell.x) - 4;
            let y = originY + frame.infoText.y;
            for (const runs of identityRuns(context.heading)) {
                let x = originX + frame.infoText.x;
                // A single-run line can still WRAP inside the well (a long
                // pers name); a label+value line is short by construction and
                // is laid out inline, as the references show it.
                const wordWrap = runs.length === 1;
                let height = COMM_LINE_HEIGHT;
                for (const run of runs) {
                    const text = new PIXI.Text(run.text, {
                        ...HEADING_FONT, fill: run.color,
                        wordWrap, wordWrapWidth: wrapWidth,
                    });
                    text.position.set(x, y);
                    this.content.addChild(text);
                    x += text.width;
                    height = Math.max(height, text.height);
                }
                y += height;
            }
        }

        if (context.escort) {
            this.renderEscortButtons(frame, originX, originY);
            return;
        }
        this.renderCommButtons(context, frame, originX, originY);
    }

    /**
     * The ship / planet comm's button column. Every reference shows a FIXED
     * column with Greetings on top and Close Channel at the bottom; between
     * them is one OFFER SLOT — Request Assistance (request_assistance.png) or
     * Beg For Mercy (hail_hostile.png). NovaJS previously grew the column
     * from the bottom and never drew Greetings at all.
     */
    private renderCommButtons(context: HailContext, frame: CommFrameLayout,
        originX: number, originY: number) {
        const slots = commButtonSlots(context.variant, context);
        slots.forEach((slot, row) => {
            let label: string;
            let onPress: (() => void) | undefined;
            switch (slot) {
                case 'greetings':
                    label = 'Greetings';
                    onPress = () => this.pressGreetings();
                    break;
                case 'assist':
                    label = context.assist?.free
                        ? 'Request Aid (free)' : 'Request Assistance';
                    onPress = () => this.pressAssist();
                    break;
                case 'beg':
                    label = 'Beg For Mercy';
                    onPress = () => this.pressBeg();
                    break;
                case 'bribe':
                    // The original's own label for the planet offer slot
                    // (STR# 150 index 23). Same haggle page as Beg For Mercy.
                    label = 'Offer Bribe';
                    onPress = () => this.pressBeg();
                    break;
                case 'tribute':
                    // A seam: planet tribute isn't modeled. Greyed rather
                    // than omitted, so Close Channel stays on the
                    // reference's third row.
                    label = 'Demand Tribute';
                    onPress = undefined;
                    break;
                default:
                    label = 'Close Channel';
                    onPress = () => this.close();
                    break;
            }
            const button =
                this.placeButton(label, frame, originX, originY, row);
            if (onPress) {
                button.click.subscribe(onPress);
            } else {
                button.state = 'grey';
            }
            this.content.addChild(button.container);
        });
    }

    /**
     * The escort comm MANAGES a hired escort; it does not issue fleet
     * commands (that's the keyboard escort-controls' job). Per
     * hail/hail_escort.png the column reads, top to bottom: Upgrade Escort /
     * Sell Escort / Release / Close Channel. The first three depend on state
     * NovaJS does not model yet — shipyard upgrade transfer, escort resale
     * value, and per-escort release (a future per-escort-control feature) —
     * so they render GREYED with no handler (seams). The reference greys Sell
     * Escort for the same reason our three are greyed: nothing to sell.
     */
    private renderEscortButtons(frame: CommFrameLayout, originX: number,
        originY: number) {
        const seams = ['Upgrade Escort', 'Sell Escort', 'Release'];
        seams.forEach((label, row) => {
            const button =
                this.placeButton(label, frame, originX, originY, row);
            button.state = 'grey';
            this.content.addChild(button.container);
        });
        const close = this.placeButton('Close Channel', frame, originX,
            originY, seams.length);
        close.click.subscribe(() => this.close());
        this.content.addChild(close.container);
    }

    private renderHaggle(frame: CommFrameLayout, originX: number,
        originY: number) {
        const context = this.context;
        const bribe = context?.bribe;
        const what = bribe?.purpose === 'landing' ? 'land' : 'go';
        const demand = bribe
            ? `They demand ${bribe.amount.toLocaleString()} credits to let you `
            + `${what}.${bribe.canAfford ? '' : ' You cannot afford it.'}`
            : 'They refuse to negotiate.';
        const body = new PIXI.Text(demand, {
            ...BODY_FONT,
            wordWrapWidth: frame.responseWell.width
                - (frame.responseText.x - frame.responseWell.x) - 4,
        });
        body.position.set(originX + frame.responseText.x,
            originY + frame.responseText.y);
        this.content.addChild(body);

        // Two rows, as in beg_mercy.png (the original's are Lower Price /
        // Accept Price against a haggling pirate; ours pays or backs out).
        if (bribe && bribe.canAfford) {
            const pay = this.placeButton(
                `Pay ${bribe.amount.toLocaleString()} cr`, frame,
                originX, originY, 0);
            pay.click.subscribe(() => {
                this.beep();
                this.callbacks.bribe();
                // A SHIP answers and the channel stays open with Beg For
                // Mercy still in its slot; a PORT's channel closes. See
                // hailPress.
                this.apply({ kind: 'pay' });
            });
            this.content.addChild(pay.container);
        }
        const cancel =
            this.placeButton('Never Mind', frame, originX, originY, 1);
        cancel.click.subscribe(() => {
            this.beep();
            this.apply({ kind: 'cancel' });
        });
        this.content.addChild(cancel.container);
    }
}
