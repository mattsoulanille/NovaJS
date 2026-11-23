/**
 * Geometry for the landed list/detail dialogs — the mission BBS (PICT
 * 8505), the mission info dialog (8517), the trade center (8510) and the
 * bar (8503) — kept free of PIXI so it can be measured in specs.
 *
 * Every number was read off the 1920x1080 original-hardware captures in
 * ui_screenshots/original_macos_screenshots. The dialogs are PICT art
 * blitted 1:1 and centred on the screen, so image pixels ARE game pixels;
 * the coordinates below are CENTRE-ANCHORED (screen x - 960, y - 540),
 * which is exactly what the dialog containers use.
 *
 * A note on the button numbers. A `Button` of width W draws its red pill
 * face at container x+5, W+15 wide, and 5px below the container's y (the
 * end caps' bezel eats the rest of the 25px sprite). Every button
 * constant here was derived by measuring the red face in the reference
 * and inverting that: x = face.left - 5, width = face.width - 15,
 * y = face.top - 5. The relation was checked against our own captures
 * (dlg_bbs_earth__ours_full.png: x 11 / width 73 renders a face at
 * x976..1063, y615 — exactly the reference's Accept pill).
 */

/** The original's line pitch for Geneva 9 body text, everywhere. */
export const LINE_HEIGHT = 12;

/**
 * Row pitch in every list pane: the mission BBS's listings, the mission
 * info dialog's missions and the trade center's commodities all step 12px
 * (mission_bbs/earth_mission_bbs.png: ink tops at y 473/485/497/509/521;
 * trade_center/earth_trade_center.png: 442/454/466/478/490).
 */
export const ROW_HEIGHT = 12;

/** Selection-bar colour: the original's dark red (#800000), sampled in
 * every list reference (earth_mission_bbs.png x715..924, y470..481). */
export const SELECTION_COLOR = 0x800000;

/**
 * Our PIXI Geneva puts a line's cap 3px below the text box's y at
 * 9.4px/12px leading, so a row text drawn at the row's own y lands its
 * cap 3px into the row. That is where the BBS and the mission info
 * dialog put theirs (BBS row 0: bar y470..481, ink cap y473); the trade
 * center insets its rows one pixel less (bar y440, ink cap y442), so its
 * rows are drawn a pixel higher.
 */
export const ROW_TEXT_DY = 0;
export const TRADE_ROW_TEXT_DY = -1;

// ────────────────────────────────────────────────────────────────────────
// Mission BBS — PICT 8505, 510x201 (mission_bbs/*.png)
// ────────────────────────────────────────────────────────────────────────
export const BBS = {
    /**
     * The header strip: a black inset running the width of the list and
     * description panes (x715..1114, y444..458 on earth_mission_bbs.png).
     */
    headerStrip: { x: -245, y: -96, width: 400, height: 15 },
    /** The strip's caption ink starts at x719, cap top y448. */
    headerText: { x: -241, y: -95 },
    /**
     * The date is LEFT-aligned in the strip, its ink starting at x1016:
     * "Nov. 18th, 1177 NC" spans x1016..1104 on earth_mission_bbs.png
     * and "June 23rd, 1177 NC" x1016..1106 on the R8 wave-5 02-bbs.png —
     * same left edge, different right edges.
     */
    dateLeft: 56,
    /**
     * The list pane: black, twelve 12px rows (x715..924, y470..613 —
     * 144px is exactly 12 rows).
     */
    list: { x: -245, y: -70, width: 210, height: 144, rows: 12 },
    /** Row captions are inset 4px from the pane (ink at x719). */
    listTextX: 4,
    /**
     * The upper right pane holds the selected listing's NAME in large
     * type (x934..1208, y470..494 on un_shipping_mission.png; the "U" of
     * "Un. Shipping Delivery" is 13px tall, Geneva ~18).
     */
    titlePane: { x: -26, y: -70, width: 275, height: 25 },
    titleText: { x: -22, y: -65 },
    titleFontSize: 17,
    /**
     * The original's large Geneva has our glyph heights (the "F" of
     * "Ferry" spans y479..491 in both) but wider advances: "Ferry
     * Passengers to Misfire" inks x939..1177 on earth_mission_bbs.png
     * and x939..1158 in ours at 17px — 20px over 26 letter gaps.
     */
    titleLetterSpacing: 0.75,
    /**
     * The name WRAPS at the pane's width and only its first line shows:
     * "Ferry Passengers to Greenwich" reads "Ferry Passengers to" on the
     * R8 wave-5 02-bbs.png (the pane clips the second line), where the
     * shorter "Ferry Passengers to Misfire" fits whole on
     * earth_mission_bbs.png (ink x939..1177). The same width as the
     * description's wrap.
     */
    titleWrapWidth: 266,
    /**
     * The description pane below it (x934..1208, y499..593); its text is
     * inset 4px and its first line's cap lands at y503.
     */
    desc: { x: -26, y: -41, width: 275, height: 95 },
    descText: { x: -22, y: -40 },
    /** Wrap width inside the description pane (ink never passes x1200). */
    descWrapWidth: 266,
    /**
     * Accept / Leave. Red faces at x976..1063 and x1078..1165, y615..627
     * (earth_mission_bbs.png).
     */
    button: { y: 70, width: 73, accept: 11, leave: 113 },
    /** Status feedback goes in the metal below the list pane. */
    statusText: { x: -245, y: 76 },
} as const;

// ────────────────────────────────────────────────────────────────────────
// Mission info — PICT 8517, 471x155 (missions/missions_info.png)
// ────────────────────────────────────────────────────────────────────────
export const MISSION_INFO = {
    /** "Currently active missions:" strip (x734..928, y467..477). */
    headerStrip: { x: -226, y: -73, width: 195, height: 11 },
    /** Its caption ink starts at x738, cap top y469. */
    headerText: { x: -222, y: -74 },
    /**
     * The date has its own strip on the right (x1068..1188, same rows),
     * and the date is CENTRED in it: "Nov. 21st, 1177 NC" spans
     * x1084..1172, whose midpoint is the strip's midpoint (1128).
     */
    dateStrip: { x: 108, y: -73, width: 121, height: 11 },
    dateCenter: 168,
    dateText: { y: -74 },
    /** The list pane: seven 12px rows (x734..928, y487..570). */
    list: { x: -226, y: -53, width: 195, height: 84, rows: 7 },
    listTextX: 4,
    /** The briefing pane (x939..1188, y487..581); text inset 4px. */
    desc: { x: -21, y: -53, width: 250, height: 95 },
    descText: { x: -17, y: -51 },
    descWrapWidth: 241,
    /** Abort / Done: faces at x787..874 and x1020..1107, y593..605. */
    button: { y: 48, width: 73, abort: -178, done: 55 },
} as const;

// ────────────────────────────────────────────────────────────────────────
// Trade center — PICT 8510, 426x252 (trade_center/*.png)
// ────────────────────────────────────────────────────────────────────────
export const TRADE = {
    /** The main pane (x786..1135, y424..596 on earth_trade_center.png). */
    pane: { x: -174, y: -116, width: 350, height: 173 },
    /** Column header row: ink cap tops at y428, above a #404040 rule at
     * y439 that separates it from the first commodity row. */
    headerY: -115,
    /** The commodity rows start right below that rule (row 0's selection
     * bar is y440..450) and step {@link ROW_HEIGHT}. */
    listTop: -100,
    /**
     * The six standard commodities keep FIXED slots: Earth does not trade
     * Equipment, and its list leaves row 5 blank rather than closing up
     * (earth_trade_center.png shows Duranium Alloy on row 6, where Port
     * Kane — which trades all six — puts its jünk row).
     */
    standardSlots: 6,
    /**
     * Jünk / mission rows sit one pixel lower than the fixed grid would
     * put them (both references place row 6's ink cap at y515, not 514).
     */
    junkOffset: 1,
    /** Commodity name ink starts at x792. */
    nameX: -168,
    /** Held quantities are right-aligned at x1026 ("390" spans
     * x1009..1025 on 390_medical_supplies.png). */
    quantityRight: 66,
    /** The "In Hold:" / "In Fleet:" header is LEFT-aligned at x1015. */
    quantityHeaderX: 55,
    /** The Low/Med/High column is left-aligned at x1067 — the same x the
     * "Price:" header starts at. */
    tierX: 107,
    /** Prices are right-aligned at x1127 ("1125" ends at x1125). */
    priceRight: 167,
    /** A #404040 rule at y538 separates the list from the cargo summary,
     * whose first line's cap lands at y544. */
    summaryTop: 1,
    /**
     * The cargo summary's ink starts at x790, two pixels LEFT of the
     * commodity names (earth_trade_center.png, the Port Kane capture and
     * the R8 wave-5 07-trade.png all agree). Our Geneva "F"/"O" ink sits
     * a pixel right of the text origin, hence 789.
     */
    summaryX: -171,
    /**
     * The two 1px #404040 rules the game draws across the pane: under
     * the column headers (y439) and above the cargo summary (y538). Both
     * run x785..1136, a pixel past the pane on each side, on every
     * trade-center capture; they are not part of PICT 8510.
     */
    rules: { x: -175, width: 352, ys: [-101, -2] },
    ruleColor: 0x404040,
    /** The column headers are the strip grey (#c0c0c0), not white. */
    headerColor: 0xc0c0c0,
    /**
     * The strip below the main pane (x786..1135, y603..627) carries the
     * öops price-event line; its ink cap is at y607.
     */
    statusPane: { x: -174, y: 63, width: 350, height: 25 },
    statusText: { x: -170, y: 64 },
    /** Buy / Sell / Done: Buy's face is x812..899 and Done's x1024..1111,
     * y640..652; Sell sits midway between them. */
    button: { y: 95, width: 73, buy: -153, sell: -47, done: 59 },
} as const;

// ────────────────────────────────────────────────────────────────────────
// Bar — PICT 8503, 263x185 (bar/bar_earth.png, bar/bar_port_kane.png)
// ────────────────────────────────────────────────────────────────────────
export const BAR = {
    /** The description pane (x836..1081, y453..566). */
    pane: { x: -124, y: -87, width: 246, height: 114 },
    /** Its text's ink starts at x845 with the first cap at y461. */
    text: { x: -115, y: -82 },
    /**
     * The wrap limit, pinned by the two bar captures' own line breaks.
     * Wrapping both texts in our 9.4px Geneva: Port Kane's fifth line
     * ("which can not be mentioned to anyone below the") is 225px and
     * stays whole on bar/bar_port_kane.png, while Earth's first line plus
     * "Lubritorium" is 231px and breaks on bar/bar_earth.png. So the
     * limit is in 225..231; at 235 ours ran "Kane's Lubritorium" and
     * "Federation for" together and wrapped Earth's text a word late on
     * every line.
     */
    wrapWidth: 228,
    /**
     * The 2x2 button grid is NOT symmetric: the left column's pills are
     * 135px of red face (x840..974) against the right column's 88
     * (x990..1077). Rows' faces start at y578 and y607.
     */
    button: {
        columns: [-125, 25],
        widths: [120, 73],
        rows: [33, 62],
    },
} as const;

// ────────────────────────────────────────────────────────────────────────
// News — PICT 9000 / govt NewsPic, 300x230 (bar/news/*.png)
// ────────────────────────────────────────────────────────────────────────
export const NEWS = {
    /** A rule at y554 divides the header art from the text pane; the
     * first line's cap lands at y568 with its ink at x820. */
    text: { x: -140, y: 25 },
    wrapWidth: 270,
    /**
     * News items are separated by a HALF line, not a blank one: the
     * reference's second item starts 18px below the first item's last
     * line (y580 -> y598), where a blank line would be 24.
     */
    paragraphGap: 6,
} as const;

// ────────────────────────────────────────────────────────────────────────
// Gamble — PICT 8529, 470x230 (bar/gamble/*.png)
// ────────────────────────────────────────────────────────────────────────
export const GAMBLE = {
    /**
     * The four 100x100 racer PICTs (8530-8533) are blitted at natural
     * size, 115px apart: the first spans x738..837, y513..612.
     */
    slotCentersX: [-172.5, -57.5, 57.5, 172.5],
    slotCenterY: 22.5,
    slotSize: 100,
    /** Help / Cancel: faces at x859..946 and x973..1060, y626..638. */
    button: { y: 81, width: 73, help: -106, cancel: 8 },
} as const;

// ────────────────────────────────────────────────────────────────────────
// Hire escort — the shipyard frame, PICT 8501, 765x323
// (bar/hire_escort/select_escort.png)
// ────────────────────────────────────────────────────────────────────────
export const HIRE = {
    /** "Hiring Price:" / "You Have:" labels: ink at x1192, caps at y598
     * and y622 — a 24px pitch, twice the body leading. */
    label: { x: 231, y: 56 },
    labelPitch: 24,
    /** Their values start at x1264. */
    valueX: 304,
    /**
     * Info / Hire Escort / Done: faces at x836..913, x948..1045 and
     * x1063..1160, y673..685. We draw no Info button (the ship-info
     * dialog is the shipyard's), so only the last two are used.
     */
    button: { y: 128, hireWidth: 83, hire: -17, done: 98 },
} as const;

/**
 * The y of list row `index` inside a pane whose first row starts at
 * `top`. Trade-center jünk/mission rows pass `junk` to pick up the
 * original's extra pixel (see {@link TRADE.junkOffset}).
 */
export function listRowY(top: number, index: number, junk = false): number {
    return top + index * ROW_HEIGHT + (junk ? TRADE.junkOffset : 0);
}

/**
 * The trade center's row index for a good: the six standard commodities
 * keep their own slot whether or not this stellar trades them, and jünk
 * rows follow. `standardIndex` is the commodity's index in the STR# 4000
 * order, or undefined for a jünk row.
 */
export function tradeRowIndex(standardIndex: number | undefined,
    junkOrdinal: number): number {
    return standardIndex ?? TRADE.standardSlots + junkOrdinal;
}
