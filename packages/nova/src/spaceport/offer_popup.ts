import * as PIXI from 'pixi.js';
import { firstValueFrom, Observable, Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import {
    acceptOffer,
    MissionOffer,
    refuseOffer,
} from '../nova_plugin/mission_logic.js';
import { expandMissionText } from '../nova_plugin/mission_text.js';
import { makeDescTextContext, playerGender } from '../nova_plugin/desc_text.js';
import { ControlEvent } from '../nova_plugin/controls_plugin.js';
import { Button } from './button.js';
import { MenuControls } from './menu_controls.js';
import { offerSubstitutions } from './mission_offers.js';
import { playerIdentitySubs } from './player_identity.js';
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
    POPUP_BUTTON_CAP_WIDTH,
    POPUP_BUTTON_WIDTH,
    POPUP_BUTTON_X,
    POPUP_LINE_HEIGHT,
    POPUP_SCROLL_HOLD_DELAY,
    POPUP_SCROLL_HOLD_SPEED,
    POPUP_SCROLL_STEP,
    POPUP_SCROLL_X,
    POPUP_TEXT_MARGIN,
    POPUP_TEXT_TOP,
    POPUP_TOP_HEIGHT,
    POPUP_WIDTH,
    pictPopupVisibleLines,
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
    private choice = new Subject<'accept' | 'refuse'>();
    /** Scroll machinery for the current popup, when its text overflows. */
    private scroll?: {
        text: PIXI.Text,
        top: number,
        maxOffset: number,
        offset: number,
        up: Button,
        down: Button,
    };
    /** The arrow being held down, and how long it has been held. */
    private hold?: {
        direction: number,
        heldMs: number,
        tick: () => void,
    };

    /**
     * Keyboard: up/down arrows scroll a paginated popup a line at a time
     * (the same step as an arrow-button press) and 'accept' presses the
     * accept button. 'depart' (Escape / 'd', the landed UI's universal
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

    constructor(private displayAssets: DisplayAssetDataInterface,
        controlEvents?: Observable<ControlEvent>) {
        this.container.name = 'OfferPopup';
        this.container.visible = false;
        if (controlEvents) {
            this.controls = new MenuControls(controlEvents, {
                up: () => this.scrollBy(-POPUP_SCROLL_STEP),
                down: () => this.scrollBy(POPUP_SCROLL_STEP),
                accept: () => this.choice.next('accept'),
                depart: () => this.depart(),
            });
        }
        // Headless-harness hook, like window.novaHailDialog: the
        // visual-comparison scenarios raise a popup with crafted mission
        // text instead of having to reach the mission state that offers it.
        if (typeof window !== 'undefined') {
            const w = window as unknown as { novaOfferPopups?: OfferPopup[] };
            const popups = (w.novaOfferPopups ??= []);
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
        this.container.visible = false;
        this.endHold();
    }

    async show(text: string, buttons: {
        accept: string,
        refuse?: string | null,
    }, options: PopupOptions = {}): Promise<'accept' | 'refuse'> {
        this.container.removeChildren();
        this.endHold();
        this.scroll = undefined;
        this.hasRefuse = Boolean(buttons.refuse);

        if (options.pict) {
            this.buildWithPict(text, buttons, options.pict);
        } else {
            this.buildTiled(text, buttons, options.style ?? 'offer');
        }

        this.container.visible = true;
        this.controls?.bind();
        try {
            return await firstValueFrom(this.choice);
        } finally {
            this.controls?.unbind();
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
     * The up/down scroll arrows, sitting at the right of the button row
     * (the original's round chevrons — we have no art for those, so they
     * are narrow pills). Greyed at each end of the scroll range. A click
     * steps one line; holding one glides the text continuously.
     */
    private addScrollButtons(text: PIXI.Text, top: number,
        maxOffset: number, originX: number, buttonY: number) {
        // Width 0 leaves just the two end caps: the narrowest pill the
        // button art makes, closest to the original's round buttons.
        const arrow = (label: string, x: number) => new Button(
            this.displayAssets, label, 0,
            { x: originX + x - POPUP_BUTTON_CAP_WIDTH, y: buttonY });
        const up = arrow('▲', POPUP_SCROLL_X.up);
        const down = arrow('▼', POPUP_SCROLL_X.down);
        this.scroll = { text, top, maxOffset, offset: 0, up, down };
        this.bindScrollButton(up, -1);
        this.bindScrollButton(down, 1);
        this.container.addChild(up.container, down.container);
        this.refreshScrollButtons();
    }

    /**
     * Pointer plumbing for one arrow: the press itself jumps a line, and
     * holding past POPUP_SCROLL_HOLD_DELAY glides on at
     * POPUP_SCROLL_HOLD_SPEED px/s until the pointer is released.
     */
    private bindScrollButton(button: Button, direction: number) {
        // Through the Button's own press state machine (button.ts
        // pressTransition), NOT a raw pointerdown: a GREYED arrow — at the
        // top or bottom of the text — must ignore the press entirely (no
        // pressed flash, no scroll), which the raw handler bypassed.
        button.press.subscribe(() => {
            this.scrollBy(direction * POPUP_SCROLL_STEP);
            this.beginHold(direction);
        });
        button.container.on('pointerup', () => this.endHold());
        button.container.on('pointerupoutside', () => this.endHold());
    }

    private beginHold(direction: number) {
        this.endHold();
        const hold = {
            direction, heldMs: 0,
            tick: () => {
                const dt = PIXI.Ticker.shared.deltaMS;
                hold.heldMs += dt;
                if (hold.heldMs <= POPUP_SCROLL_HOLD_DELAY) {
                    return;
                }
                // Only the part of this frame past the delay glides.
                const gliding = Math.min(dt,
                    hold.heldMs - POPUP_SCROLL_HOLD_DELAY);
                this.scrollBy(direction * POPUP_SCROLL_HOLD_SPEED
                    * gliding / 1000);
            },
        };
        this.hold = hold;
        PIXI.Ticker.shared.add(hold.tick);
    }

    private endHold() {
        if (this.hold) {
            PIXI.Ticker.shared.remove(this.hold.tick);
            this.hold = undefined;
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
        this.scroll.up.state = this.scroll.offset > 0 ? 'normal' : 'grey';
        this.scroll.down.state =
            this.scroll.offset < this.scroll.maxOffset ? 'normal' : 'grey';
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

/**
 * Presents a pre-rolled list of mission offers one popup at a time (the
 * shared bar / main-spaceport offer flow). Each offer shows its expanded
 * offer text with the mïsn's custom accept/refuse labels; Accept runs
 * through the real NCB machinery (and shows the briefing text), Refuse
 * runs OnRefuse (and shows any refuse text). A cantRefuse offer shows only
 * the accept button. Mutations land in the session's working copy; the
 * caller commits.
 */
export async function presentOffers(popup: OfferPopup,
    session: MissionSession, universe: MissionUniverse,
    offers: MissionOffer[]): Promise<void> {
    const identity = await playerIdentitySubs(universe, session.shipId,
        undefined, session.state.ranks);
    for (const offer of offers) {
        // A prior accept this visit may have made the mission active.
        if (session.state.missions.has(offer.data.id)) {
            continue;
        }
        const substitutions = {
            ...offerSubstitutions(universe, session.currentDay, offer),
            ...identity,
        };
        const ctx = makeDescTextContext(session.state.bits,
            playerGender());
        const text = expandMissionText(offer.data.offerText, substitutions, ctx);
        if (!text) {
            continue;
        }
        const choice = await popup.show(text, {
            accept: offer.data.acceptButton || 'Accept',
            refuse: offer.data.flags.cantRefuse ? null
                : (offer.data.refuseButton || 'Refuse'),
        }, { pict: offer.data.offerPict, style: 'offer' });
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
            // Rebuilt against the now-active mission: <SN> (the special
            // ship name) is only picked at accept, and the briefing is
            // where stock missions use it.
            const brief = expandMissionText(offer.data.briefText, {
                ...offerSubstitutions(universe, session.currentDay, offer,
                    session.state.missions.get(offer.data.id)),
                ...identity,
            }, ctx);
            if (brief) {
                // The briefing (post-accept) text uses the generic
                // briefing frame, with its own dësc picture when set.
                await popup.show(brief, { accept: 'OK' },
                    { pict: offer.data.briefPict, style: 'briefing' });
            }
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
