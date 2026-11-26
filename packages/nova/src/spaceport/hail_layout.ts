/**
 * Geometry for the communications (hail) dialogs and the boarding dialogs,
 * kept free of PIXI so it can be measured in specs.
 *
 * Every number here was read off the 1920x1080 original-hardware captures in
 * ui_screenshots/original_macos_screenshots (hail/*.png, space/board_ship.png,
 * space/capture_assignment.png) together with the game's own PICT art. The
 * frames are PICT resources blitted 1:1 and centred on screen, so image pixels
 * ARE game pixels and a frame's own artwork fixes most of the layout:
 *
 *  - The BLACK WELLS are painted into the frame art, so their rects were read
 *    straight out of the PICT (connected dark regions), not guessed off a
 *    screenshot: e.g. 8511's response well is art x 9..204, y 7..67.
 *  - The frames' screen positions were confirmed by correlating each PICT
 *    against its reference: 8511 lands at (749,433) on hail/hail.png, 8512 at
 *    (690,393) on hail_planet.png, 8513 at (748,411) on hail_escort.png, 8514
 *    at (829,487) on beg_mercy.png, 8515 at (806,441) on board_ship.png —
 *    all `round((screen - size) / 2)`, i.e. plainly centred.
 *  - The BUTTON positions were found by template-matching the end-cap sprites
 *    (PICT 7500/7502 normal, 7506/7508 grey) in the references, which gives
 *    each pill's exact sprite box rather than the red face's bounds.
 *
 * Coordinates are FRAME-LOCAL: (0,0) is the frame art's top-left corner.
 */

export interface Rect {
    x: number; y: number; width: number; height: number;
}

/**
 * One comms frame's layout. The original's comm dialog is two stacked black
 * wells on the left with a button column beneath them and the target's picture
 * on the right:
 *
 *  - `responseWell` (upper) holds what the hailed party SAYS — "Channel open."
 *    on hail.png, "What is it?" on hail_hostile.png, the Upgrade Cost / Pay
 *    lines on hail_escort.png.
 *  - `infoWell` (lower) holds WHO they are — "Class: Terrapin" on hail.png,
 *    "Class: Fed Destroyer / (Federation) / Status: Hostile" on
 *    hail_hostile.png, "Hired Escort: / Terrapin / Standard" on
 *    hail_escort.png, "Earth / [Earth/Luna System]" on hail_planet.png.
 *
 * (NovaJS previously stacked both texts in the upper area and left the lower
 * well empty; the wells are what the art is FOR.)
 */
export interface CommFrameLayout {
    /** Fully-qualified PICT id of the frame art. */
    pict: string;
    /** The frame art's size — used to place it and everything inside it. */
    width: number;
    height: number;
    /** Upper black well: the hailed party's spoken response. */
    responseWell: Rect;
    /** Lower black well: the identity / status block, when the frame has one. */
    infoWell: Rect | null;
    /** The framed picture box on the right, when the frame has one. */
    imagePane: Rect | null;
    /** Text box origin for the response well (see {@link INK_TO_BOX}). */
    responseText: { x: number, y: number };
    /** Text box origin for the info well. */
    infoText: { x: number, y: number };
    /** Left edge of the button column's pill SPRITES. */
    buttonX: number;
    /** Top of the first button sprite. */
    buttonTop: number;
    /** Vertical pitch between button sprites. */
    buttonPitch: number;
    /** A button's tiled middle width (its rendered width is this + 2 caps). */
    buttonWidth: number;
}

/**
 * The original's leading in the comm and boarding dialogs: 15px, measured on
 * hail_escort.png (the escort's two response lines are one blank line apart,
 * ink at frame y=14 and y=44) and on the info wells (hail_escort.png's three
 * identity lines at y=84/99/113, hail_planet.png's two at y=87/101).
 *
 * NOT the mission popups' 12px pitch (see popup_layout.POPUP_LINE_HEIGHT) —
 * the same bitmap font, set looser in these dialogs.
 */
export const COMM_LINE_HEIGHT = 15;

/**
 * The comm dialogs' button captions are a LIGHTER face than our default
 * button caption (Geneva 12). On hail/hail.png the labels are thin
 * single-pixel strokes, letter-spaced: "Greetings" inks 128 px over 53x9,
 * "Request Assistance" 258 px over 109x9, where Geneva 12 inked 204 and 426
 * over 55x10 and 112x10. Geneva 10 with 1 px letter spacing keeps the
 * widths (54 and 111) at about 60% less ink; nothing in a browser draws the
 * original's unsmoothed bitmap strokes exactly.
 */
export const COMM_BUTTON_FONT = {
    fontFamily: 'Geneva', fontSize: 10, letterSpacing: 1,
} as const;

/**
 * The plunder dialog's readout is set tighter still: 14px, from
 * space/board_ship.png's Cargo / Credits / Ammo / Energy rows at frame y =
 * 28 / 42 / 56 / 70.
 */
export const PLUNDER_LINE_HEIGHT = 14;

/**
 * A PIXI text box's top sits 3px above the ink it renders, for the Geneva
 * 9.4px face at these dialogs' 14–16px leading. Measured by rendering and
 * re-reading: with the plunder title's box at frame y=10 our ink landed at
 * 13 where the reference's is at 12. (popup_layout.POPUP_TEXT_TOP encodes a
 * 2px relationship for the SAME face at its tighter 12px leading — PIXI
 * distributes the extra leading around the glyph, so the offset moves with
 * the line height.) Measurements below are quoted as the INK position seen
 * in the reference; the exported `*Text` origins already have this
 * subtracted.
 */
export const INK_TO_BOX = 3;

/**
 * Where a centred frame's top-left corner lands on the 1920x1080 screen,
 * relative to the dialog container's origin (which sits at screen centre).
 *
 * The original rounds a centred blit to whole pixels — `round((1920-w)/2)`,
 * which for an even screen dimension is exactly `960 - floor(w/2)`. All six
 * of the frames measured here confirm it: 8511 (423x215) at (749,433), 8512
 * (540x295) at (690,393), 8513 (424x259) at (748,411), 8514 (262x107) at
 * (829,487), 8515 (309x198) at (806,441) and the player-info stack (413x227)
 * at (754,427). Using the unrounded `-w/2` puts odd-width frames on a half
 * pixel, which blurs the art and shifts every glyph inside it a pixel left.
 */
export function frameOrigin(width: number, height: number):
    { x: number, y: number } {
    return { x: -Math.floor(width / 2), y: -Math.floor(height / 2) };
}

/** Ship comms — PICT 8511, 423x215. Reference: hail/hail.png (frame at
 * screen 749,433), greetings.png, request_assistance.png, hail_hostile.png. */
export const COMM_SHIP: CommFrameLayout = {
    pict: 'nova:8511',
    width: 423,
    height: 215,
    responseWell: { x: 9, y: 7, width: 196, height: 61 },
    infoWell: { x: 33, y: 70, width: 141, height: 50 },
    imagePane: { x: 211, y: 6, width: 207, height: 202 },
    // "Channel open." ink starts at frame (16,14) on hail.png.
    responseText: { x: 16, y: 14 - INK_TO_BOX },
    // "Class: Terrapin" ink starts at frame (40,78) on hail.png.
    infoText: { x: 40, y: 78 - INK_TO_BOX },
    // Three pills at frame y 125 / 153 / 181, left edge 21, sprite 166 wide
    // (= 140 + two 13px caps). Identical on hail, greetings,
    // request_assistance and hail_hostile — the ship comm's column is a
    // FIXED three rows: Greetings, the offer slot, Close Channel.
    buttonX: 21,
    buttonTop: 125,
    buttonPitch: 28,
    buttonWidth: 140,
};

/** Planet comms — PICT 8512, 540x295. Reference: hail/hail_planet.png (frame
 * at screen 690,393). */
export const COMM_PLANET: CommFrameLayout = {
    pict: 'nova:8512',
    width: 540,
    height: 295,
    responseWell: { x: 6, y: 3, width: 204, height: 62 },
    infoWell: { x: 6, y: 78, width: 204, height: 54 },
    // The pane is the starfield PAINTED INTO the PICT: its black interior,
    // inside the bevel, is frame x 222-531, y 5-287 (the first and last
    // pure-black pixels across row 150 and down column 375 of PICT 8512).
    // The stellar's sprite is centred in exactly this rect, and clipped to
    // it (stellarSpriteOrigin): Earth's 150 px frame lands at frame (302,71)
    // on hail/hail_planet.png, = 222 + 155 - 75, 5 + 141 - 75.
    imagePane: { x: 222, y: 5, width: 310, height: 283 },
    // "Channel open to Earth." ink starts at frame (10,11).
    responseText: { x: 10, y: 11 - INK_TO_BOX },
    // "Earth" / "[Earth/Luna System]" ink starts at frame (15,87).
    infoText: { x: 15, y: 87 - INK_TO_BOX },
    // Greetings / Demand Tribute / Close Channel at frame y 184 / 214 / 244,
    // left edge 27, sprite 146 wide.
    buttonX: 27,
    buttonTop: 184,
    buttonPitch: 30,
    buttonWidth: 120,
};

/** Escort comms — PICT 8513, 424x259. Reference: hail/hail_escort.png (frame
 * at screen 748,411) and the upgrading / captured / sell variants, which all
 * share this frame. */
export const COMM_ESCORT: CommFrameLayout = {
    pict: 'nova:8513',
    width: 424,
    height: 259,
    responseWell: { x: 5, y: 5, width: 202, height: 63 },
    infoWell: { x: 5, y: 75, width: 203, height: 56 },
    imagePane: { x: 212, y: 26, width: 204, height: 204 },
    // "Upgrade Cost: ..." ink starts at frame (14,14).
    responseText: { x: 14, y: 14 - INK_TO_BOX },
    // "Hired Escort:" ink starts at frame (14,84).
    infoText: { x: 14, y: 84 - INK_TO_BOX },
    // Four pills at frame y 141 / 169 / 197 / 225, left edge 29, sprite 146.
    buttonX: 29,
    buttonTop: 141,
    buttonPitch: 28,
    buttonWidth: 120,
};

/** The bribe / beg-for-mercy popup — PICT 8514, 262x107. Reference:
 * hail/beg_mercy.png, where it is drawn OVER the hostile ship comm at screen
 * (829,487). One well, no picture, two buttons. */
export const COMM_HAGGLE: CommFrameLayout = {
    pict: 'nova:8514',
    width: 262,
    height: 107,
    responseWell: { x: 4, y: 3, width: 251, height: 29 },
    infoWell: null,
    imagePane: null,
    // The demand line's ink starts at frame (11,11).
    responseText: { x: 11, y: 11 - INK_TO_BOX },
    infoText: { x: 11, y: 11 - INK_TO_BOX },
    // Two pills at frame y 39 / 74, left edge 58, sprite 146 wide.
    buttonX: 58,
    buttonTop: 39,
    buttonPitch: 35,
    buttonWidth: 120,
};

/** The buttons a comm dialog's column can hold, top to bottom. */
export type CommButton =
    'greetings' | 'assist' | 'beg' | 'bribe' | 'tribute' | 'release'
    | 'close';

/**
 * The ship and planet comms' button columns.
 *
 * SHIP (8511): three rows in every reference — Greetings on top, Close
 * Channel at the bottom, and one OFFER SLOT between them: Request Assistance
 * on request_assistance.png, Beg For Mercy on hail_hostile.png. With neither
 * on offer the slot is simply not drawn. (NovaJS grew this column from the
 * bottom and never drew Greetings at all.)
 *
 * PLANET (8512): hail_planet.png shows Greetings / Demand Tribute / Close
 * Channel — and that reference is a FRIENDLY Earth, i.e. the case where the
 * middle row has nothing better to offer. The planet column has the SAME
 * three-row shape as the ship column, with the middle row an OFFER SLOT: when
 * the port is refusing this pilot clearance and its government bargains, the
 * slot becomes "Offer Bribe" (the original's own label — STR# 150 index 23,
 * beside "Demand Tribute" at 44), exactly the way a hostile ship's slot
 * becomes "Beg For Mercy" (reference "Hail dialog keys (K5), wave 39": a
 * refused demand turned the MIDDLE row into Offer Bribe). Otherwise it is
 * Demand Tribute (#353): live when the channel offers it (`tribute`), greyed
 * otherwise, and greying rather than omitting keeps Close Channel on the
 * reference's third row instead of sliding it up.
 *
 * A stellar the pilot has DOMINATED (`tribute.kind` 'release') reads Release
 * in the middle row, and an Offer Bribe it still makes takes the TOP row
 * from Greetings (reference "Tribute (R18), wave 38 / 39": "Offer Bribe /
 * Release / Close Channel" while the dominated planet was hostile,
 * "Greetings / Release / Close Channel" otherwise).
 */
export function commButtonSlots(variant: 'ship' | 'planet' | 'escort',
    context: {
        assist?: { free: boolean }, bribe?: unknown, mercyRefused?: unknown,
        playerChannel?: { hostile: boolean },
        tribute?: { kind: 'demand' | 'release' },
    }): CommButton[] {
    if (variant === 'planet') {
        // A port that turns the bribe down flat (`mercyRefused`) still
        // offers it, and answers the press with the refusal.
        const offersBribe = !!context.bribe
            || context.mercyRefused !== undefined;
        if (context.tribute?.kind === 'release') {
            return [offersBribe ? 'bribe' : 'greetings', 'release', 'close'];
        }
        return ['greetings', offersBribe ? 'bribe' : 'tribute', 'close'];
    }
    // ANOTHER PLAYER's ship (#332): the same three rows a ship comm has,
    // the offer slot chosen by that ship's IFF like any other ship's.
    if (context.playerChannel) {
        return ['greetings',
            context.playerChannel.hostile ? 'beg' : 'assist', 'close'];
    }
    // Beg For Mercy whether the plea will be priced (`bribe`) or refused
    // (`mercyRefused`): ruling #297, every IFF-hostile ship shows it in
    // place of Request Assistance (unless its govt disables it).
    const offer = context.assist ? 'assist' as const
        : context.bribe || context.mercyRefused !== undefined
            ? 'beg' as const : undefined;
    return offer
        ? ['greetings', offer, 'close']
        : ['greetings', 'close'];
}

/**
 * The buttons the ESCORT management column holds, top to bottom. The first
 * two rows are TOGGLES: each becomes its "Cancel ..." twin while that deal
 * is queued (STR# 150 51/52 and 53/54).
 */
export type EscortButton =
    'upgradeEscort' | 'cancelUpgrade'
    | 'sellEscort' | 'cancelSale'
    | 'release' | 'close';

/** One row of the escort column: which button, and whether it is live. */
export interface EscortButtonSlot {
    slot: EscortButton;
    enabled: boolean;
}

/**
 * The ESCORT comm's button column (PICT 8513).
 *
 * FOUR FIXED ROWS in every reference — an upgrade row, a sale row, Release
 * and Close Channel — and the difference between a hired and a captured
 * escort is which of them are GREYED, never which are drawn:
 *
 *   hail/hail_escort.png           a hired Terrapin: Sell Escort greyed,
 *                                  Upgrade Escort and Release live.
 *   hail/hail_captured_escort.png  a captured Pirate Viper: all four live.
 *   hail/hail_escort_upgrading.png the same hired Terrapin with an upgrade
 *                                  QUEUED: row 1 now reads "Cancel
 *                                  Upgrade", everything else unchanged.
 *   hail/sell_captured_escort.png  the Viper with a sale queued: row 2
 *                                  reads "Cancel Sale" — and row 1 is
 *                                  still a LIVE "Upgrade Escort".
 *
 * Greying rather than omitting is the same convention the planet column
 * already uses for Demand Tribute, and here it is the original's own
 * behaviour rather than a NovaJS habit: the reference greys Sell Escort in
 * place and keeps Close Channel on the fourth row.
 *
 * The rules, in one place so the buttons and the simulation's
 * applyEscortAction cannot disagree:
 *
 *  - The UPGRADE row is "Cancel Upgrade", always live, while an upgrade is
 *    queued. Un-queueing must never be refusable — a player who has since
 *    gone broke would otherwise be stuck with a deal they cannot cancel.
 *    Otherwise it is "Upgrade Escort", offered when the class HAS an
 *    upgrade on offer (a shïp UpgradeTo whose class the player is allowed
 *    — see hail_dialog_plugin's escortUpgradeOffer) AND the player can
 *    afford its EscUpgrdCost today. An unaffordable upgrade is greyed
 *    rather than hidden, so the price in the readout above still has a
 *    button to belong to; affordability is re-checked when the deal
 *    actually settles, as the player leaves a spaceport.
 *  - The SALE row is "Cancel Sale" (always live) while a sale is queued,
 *    and otherwise "Sell Escort", offered only for a CAPTURED escort. A
 *    hired pilot's ship was never the player's to sell (player_escort.ts's
 *    provenance).
 *  - MUTUAL EXCLUSION is NOT enforced by greying: the reference above
 *    keeps Upgrade Escort live beside a queued sale. Pressing one CANCELS
 *    the other (applyEscortAction), which is what the live button means.
 *  - RELEASE and CLOSE CHANNEL are always live: letting a ship go costs
 *    nothing and needs nothing, queued deal or not — a released escort
 *    takes its unsettled deal with it, since it is no longer the player's.
 */
export function escortButtonSlots(escort: {
    provenance: 'hired' | 'captured',
    upgrade?: { canAfford: boolean },
    sell?: unknown,
    queuedDeal?: 'upgrade' | 'sale',
}): EscortButtonSlot[] {
    return [
        escort.queuedDeal === 'upgrade'
            ? { slot: 'cancelUpgrade', enabled: true }
            : {
                slot: 'upgradeEscort',
                enabled: !!escort.upgrade && escort.upgrade.canAfford,
            },
        escort.queuedDeal === 'sale'
            ? { slot: 'cancelSale', enabled: true }
            : { slot: 'sellEscort', enabled: !!escort.sell },
        { slot: 'release', enabled: true },
        { slot: 'close', enabled: true },
    ];
}

/** Frame-local top of the `index`-th button in a column. */
export function buttonRowY(frame: CommFrameLayout, index: number): number {
    return frame.buttonTop + index * frame.buttonPitch;
}

/**
 * Where the response well's text wraps: from its text origin to 4px short
 * of the well's right edge. The ship comm's well wraps at 185 px — the
 * reference's "I'm in a bad mood today, so it's going to / cost extra."
 * (hail/beg_mercy.png) breaks there — and the haggle popup's at 240.
 */
export function commWrapWidth(frame: CommFrameLayout): number {
    return frame.responseWell.width
        - (frame.responseText.x - frame.responseWell.x) - 4;
}

/**
 * How many lines of response text a frame holds above its first button, at
 * {@link COMM_LINE_HEIGHT}: the text box's bottom stays at or above the top
 * of the first pill. The haggle popup (8514) holds TWO — its box starts at
 * frame y 8 and Lower Price at 39 — which is why the ship's mood line is
 * not on it (see hail_dialog.ts's haggleText): on hail/beg_mercy.png the
 * popup says only "Pay me 20,000 credits." and the mood line stays in the
 * comm's well behind it.
 */
export function responseLinesAboveButtons(frame: CommFrameLayout): number {
    return Math.floor((frame.buttonTop - frame.responseText.y)
        / COMM_LINE_HEIGHT);
}

/**
 * Fits a target picture inside a frame's image pane: the original's ship
 * pictures fill the pane (hail.png's Terrapin reaches its edges), and
 * anything larger scales down to fit. Returns the scale and the pane's
 * centre, in frame-local coordinates. (A hailed stellar is not a picture
 * but its sprite, placed 1:1 by {@link stellarSpriteOrigin}.)
 */
export function fitImage(pane: Rect, imageWidth: number, imageHeight: number):
    { scale: number, x: number, y: number } {
    const scale = imageWidth > 0 && imageHeight > 0
        ? Math.min(pane.width / imageWidth, pane.height / imageHeight)
        : 1;
    return {
        scale: Math.min(1, scale),
        x: pane.x + pane.width / 2,
        y: pane.y + pane.height / 2,
    };
}

/**
 * Where a hailed STELLAR's sprite goes in the planet comm's pane: the
 * top-left corner, in frame-local px, of one frame of its sprite drawn
 * 1:1, its integer centre on the pane's integer centre:
 *
 *     pane.x + floor(pane.width / 2) - floor(frameWidth / 2)
 *
 * and the same down. hail/hail_planet.png shows Earth's own 150 x 150
 * sprite (rlëD 2000, ring and all, as it is drawn in space) on the PICT's
 * starfield, NOT the spöb's landscape PICT: template-matched against the
 * sprite it sits at frame (302,71) at RMSE 1.9%, i.e. unscaled:
 * 222 + 155 - 75 = 302, 5 + 141 - 75 = 71.
 *
 * MEASURED for oversized frames too (reference "Stellar hail graphic,
 * wave 23", sprite_match RMSE 0 at scale 1): a frame larger than the pane
 * keeps its 1:1 scale and is CLIPPED to the pane, never scaled. Tre'ar Vano
 * (rlëD 2062, 300 x 300) sits at frame (227,-4): 9 px cut at the top, 8 at
 * the bottom. Gladius Shipyards (rlëD 2039, 315 x 200) at (220,46): 2 px
 * cut on the left, 3 on the right, so the clip really is the 310 px
 * interior — and the 2 is why the centre is halved separately: the older
 * 222 + floor((310 - 315) / 2) put Gladius at 219, 1 px left. (Halving
 * separately is the same as centring in a 311 px pane; the reference
 * section's "pane width 311" is this rule, not a wider clip.) MEASURED
 * and closed on a second odd overflow ("Stellar hail pane, wave 28"): a
 * landable clone of Jupiter (rlëD 2005, 325 x 325) sat at frame
 * (215,-16) at RMSE 0, 222 + 155 - 162 = 215 and 5 + 141 - 162 = -16
 * (a 310 px pane centred as one would give 214).
 */
export function stellarSpriteOrigin(pane: Rect, frameWidth: number,
    frameHeight: number): { x: number, y: number } {
    return {
        x: pane.x + Math.floor(pane.width / 2) - Math.floor(frameWidth / 2),
        y: pane.y + Math.floor(pane.height / 2) - Math.floor(frameHeight / 2),
    };
}

// ── Boarding ───────────────────────────────────────────────────────────────

/**
 * The plunder frame — PICT 8515, 309x198, at screen (806,441) on
 * space/board_ship.png. One black well over a metal button block.
 *
 * (NovaJS used to lay this out against a 320x200 guess, which pushed every
 * element ~5px left and 1px up of the art it sits on.)
 */
export const PLUNDER_FRAME = {
    pict: 'nova:8515',
    width: 309,
    height: 198,
    /** The readout well, from the art: x 4..302, y 6..103. */
    well: { x: 4, y: 6, width: 299, height: 98 } as Rect,
    /** "Select what to plunder from this ship:" ink starts at frame (11,12). */
    titleText: { x: 11, y: 12 - INK_TO_BOX },
    /** The Cargo / Credits / Ammo / Energy rows start at frame y=28. */
    rowsTop: 28 - INK_TO_BOX,
    /** Row label pen x, and the value column beside it (ink at 11 and 61). */
    labelX: 11,
    valueX: 61,
    /** The second column on the Energy row: "Capture Odds:" / "13%". */
    rightLabelX: 131,
    rightValueX: 207,
};

/**
 * The plunder button grid, from template-matching the cap sprites on
 * space/board_ship.png (frame at 806,441). Three rows, 28px pitch:
 *
 *   y=110  Energy  (x=16, w=63)   Cargo (x=110, w=63)   Ammo (x=204, w=63)
 *   y=138  Credits (x=35, w=63)   Capture Ship (x=129, w=120)
 *   y=166  Abort   (x=91, w=100)
 *
 * `x`/`width` are the sprite's left edge and the tiled middle's width.
 */
export interface PlunderButtonSpec {
    action: string; label: string; x: number; y: number; width: number;
}
export const PLUNDER_BUTTONS: PlunderButtonSpec[] = [
    { action: 'plunderFuel', label: 'Energy', x: 16, y: 110, width: 63 },
    { action: 'plunderCargo', label: 'Cargo', x: 110, y: 110, width: 63 },
    { action: 'plunderAmmo', label: 'Ammo', x: 204, y: 110, width: 63 },
    { action: 'plunderCredits', label: 'Credits', x: 35, y: 138, width: 63 },
    {
        action: 'plunderCapture', label: 'Capture Ship',
        x: 129, y: 138, width: 120,
    },
    { action: 'plunderDone', label: 'Abort', x: 91, y: 166, width: 100 },
];

/**
 * The capture-assignment frame — PICT 8516, 267x128.
 *
 * PARTLY measurable only. In the original this is not a standalone dialog: it
 * is an INSET drawn over the still-open plunder dialog
 * (space/capture_assignment.png shows the plunder frame still at 806,441
 * behind it), it is sized to its text rather than blitted whole (the visible
 * inset runs screen y 483..597, 114px, against the art's 128), and it offers a
 * third choice NovaJS does not model — "Use As My Ship", the ship swap — above
 * "Use As Escort". NovaJS draws a standalone centred 8516 with Keep as Escort
 * / Release; that structural divergence is out of scope here.
 *
 * What IS pinned: the inset is horizontally centred (its edges sit at screen
 * x 827..1093, and 827 = round((1920-267)/2)), and its two pills are centred
 * in it at screen x=887 — frame-local x=60 — 120 wide with a 32px pitch.
 */
export const CAPTURE_FRAME = {
    pict: 'nova:8516',
    width: 267,
    height: 128,
    /** The question well, from the art: x 5..260, y 4..52. */
    well: { x: 5, y: 4, width: 256, height: 49 } as Rect,
    /** Question text pen, using the wells' usual ~8px inset. */
    text: { x: 14, y: 12 - INK_TO_BOX },
    /** Pills centred in the frame: x=60, 120 wide, 32px pitch. */
    buttonX: 60,
    buttonTop: 58,
    buttonPitch: 32,
    buttonWidth: 120,
};
