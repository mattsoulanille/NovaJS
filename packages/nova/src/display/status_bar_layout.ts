/**
 * Left edge (StatusBar-container x) of the debug-button stack (Add Enemy /
 * Give 1M Credits / Clear Legal Record). Pulled left of its old x=65 by about
 * half an Add Enemy button width so the widest button (Clear Legal Record)
 * stays inside the 194px status-bar background: at x=65 it overflowed the
 * right edge, inflating the container's bounds so StatusBarResize shoved the
 * whole bar left of its intended x=1726 at 1920x1080.
 */
export const DEBUG_BUTTON_X = 35;

// ---------------------------------------------------------------------------
// PANEL TEXT GEOMETRY, measured off the original-hardware captures.
//
// Every constant below is an OFFSET INSIDE the ïntf data area it belongs to
// (the areas themselves come from the resource), read off
// ui_screenshots/original_macos_screenshots/space/*.png at 1920x1080 with
// visual_compare/output/probe_band.mjs. The reference status bar occupies
// x 1726..1919, so a status-bar-local x is (image x - 1726); the y values are
// image rows, which the bar shares because it is pinned to the top.
//
// Ink vs. box: a probe reports where the GLYPHS start, while PIXI positions a
// text BOX whose top sits ~2px above the cap line at 12px Geneva and whose
// left edge sits ~1px left of the first glyph. The constants are therefore
// (measured ink) - (that bearing), and the harness re-measures our render to
// confirm.
// ---------------------------------------------------------------------------

/** Ink starts ~2px below a PIXI text box's top at the status bar's 12px. */
const TEXT_INK_TOP = 2;
/** ...and ~1px right of its left edge. */
const TEXT_INK_LEFT = 1;

/**
 * Navigation pane: "Stellar Navigation" ink at y=257, its value at y=274.
 * Both centred lines render a pixel lower than the left-aligned panels at the
 * same nominal offset, so they carry one extra pixel of bearing.
 */
export const NAV_HEADER_Y = 257 - 254 - TEXT_INK_TOP - 1;
export const NAV_VALUE_Y = 274 - 254 - TEXT_INK_TOP - 1;

/**
 * Target pane, no target: "No Target" ink centred on y=373.5 (in_space_3),
 * i.e. 13px below the pane's own centre rather than the 30px above it the
 * panel used to use.
 */
export const NO_TARGET_CENTER_BELOW_MIDDLE = 14;
/** Target pane: the name's ink at y=337 and the class subtitle's at y=351. */
export const TARGET_NAME_Y = 337 - 330 - TEXT_INK_TOP;
export const TARGET_SUBTITLE_Y = 351 - 330 - TEXT_INK_TOP;

/**
 * The target display draws the locked ship's sprite in RED ONLY: every pixel
 * in the reference target pane is #RR0000 (probe_colors on in_space.png,
 * board_ship.png and capture_assignment.png finds no green or blue at all),
 * which a PIXI tint of 0xFF0000 reproduces exactly — it multiplies the
 * sprite's channels by (1, 0, 0), keeping the red channel and zeroing the
 * other two.
 */
export const TARGET_SPRITE_TINT = 0xFF0000;

// Cargo pane. The original's layout is FIXED, not centred-when-empty: the
// right column sits at the same x whether or not the hold has anything in it
// (compare in_space.png's empty hold with board_ship.png's five lines), and
// each readout is a DIM label plus a BRIGHT value, with no space after the
// label's colon ("Free:390").
/** Manifest lines (left column): name ink x=12, quantity ink x=50. */
export const CARGO_NAME_X = 12 - 8 - TEXT_INK_LEFT;
export const CARGO_QUANTITY_X = 50 - 8 - TEXT_INK_LEFT;
/** ...stacked from ink y=461 at a 14px pitch (board_ship.png). */
export const CARGO_LINE_Y = 461 - 458 - TEXT_INK_TOP;
export const CARGO_LINE_PITCH = 14;
/** Right column: labels' ink at x=86, the Special/Credits values' at x=96. */
export const CARGO_LABEL_X = 86 - 8 - TEXT_INK_LEFT;
export const CARGO_VALUE_X = 96 - 8 - TEXT_INK_LEFT;
/** The free-space count follows its label on the same line, ink at x=119. */
export const CARGO_FREE_VALUE_X = 119 - 8 - TEXT_INK_LEFT;
/**
 * The right column's five slots are fixed too: whether or not a "Special:"
 * mission-cargo line is present, "Credits:" stays put (in_space.png and
 * in_space_3.png put it on the same rows).
 */
export const CARGO_FREE_Y = 461 - 458 - TEXT_INK_TOP;
export const CARGO_SPECIAL_LABEL_Y = 479 - 458 - TEXT_INK_TOP;
export const CARGO_SPECIAL_VALUE_Y = 495 - 458 - TEXT_INK_TOP;
export const CARGO_CREDITS_LABEL_Y = 515 - 458 - TEXT_INK_TOP;
export const CARGO_CREDITS_VALUE_Y = 531 - 458 - TEXT_INK_TOP;
