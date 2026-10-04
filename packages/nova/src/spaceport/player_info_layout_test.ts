import 'jasmine';
import {
    PINFO_BOTTOM_HEIGHT, PINFO_PROSE_LINE_HEIGHT, PINFO_PROSE_TOP,
    PINFO_SCREEN_MARGIN, PINFO_STOCK_CONTENT_HEIGHT, PINFO_TABLE_ROW_HEIGHT,
    PINFO_TABLE_TOP, PINFO_TOP_HEIGHT, playerInfoLayout, playerInfoPageLines,
    scrollPlayerInfo,
} from './player_info_layout.js';

/**
 * The player-info dialog's per-page frame (tracker #356): a prose page grows
 * the 8519 pane to fit its wrapped text, a page taller than the screen caps
 * and scrolls, and the General table keeps the stock 413x227 the
 * p_properties captures measure.
 */
describe('playerInfoLayout', () => {
    const SCREEN = 1080;
    /** Frame-local bottom of a prose page's last line box. */
    const proseBottom = (lines: number) =>
        PINFO_PROSE_TOP + lines * PINFO_PROSE_LINE_HEIGHT;

    it('keeps the measured stock frame for the General table', () => {
        const layout = playerInfoLayout(undefined, SCREEN);
        expect(layout.contentHeight).toBe(147);
        expect(layout.height).toBe(227);
        // 8518 at screen (754,427) on the 1920x1080 references: the
        // container sits at the screen centre (960,540).
        expect(layout.origin).toEqual({ x: -206, y: -113 });
        // 8520 at (754,614); Done's sprite at frame y=195.
        expect(layout.bottomY).toBe(187);
        expect(layout.buttonY).toBe(195);
        expect(layout.maxScroll).toBe(0);
        // The table's nine rows (the eight fixed ones plus the budget
        // line) all sit inside the clip.
        const lastRowBottom = PINFO_TABLE_TOP + 9 * PINFO_TABLE_ROW_HEIGHT;
        expect(lastRowBottom).toBeLessThanOrEqual(
            layout.clip.y + layout.clip.height);
    });

    it('keeps 147 for every stock-length prose page', () => {
        // extras.png's page is seven lines (heading, blank, a four-line
        // list, blank, trade-in), cargo_with_stuff.png's five; anything up
        // to the eleven lines the stock pane holds stays stock.
        for (const lines of [1, 5, 7, 11]) {
            const layout = playerInfoLayout(lines, SCREEN);
            expect(layout.contentHeight).withContext(`${lines} lines`)
                .toBe(PINFO_STOCK_CONTENT_HEIGHT);
            expect(layout.height).toBe(227);
            expect(layout.origin).toEqual({ x: -206, y: -113 });
            expect(layout.buttonY).toBe(195);
            expect(layout.maxScroll).toBe(0);
            expect(proseBottom(lines)).toBeLessThanOrEqual(layout.bottomY);
        }
    });

    it("grows to fit the screenshot's 17-line outfit list, Done below the "
        + 'last line', () => {
        // "Current extras for your ship:", blank, the 17-line list,
        // blank, "Ship trade-in value: ..." = 21 wrapped lines.
        const lines = 21;
        const layout = playerInfoLayout(lines, SCREEN);
        expect(layout.maxScroll).toBe(0);
        expect(layout.visibleLines).toBe(lines);
        expect(layout.contentHeight).toBeGreaterThan(PINFO_STOCK_CONTENT_HEIGHT);
        // Every line box ends inside the pane, above the 8520 strip and
        // so above Done (which sits 8px into the strip).
        expect(proseBottom(lines)).toBeLessThanOrEqual(layout.bottomY);
        expect(proseBottom(lines)).toBeLessThan(layout.buttonY);
        expect(layout.clip.y + layout.clip.height).toBe(layout.bottomY);
        // Snug: the pane leaves the same 5px under the text as above it.
        expect(layout.bottomY - proseBottom(lines))
            .toBe(PINFO_PROSE_TOP - PINFO_TOP_HEIGHT);
        // Still centred: the frame's middle is the container origin.
        expect(layout.height).toBe(PINFO_TOP_HEIGHT + layout.contentHeight
            + PINFO_BOTTOM_HEIGHT);
        expect(layout.origin.y).toBe(-Math.floor(layout.height / 2));
        expect(layout.origin.x).toBe(-206);
    });

    it('caps a list taller than the screen and scrolls the rest', () => {
        // An 800x600 canvas, the smallest the game runs at.
        const screen = 600;
        const lines = 60;
        const layout = playerInfoLayout(lines, screen);
        // The frame stays a margin inside the screen, top and bottom.
        expect(layout.height).toBeLessThanOrEqual(
            screen - 2 * PINFO_SCREEN_MARGIN);
        expect(-layout.origin.y).toBeLessThanOrEqual(
            screen / 2 - PINFO_SCREEN_MARGIN);
        expect(layout.visibleLines).toBeLessThan(lines);
        expect(layout.maxScroll).toBe(
            (lines - layout.visibleLines) * PINFO_PROSE_LINE_HEIGHT);
        // The clip is the line-aligned window, wholly inside the pane and
        // so above the bottom strip.
        expect(layout.clip.y).toBe(PINFO_PROSE_TOP);
        expect(layout.clip.height)
            .toBe(layout.visibleLines * PINFO_PROSE_LINE_HEIGHT);
        expect(layout.clip.y + layout.clip.height)
            .toBeLessThanOrEqual(layout.bottomY);
        // Scrolled to the end, the last line is the window's last.
        const end = scrollPlayerInfo(0, 1000, layout);
        expect(end).toBe(layout.maxScroll);
        expect(proseBottom(lines) - end)
            .toBe(layout.clip.y + layout.clip.height);
    });

    it('never shrinks below the stock pane on a tiny screen', () => {
        const layout = playerInfoLayout(40, 200);
        expect(layout.contentHeight).toBe(PINFO_STOCK_CONTENT_HEIGHT);
        expect(layout.visibleLines).toBe(11);
        expect(layout.maxScroll).toBe(29 * PINFO_PROSE_LINE_HEIGHT);
    });

    it('sizes each page on its own (per-page, not the tallest page)', () => {
        // The same open dialog, a pilot with a long outfit list: Extras
        // grows, General and a short Cargo page stay at the captures'
        // 413x227 — and flipping between them moves the tab row only by
        // the centring offset of the height difference.
        const general = playerInfoLayout(undefined, SCREEN);
        const cargo = playerInfoLayout(5, SCREEN);
        const extras = playerInfoLayout(21, SCREEN);
        expect(general.height).toBe(227);
        expect(cargo.height).toBe(227);
        expect(extras.height).toBeGreaterThan(227);
        expect(general.origin.y - extras.origin.y).toBe(
            Math.floor(extras.height / 2) - Math.floor(general.height / 2));
        expect(general.origin.x).toBe(extras.origin.x);
    });
});

describe('scrollPlayerInfo', () => {
    const layout = playerInfoLayout(60, 600);

    it('moves by whole lines and clamps to the range', () => {
        expect(scrollPlayerInfo(0, 1, layout)).toBe(PINFO_PROSE_LINE_HEIGHT);
        expect(scrollPlayerInfo(0, -3, layout)).toBe(0);
        expect(scrollPlayerInfo(layout.maxScroll, 5, layout))
            .toBe(layout.maxScroll);
    });

    it('does not scroll a page that fits', () => {
        expect(scrollPlayerInfo(0, 5, playerInfoLayout(21, 1080))).toBe(0);
    });

    it('pages by a window less one line', () => {
        expect(playerInfoPageLines(layout)).toBe(layout.visibleLines - 1);
    });
});
