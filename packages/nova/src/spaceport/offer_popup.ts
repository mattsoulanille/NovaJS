import * as PIXI from 'pixi.js';
import { firstValueFrom, Observable, Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import {
    acceptOffer, MissionOffer, refuseOffer, expandMissionText,
    offerAutoAccepts, offerTextBlank,
} from '../nova_plugin/missions/index.js';
import { makeDescTextContext, playerGender } from '../nova_plugin/ncb/index.js';
import { ControlEvent } from '../nova_plugin/core/index.js';
import { Button } from './button.js';
import { MenuControls } from './menu_controls.js';
import { ScrollArrow } from './scroll_arrow.js';
import { TextWheelScroller } from './grid_wheel.js';
import { enhancementEnabled } from '../enhancements.js';
import {
    autoAcceptOffer, autoAcceptedThisVisit, OfferRolls, offerSubstitutions,
    stillOffered,
} from './mission_offers.js';
import { playerIdentitySubs } from './player_identity.js';
import { PlayerNamesComponent } from '../nova_plugin/player/index.js';
import { MissionSession } from './mission_session.js';
import { MissionUniverse } from './mission_universe.js';
import {
    clampScroll,
    PICT_BUTTON_BOTTOM_GAP,
    PICT_FRAME_HEIGHT,
    PICT_FRAME_WIDTH,
    PICT_IMAGE_RECT,
    PICT_TEXT_TOP,
    PICT_TEXT_WELL,
    POPUP_BUTTON_BOTTOM_GAP,
    POPUP_BUTTON_WIDTH,
    POPUP_BUTTON_X,
    POPUP_LINE_HEIGHT,
    POPUP_SCROLL_DY,
    POPUP_SCROLL_KEY_STEP,
    POPUP_SCROLL_X,
    POPUP_TEXT_MARGIN,
    POPUP_TEXT_TOP,
    POPUP_TOP_HEIGHT,
    POPUP_WIDTH,
    pictPopupVisibleLines,
    heldScrollDistance,
    popupKeyScroll,
    PopupScrollKey,
    releasedScrollDistance,
    tiledPopupLayout,
    wrapMissionText,
} from './popup_layout.js';

// The mission-text popup frames. Two are three-part compositions whose
// middle strip tiles vertically to fit the text (top 9px, bottom 40px):
//   'offer'    — PICTs 8521/8522/8523, the mission-offer popup.
//   'briefing' — PICTs 8524/8525/8526, generic briefing / result text.
// The third is the fixed-size "desc + pict" frame (PICT 8527, 649x244),
// used when the mission text carries an accompanying picture (the dësc's
// Graphic field): text on the left, the picture on the right.
//
// All the geometry lives in popup_layout.ts, measured off the original
// hardware captures; only the art ids and the text style are here.
type PopupStyle = 'offer' | 'briefing';
const POPUP_FRAMES: Record<PopupStyle, [string, string, string]> = {
    offer: ['nova:8521', 'nova:8522', 'nova:8523'],
    briefing: ['nova:8524', 'nova:8525', 'nova:8526'],
};

const PICT_FRAME = 'nova:8527';

/** Every frame PICT a landing / venue popup can draw. */
export const OFFER_POPUP_PICTS: readonly string[] = [
    ...POPUP_FRAMES.offer, ...POPUP_FRAMES.briefing, PICT_FRAME];

// The original draws mission text in Geneva 9, a bitmap font whose advance
// widths our (outline) Geneva matches most closely a shade above 9px: at
// 9.4px every line of the sigma mission texts fits the original's line
// breaks. The 12px leading is the bitmap font's own line pitch.
const POPUP_FONT: Partial<PIXI.ITextStyle> = {
    fontFamily: 'Geneva', fontSize: 9.4, fill: 0xffffff,
    align: 'left', wordWrap: false, lineHeight: POPUP_LINE_HEIGHT,
};
// Wrap widths, measured from the references (the desc+pict frame insets its
// text column a few px more than the tiled frame does).
const POPUP_WRAP_WIDTH = 416;
const PICT_WRAP_WIDTH = 412;

/**
 * What the 'depart' control (Escape / 'd' — the landed UI's universal
 * "close this") does to a popup.
 *
 * A NOTICE — one button, e.g. the bar's "There are no ships available for
 * hire." or a mission briefing — closes exactly as its lone button would.
 * A two-button OFFER returns undefined: accept-or-refuse is a real
 * decision with consequences (a mission taken or turned down), and a key
 * that means "get me out of here" must not silently pick one of them.
 */
export function popupDepartChoice(hasRefuse: boolean):
    'accept' | undefined {
    return hasRefuse ? undefined : 'accept';
}

/**
 * How a popup was answered: by its Accept or Refuse button (or the keys
 * that press them), or WITHDRAWN from outside without an answer — the
 * player docked with an in-flight popup up ({@link OfferPopup.withdraw}).
 * A withdrawn offer is neither accepted nor refused.
 */
export type PopupChoice = 'accept' | 'refuse' | 'withdrawn';

/** Optional rendering choices for a mission-text popup. */
export interface PopupOptions {
    /** Global PICT id shown beside the text (the dësc Graphic). When set,
     * the popup uses the desc+pict frame (8527) instead of a tiled one. */
    pict?: string | null;
    /** Which tiled frame to use when there is no picture. */
    style?: PopupStyle;
}

/**
 * A modal mission-text dialog: expanded mission text with Accept / Refuse
 * buttons (using the mïsn's custom button labels when present). Renders
 * on the mission-offer frame (8521-8523), the generic briefing frame
 * (8524-8526), or — when the text carries a picture — the desc+pict
 * frame (8527) with the image beside the text. Long text scrolls in place
 * with the arrow buttons (the kont-probe reference). Pointer-driven; the
 * owner keeps its own controls unbound while a popup is up.
 */
export class OfferPopup {
    container = new PIXI.Container();
    private choice = new Subject<PopupChoice>();
    /** Scroll machinery for the current popup, when its text overflows. */
    private scroll?: {
        text: PIXI.Text,
        top: number,
        maxOffset: number,
        offset: number,
        up: ScrollArrow,
        down: ScrollArrow,
    };
    /** The arrow being held down, when it was pressed (performance.now),
     * and how far its glide has moved the text so far. */
    private hold?: {
        direction: number,
        pressedAt: number,
        moved: number,
        tick: () => void,
    };
    /** The wheel over the text ("Scroll wheel in text" enhancement). */
    private readonly wheel = new TextWheelScroller();
    /** The DOM keydown listener for the page keys, while one is bound. */
    private pageKeyListener?: (event: KeyboardEvent) => void;

    /**
     * Keyboard: up/down arrows scroll a long text 10 px a press and do not
     * repeat while held (the original's, wave 12); PageUp / PageDown /
     * Home / End page it (listenPageKeys); 'accept' and Return (the
     * default button, MenuControls.defaultButton) press the accept
     * button. 'depart' (Escape / 'd', the landed UI's universal
     * "close this") dismisses a NOTICE — a popup with only an accept
     * button, such as the bar's "There are no ships available for hire."
     * — exactly as pressing its lone button would. A two-button OFFER
     * ignores it: accept-or-refuse is a real choice, and Escape must not
     * silently pick one. Bound only while a popup is up, on the shared
     * MenuControls focus stack — so it also mutes the owner's keys, which
     * is why owners no longer need a separate empty "popup blocker".
     * Optional: a popup built without control events (the About box, the
     * headless harness) is pointer-only. Owners still hold their own
     * empty "blocker" MenuControls around a whole popup SEQUENCE, so a
     * key pressed between two consecutive popups doesn't leak through.
     */
    private controls?: MenuControls;
    /** Whether the popup now showing offers a Refuse button (see the
     * controls doc: only a one-button NOTICE is Escape-dismissable). */
    private hasRefuse = false;
    /**
     * A modal shield under the frame: a full-screen, effectively invisible
     * interactive rectangle that swallows every pointer event outside the
     * popup, exactly as FindDialog / QuantityDialog / MissionInfo / the
     * hail dialog shield themselves. Without it only the frame sprites
     * stopped PIXI's hit test, and everything of the OWNER'S screen that
     * the frame did not cover stayed clickable — the spaceport's Leave
     * pill (y 198..223) lies below every tiled popup, so a misclick there
     * during a landing popup lifted the ship off with the popup sequence
     * still running blind (review finding #28). Built once and re-added as
     * the first child of every show(), since show() clears the container.
     */
    private readonly shield: PIXI.Graphics;

    constructor(private displayAssets: DisplayAssetDataInterface,
        controlEvents?: Observable<ControlEvent>) {
        this.container.name = 'OfferPopup';
        this.container.visible = false;
        this.shield = new PIXI.Graphics()
            .beginFill(0x000000, 0.001)
            .drawRect(-4000, -4000, 8000, 8000)
            .endFill();
        this.shield.interactive = true;
        if (controlEvents) {
            this.controls = new MenuControls(controlEvents, {
                up: () => this.scrollBy(-POPUP_SCROLL_KEY_STEP),
                down: () => this.scrollBy(POPUP_SCROLL_KEY_STEP),
                accept: () => this.choice.next('accept'),
                depart: () => this.depart(),
            });
            // A held Up / Down moves the text once: no key repeat.
            this.controls.repeatableActions.delete('up');
            this.controls.repeatableActions.delete('down');
            // Return presses the accept button, the original's default:
            // Yes on a mission offer (K2, wave 5) and Okay on a notice
            // (wave 16: the empty BBS's Okay takes the next Return). Plain
            // Return only, no repeat (MenuControls.pressDefaultButton).
            this.controls.defaultButton = () => this.choice.next('accept');
        }
        // The wheel scrolls the text only with the "Scroll wheel in text"
        // enhancement on; the original's wheel does nothing here. Bound on
        // the whole popup (the shield included, which the events bubble up
        // from): PIXI only calls a container's listeners when the
        // container is itself interactive.
        this.container.eventMode = 'static';
        this.container.on('wheel', (event: PIXI.FederatedWheelEvent) => {
            const native = event.nativeEvent as WheelEvent & {
                wheelDeltaY?: number };
            this.onWheel({
                deltaX: event.deltaX, deltaY: event.deltaY,
                deltaMode: event.deltaMode, ctrlKey: event.ctrlKey,
                wheelDeltaY: typeof native?.wheelDeltaY === 'number'
                    ? native.wheelDeltaY : undefined,
                timeStamp: event.timeStamp,
            });
        });
        // Headless-harness hook, like window.novaHailDialog: the
        // visual-comparison scenarios raise a popup with crafted mission
        // text instead of having to reach the mission state that offers it.
        if (typeof window !== 'undefined') {
            const popups = (window.novaOfferPopups ??= []);
            popups.push(this);
            // Bounded: the harness only drives recent instances, and a
            // new display world is built per system transit — retaining
            // every popup ever constructed leaked their scenes (review
            // finding L5).
            if (popups.length > 4) {
                popups.splice(0, popups.length - 4);
            }
        }
    }

    /**
     * Escape / 'd' on a one-button notice: the same outcome its lone
     * button gives. A popup that also offers Refuse is left alone.
     */
    private depart() {
        const choice = popupDepartChoice(this.hasRefuse);
        if (choice) {
            this.choice.next(choice);
        }
    }

    /**
     * Takes the popup down from OUTSIDE: its owning display world is
     * being torn down (a jump that completes with a ship's offer or a
     * ship-done notice up). Releases the keyboard for good and hides the
     * popup; the pending show() is left UNSETTLED on purpose. Its answer
     * is a decision with consequences — accept runs the mission, refuse
     * runs OnRefuse — and a teardown is neither, exactly as Escape picks
     * neither on a two-button offer; and settling it would run the
     * caller's continuation (acceptShipOffer, the next offer in
     * presentOffers) against a dead world. An unsettled promise that
     * nothing holds is collected with the popup. Safe when nothing is
     * showing; the popup is destroyed right after and never shown again.
     */
    dismiss() {
        this.controls?.release();
        this.unlistenPageKeys();
        this.container.visible = false;
        this.endHold();
    }

    /**
     * Answers the popup that is up with 'withdrawn' (see PopupChoice):
     * the player docked with it over space (display/flight_overlays.ts).
     * Unlike {@link dismiss}, the popup stays usable, and its caller
     * unwinds — a pending show() left unsettled here would hold its
     * opener (the hail key's) for the rest of the world's life. No-op
     * when nothing is showing.
     */
    withdraw() {
        if (this.container.visible) {
            this.choice.next('withdrawn');
        }
    }

    /**
     * For an in-flight popup: whether a show() must come back 'withdrawn'
     * at once instead of opening, because the player is no longer in
     * flight. Its caller awaits data before it shows the popup, and a
     * landing in that gap would otherwise put the popup over the
     * spaceport after {@link withdraw} found nothing up.
     */
    withdrawnWhen?: () => boolean;

    async show(text: string, buttons: {
        accept: string,
        refuse?: string | null,
    }, options: PopupOptions = {}): Promise<PopupChoice> {
        if (this.withdrawnWhen?.()) {
            return 'withdrawn';
        }
        this.container.removeChildren();
        this.endHold();
        this.scroll = undefined;
        this.hasRefuse = Boolean(buttons.refuse);

        // Modal for the pointer as well as the keyboard (see `shield`).
        this.container.addChild(this.shield);
        if (options.pict) {
            this.buildWithPict(text, buttons, options.pict);
        } else {
            this.buildTiled(text, buttons, options.style ?? 'offer');
        }

        this.container.visible = true;
        this.controls?.bind();
        this.listenPageKeys();
        try {
            return await firstValueFrom(this.choice);
        } finally {
            this.controls?.unbind();
            this.unlistenPageKeys();
            this.container.visible = false;
            this.container.removeChildren();
            this.endHold();
            this.scroll = undefined;
        }
    }

    /**
     * The text sprite, pre-wrapped the way the original's text engine wraps
     * (see wrapMissionText) rather than by PIXI's own word wrap.
     */
    private textSprite(text: string, wrapWidth: number)
        : { sprite: PIXI.Text, lineCount: number } {
        const style = new PIXI.TextStyle(POPUP_FONT);
        const lines = wrapMissionText(text, wrapWidth,
            (s) => PIXI.TextMetrics.measureText(s, style).width);
        return {
            sprite: new PIXI.Text(lines.join('\n'), style),
            lineCount: lines.length,
        };
    }

    /** The Accept (and optional Refuse) buttons, laid out in the footer
     * band: a lone button centred, a pair at the original's offsets. */
    private addButtons(buttons: { accept: string, refuse?: string | null },
        originX: number, buttonY: number) {
        const acceptX = originX + (buttons.refuse
            ? POPUP_BUTTON_X.accept : POPUP_BUTTON_X.single);
        const accept = new Button(this.displayAssets, buttons.accept,
            POPUP_BUTTON_WIDTH, { x: acceptX, y: buttonY });
        accept.click.subscribe(() => this.choice.next('accept'));
        this.container.addChild(accept.container);
        if (buttons.refuse) {
            const refuse = new Button(this.displayAssets, buttons.refuse,
                POPUP_BUTTON_WIDTH,
                { x: originX + POPUP_BUTTON_X.refuse, y: buttonY });
            refuse.click.subscribe(() => this.choice.next('refuse'));
            this.container.addChild(refuse.container);
        }
    }

    /**
     * The up/down scroll arrows, sitting at the right of the button row:
     * the same round chevron buttons as the shops' grids (scroll_arrow.ts;
     * the R8 wave-5 bar capture 11-bar.png shows the long Charengo offer
     * with a dark up sphere and a red down one at x1091 / x1125, centred
     * on the No / Yes pills' row). Greyed at each end of the scroll range.
     * The text glides while an arrow is held (see bindScrollButton).
     */
    private addScrollButtons(text: PIXI.Text, top: number,
        maxOffset: number, originX: number, buttonY: number) {
        const arrow = (direction: 'up' | 'down', x: number) => {
            const a = new ScrollArrow(direction);
            a.container.position.set(originX + x,
                buttonY + POPUP_SCROLL_DY);
            return a;
        };
        const up = arrow('up', POPUP_SCROLL_X.up);
        const down = arrow('down', POPUP_SCROLL_X.down);
        this.scroll = { text, top, maxOffset, offset: 0, up, down };
        this.bindScrollButton(up, -1);
        this.bindScrollButton(down, 1);
        this.container.addChild(up.container, down.container);
        this.refreshScrollButtons();
    }

    /**
     * Pointer plumbing for one arrow, the original's (wave 12): the text
     * glides at POPUP_SCROLL_HOLD_SPEED from the press to the release, with
     * no jump and no delay, and a quick click still moves it
     * POPUP_SCROLL_CLICK px in all.
     */
    private bindScrollButton(button: ScrollArrow, direction: number) {
        // The arrow's own press, which a GREYED arrow -- at the top or
        // bottom of the text -- never fires (no scroll, no hold).
        button.press.subscribe(() => this.beginHold(direction));
        button.container.on('pointerup', () => this.releaseHold());
        button.container.on('pointerupoutside', () => this.releaseHold());
    }

    private beginHold(direction: number) {
        this.endHold();
        // Timed by the wall clock, not by summing frame deltas: the
        // Ticker caps a slow frame's delta, and the glide must still have
        // covered its 60 px/s when the frames catch up.
        const hold = {
            direction, pressedAt: performance.now(), moved: 0,
            tick: () => this.glideTo(hold,
                heldScrollDistance(performance.now() - hold.pressedAt)),
        };
        this.hold = hold;
        PIXI.Ticker.shared.add(hold.tick);
    }

    /** Moves a held arrow's text on to `distance` px from the press. */
    private glideTo(hold: NonNullable<OfferPopup['hold']>, distance: number) {
        this.scrollBy(hold.direction * (distance - hold.moved));
        hold.moved = distance;
    }

    /** The pointer came up: tops a quick click up to its full step, then
     * stops the glide. */
    private releaseHold() {
        const hold = this.hold;
        if (hold) {
            this.glideTo(hold,
                releasedScrollDistance(performance.now() - hold.pressedAt));
        }
        this.endHold();
    }

    private endHold() {
        if (this.hold) {
            PIXI.Ticker.shared.remove(this.hold.tick);
            this.hold = undefined;
        }
    }

    /**
     * PageUp / PageDown (250 px) and Home / End (the ends), as on the
     * original. The game's control set has no page actions (adding some
     * would change the sim's input schema for a display-only scroll), so
     * the keys are read off the DOM while this popup owns the keyboard:
     * its MenuControls are the focused surface. A popup without control
     * events (the pointer-only About box) takes no keys at all.
     */
    private listenPageKeys() {
        this.unlistenPageKeys();
        if (!this.controls || typeof document === 'undefined') {
            return;
        }
        const listener = (event: KeyboardEvent) => {
            if (!isPopupScrollKey(event.key)
                || MenuControls.focused !== this.controls) {
                return;
            }
            event.preventDefault();
            if (!event.repeat) {
                this.onPageKey(event.key);
            }
        };
        this.pageKeyListener = listener;
        document.addEventListener('keydown', listener);
    }

    private unlistenPageKeys() {
        if (this.pageKeyListener) {
            document.removeEventListener('keydown', this.pageKeyListener);
            this.pageKeyListener = undefined;
        }
    }

    /** One PageUp / PageDown / Home / End press. Public for the headless
     * harness. */
    onPageKey(key: PopupScrollKey) {
        if (!this.scroll) {
            return;
        }
        this.scrollBy(popupKeyScroll(key, this.scroll.offset,
            this.scroll.maxOffset) - this.scroll.offset);
    }

    /** One wheel event over the popup: scrolls the text with the "Scroll
     * wheel in text" enhancement on, and does nothing with it off (the
     * original). Public for the headless harness. */
    onWheel(sample: Parameters<TextWheelScroller['pixels']>[0]) {
        if (!this.scroll || !enhancementEnabled('enhTextScrollWheel')) {
            return;
        }
        const px = this.wheel.pixels(sample);
        if (px !== 0) {
            this.scrollBy(px);
        }
    }

    /**
     * Tears the popup down with its owning display world: a popup still
     * up is dismissed first (its keyboard binding and any scroll hold on
     * the shared Ticker released — see dismiss), then the display tree
     * is destroyed, children included, so the popup's Text canvases and
     * Graphics don't outlive the world (review #40). Sprite textures are
     * the asset cache's and are left alone.
     */
    destroy() {
        this.dismiss();
        this.container.destroy({ children: true });
    }

    /** Moves the text by `delta` px (positive scrolls further down). */
    private scrollBy(delta: number) {
        if (!this.scroll) {
            return;
        }
        this.scroll.offset =
            clampScroll(this.scroll.offset + delta, this.scroll.maxOffset);
        this.scroll.text.position.y = this.scroll.top - this.scroll.offset;
        this.refreshScrollButtons();
    }

    private refreshScrollButtons() {
        if (!this.scroll) {
            return;
        }
        this.scroll.up.enabled = this.scroll.offset > 0;
        this.scroll.down.enabled =
            this.scroll.offset < this.scroll.maxOffset;
    }

    /** Three-part frame (offer 8521-3 or briefing 8524-6), middle tiled
     * to the text's height; overlong text scrolls with the arrows. */
    private buildTiled(text: string, buttons: {
        accept: string, refuse?: string | null,
    }, style: PopupStyle) {
        const [topId, middleId, bottomId] = POPUP_FRAMES[style];
        const { sprite, lineCount } = this.textSprite(text, POPUP_WRAP_WIDTH);
        const layout = tiledPopupLayout(lineCount);

        // Integer origins: the frames are pixel art and the references put
        // them on whole pixels (x=740, the dialog centred on 960).
        const originX = -Math.floor(POPUP_WIDTH / 2);
        const originY = -Math.floor(layout.totalHeight / 2);

        const top = this.displayAssets.spriteFromPict(topId);
        const middle = new PIXI.TilingSprite(
            this.displayAssets.textureFromPict(middleId),
            POPUP_WIDTH, layout.middleHeight);
        const bottom = this.displayAssets.spriteFromPict(bottomId);
        top.position.set(originX, originY);
        middle.position.set(originX, originY + POPUP_TOP_HEIGHT);
        bottom.position.set(originX,
            originY + POPUP_TOP_HEIGHT + layout.middleHeight);
        top.interactive = middle.interactive = bottom.interactive = true;
        this.container.addChild(top, middle, bottom);

        const textTop = originY + POPUP_TEXT_TOP;
        sprite.position.set(originX + POPUP_TEXT_MARGIN, textTop);
        this.container.addChild(sprite);
        // Clip the text to the visible window; the arrows scroll the rest.
        const textMask = new PIXI.Graphics().beginFill(0xffffff)
            .drawRect(originX, textTop, POPUP_WIDTH, layout.windowHeight)
            .endFill();
        this.container.addChild(textMask);
        sprite.mask = textMask;

        const buttonY =
            originY + layout.totalHeight - POPUP_BUTTON_BOTTOM_GAP;
        this.addButtons(buttons, originX, buttonY);
        if (layout.maxScroll > 0) {
            this.addScrollButtons(sprite, textTop, layout.maxScroll,
                originX, buttonY);
        }
    }

    /** The fixed-size desc+pict frame (8527): text left, picture right. */
    private buildWithPict(text: string, buttons: {
        accept: string, refuse?: string | null,
    }, pict: string) {
        const originX = -Math.floor(PICT_FRAME_WIDTH / 2);
        const originY = -Math.floor(PICT_FRAME_HEIGHT / 2);

        const frame = this.displayAssets.spriteFromPict(PICT_FRAME);
        frame.position.set(originX, originY);
        frame.interactive = true;
        this.container.addChild(frame);

        const { sprite, lineCount } = this.textSprite(text, PICT_WRAP_WIDTH);
        const textTop = originY + PICT_TEXT_TOP;
        sprite.position.set(originX + POPUP_TEXT_MARGIN, textTop);
        this.container.addChild(sprite);
        const visibleLines = pictPopupVisibleLines();
        const windowHeight = visibleLines * POPUP_LINE_HEIGHT;
        const textMask = new PIXI.Graphics().beginFill(0xffffff)
            .drawRect(originX + PICT_TEXT_WELL.x, textTop,
                PICT_TEXT_WELL.width, windowHeight)
            .endFill();
        this.container.addChild(textMask);
        sprite.mask = textMask;

        // The picture, on whole pixels in the right pane's image rect and
        // scaled down only if it is bigger than that rect.
        const image = this.displayAssets.spriteFromPict(pict);
        const imageX = originX + PICT_IMAGE_RECT.x;
        const imageY = originY + PICT_IMAGE_RECT.y;
        image.position.set(imageX, imageY);
        const fit = () => {
            if (!image.texture.valid) {
                return;
            }
            const scale = Math.min(1,
                PICT_IMAGE_RECT.width / image.texture.width,
                PICT_IMAGE_RECT.height / image.texture.height);
            image.scale.set(scale);
            image.position.set(
                imageX + Math.floor(
                    (PICT_IMAGE_RECT.width - image.texture.width * scale) / 2),
                imageY + Math.floor(
                    (PICT_IMAGE_RECT.height - image.texture.height * scale) / 2));
        };
        fit();
        image.texture.baseTexture.once('loaded', fit);
        this.container.addChild(image);

        const buttonY =
            originY + PICT_FRAME_HEIGHT - PICT_BUTTON_BOTTOM_GAP;
        this.addButtons(buttons, originX, buttonY);
        if (lineCount > visibleLines) {
            this.addScrollButtons(sprite, textTop,
                (lineCount - visibleLines) * POPUP_LINE_HEIGHT,
                originX, buttonY);
        }
    }
}

/** Whether a DOM key is one of the popup's page keys. */
function isPopupScrollKey(key: string): key is PopupScrollKey {
    return key === 'PageUp' || key === 'PageDown' || key === 'Home'
        || key === 'End';
}

/**
 * The buttons a mission offer is asked with: the mïsn's own labels, or
 * Yes / No; no refuse button at all under mïsn Flags 0x0004 cantRefuse.
 * Shared by the spaceport offers (presentOffers) and the in-flight ship
 * offers (ship_mission_offer_plugin.ts).
 *
 * The defaults are the original's: the wave-40 kit's text-less mïsn 1024,
 * with blank AcceptButton / RefuseButton, came up as an empty dialog with
 * "No / Yes" (reference "A mission with no offer text (R14), wave 40"),
 * as stock offers do (wave 5's Earth bar, sigma_mission_1/
 * 1_sigma_1_offer.png). NovaJS showed Accept / Refuse.
 */
export const OFFER_ACCEPT_DEFAULT = 'Yes';
export const OFFER_REFUSE_DEFAULT = 'No';

export function offerButtons(offer: MissionOffer):
    { accept: string, refuse: string | null } {
    return {
        accept: offer.data.acceptButton || OFFER_ACCEPT_DEFAULT,
        refuse: offer.data.flags.cantRefuse ? null
            : (offer.data.refuseButton || OFFER_REFUSE_DEFAULT),
    };
}

/**
 * Presents a pre-rolled list of mission offers one popup at a time (the
 * shared bar / main-spaceport offer flow). Each offer shows its expanded
 * offer text with the mïsn's custom accept/refuse labels; Accept runs
 * through the real NCB machinery (and shows the briefing text), Refuse
 * runs OnRefuse (and shows any refuse text). A cantRefuse offer shows only
 * the accept button. Mutations land in the session's working copy; the
 * caller commits.
 *
 * An offer with NO offer text that cannot be refused (offerAutoAccepts)
 * is not asked at all: it is accepted on the spot, through the same
 * accept and the same briefing popup a click would have led to (#319;
 * ARPIA's "Death", arpia:1123, is the mission that needs it). One that
 * CAN be refused is asked in an empty dialog (R14, wave 40). `rolls` —
 * the system visit's, as the caller
 * rolled `offers` with — carries the auto-accept loop guard (see
 * mission_offers.ts autoAcceptedByVisit); without it nothing is
 * remembered.
 */
export async function presentOffers(popup: OfferPopup,
    session: MissionSession, universe: MissionUniverse,
    offers: MissionOffer[], rolls?: OfferRolls): Promise<void> {
    const identity = await playerIdentitySubs(universe, session.shipId,
        undefined, session.state.ranks,
        session.target.components.get(PlayerNamesComponent));
    // Built fresh for every text: an accept's set string moves the bits
    // the next text's conditionals read.
    const descContext = () =>
        makeDescTextContext(session.state.bits, playerGender());
    // The briefing (post-accept) text, in the generic briefing frame with
    // its own dësc picture when set. Rebuilt against the now-active
    // mission: <SN> (the special ship name) is only picked at accept, and
    // the briefing is where stock missions use it.
    const showBriefing = async (offer: MissionOffer) => {
        const brief = expandMissionText(offer.data.briefText, {
            ...offerSubstitutions(universe, session.currentDay, offer,
                session.state.bits,
                session.state.missions.get(offer.data.id)),
            ...identity,
        }, descContext());
        if (brief) {
            await popup.show(brief, { accept: 'OK' },
                { pict: offer.data.briefPict, style: 'briefing' });
        }
    };
    for (const offer of offers) {
        // A prior accept (or refuse) in this sequence may have made the
        // mission active, or falsified its availability — two mutually
        // exclusive offers must not both be put to the player
        // (stillOffered, against the working copy).
        if (!stillOffered(session, offer)) {
            continue;
        }
        if (offerAutoAccepts(offer.data)) {
            // Taken on unasked. A refusal (a prior accept filled the hold
            // or the cap) is silent: the player never saw the offer, so
            // there is no "you can't" to answer it with.
            if (!autoAcceptedThisVisit(rolls, offer.data.id)
                && autoAcceptOffer(session, offer, rolls).accepted) {
                await showBriefing(offer);
            }
            continue;
        }
        const substitutions = {
            ...offerSubstitutions(universe, session.currentDay, offer,
                session.state.bits),
            ...identity,
        };
        const ctx = descContext();
        // No offer text at all, and refusable: asked in an EMPTY dialog
        // (R14, wave 40; offerAutoAccepts).
        const blank = offerTextBlank(offer.data);
        const text = blank ? ''
            : expandMissionText(offer.data.offerText, substitutions, ctx);
        if (!text && !blank) {
            // Authored text that expands to nothing for this player (a
            // dësc made of conditionals): nothing to ask with.
            continue;
        }
        const choice = await popup.show(text, offerButtons(offer),
            { pict: offer.data.offerPict, style: 'offer' });
        if (choice === 'withdrawn') {
            // Neither answer (only an in-flight popup is ever withdrawn,
            // but a withdrawal must never read as a refusal).
            return;
        }
        if (choice === 'accept') {
            // The offer's acceptable flag was frozen when offers were
            // rolled; a prior accept this visit may have filled the hold
            // or the cap, so re-check and report cleanly.
            const result = acceptOffer(session.machinery, offer,
                session.outfits);
            if (!result.accepted) {
                await popup.show(result.reason, { accept: 'OK' });
                continue;
            }
            await showBriefing(offer);
        } else {
            refuseOffer(session.machinery, offer, session.outfits);
            const refuseText = expandMissionText(
                offer.data.refuseText, substitutions, ctx);
            if (refuseText) {
                await popup.show(refuseText, { accept: 'OK' },
                    { pict: offer.data.refusePict, style: 'briefing' });
            }
        }
    }
}
