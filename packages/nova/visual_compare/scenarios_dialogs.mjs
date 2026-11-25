// Visual-comparison scenarios for the BAR / MISSION BBS / MISSION INFO /
// TRADE CENTER dialogs and their sub-dialogs (gamble, hire escort, news,
// buy-quantity).
//
// These re-measure the dialogs' INTERIORS, not just their frames: the
// list panes, header strips, column positions, description panes and
// button rows all carry geometry that was corrected against the
// references (see src/spaceport/dialog_layout.ts, which cites every
// number). Spread into scenarios.mjs.
//
// Two things every scenario here has to do that the older frame-only
// scenarios did not:
//  - dismiss the landing mission-offer popup (`driver.dismissOfferPopup`)
//    before opening a dialog. Earth and Port Kane both offer the Sigma
//    intro mission on arrival, and the popup covers the whole dialog —
//    the pre-existing earth_bar / earth_mission_bbs / earth_trade_center
//    captures are all popup, no dialog.
//  - pin the date. The header strips show it, so scenarios that compare a
//    strip start from a save whose date matches the reference capture.

const region = (id, label, x, y, width, height) => ({
    id, label, ref: { x, y, width, height }, ours: { x, y, width, height },
});

/** The stock Earth / Sol pair the references were captured at. */
const EARTH = { planet: 'planet nova:128', system: 'nova:130' };
/** Port Kane, in Kania — the second bar / trade reference. */
const PORT_KANE = { planet: 'planet nova:137', system: 'nova:128' };

/**
 * The autopilot hook is installed a beat after `openGame`'s own wait
 * (displayWorld + app + communicator) clears, and on a loaded machine
 * that beat can outlast the settle sleep — so wait for it explicitly
 * rather than letting `landAt` trip over an undefined window.novaAutopilot.
 */
async function waitForAutopilot(page) {
    await page.waitForFunction(() => !!window.novaAutopilot,
        { timeout: 60000 });
}

/** Lands, clears the arrival mission popup, and opens one spaceport
 * button's dialog. */
function landAndOpen(where, button, container, { settle = 1200 } = {}) {
    return async (page, driver) => {
        await waitForAutopilot(page);
        await driver.landAt(page, where.planet);
        await driver.dismissOfferPopup(page);
        await driver.sleep(400);
        await driver.clickContainer(page, `Button:${button}`);
        await driver.waitForContainer(page, container);
        await driver.sleep(600);
        // The bar runs its OWN entry offers once it is up, so a second
        // sweep is needed after the dialog opens.
        await driver.dismissOfferPopup(page);
        await driver.sleep(settle);
    };
}

// ── Mission BBS (PICT 8505) ────────────────────────────────────────────
// Reference geometry (earth_mission_bbs.png, 1920x1080):
//   header strip   x715..1114  y444..458
//   list pane      x715..924   y470..613   (twelve 12px rows)
//   name pane      x934..1208  y470..494
//   description    x934..1208  y499..593
//   Accept/Leave   faces x976..1063 / x1078..1165, y615..627
const BBS_REGIONS = [
    region('bbs_header_strip', 'Header strip (caption + date)',
        715, 444, 400, 15),
    region('bbs_list_pane', 'Listing pane (12 rows)', 715, 470, 210, 144),
    region('bbs_name_pane', 'Selected listing name pane',
        934, 470, 275, 25),
    region('bbs_desc_pane', 'Description pane', 934, 499, 275, 95),
    region('bbs_button_row', 'Accept / Leave row', 965, 608, 210, 25),
    region('bbs_frame', 'Whole dialog frame', 705, 440, 510, 201),
];

// ── Mission info (PICT 8517) ───────────────────────────────────────────
const MISSION_INFO_REGIONS = [
    region('mi_header_strip', 'Active-missions strip', 734, 467, 195, 11),
    region('mi_date_strip', 'Date strip', 1068, 467, 121, 11),
    region('mi_list_pane', 'Mission list pane', 734, 487, 195, 84),
    region('mi_desc_pane', 'Briefing pane', 939, 487, 250, 95),
    region('mi_button_row', 'Abort / Done row', 775, 586, 345, 25),
    region('mi_frame', 'Whole dialog frame', 725, 463, 471, 155),
];

// ── Trade center (PICT 8510) ───────────────────────────────────────────
const TRADE_REGIONS = [
    region('trade_header_row', 'Commodity / In Hold / Price header',
        786, 424, 350, 15),
    region('trade_list_pane', 'Commodity rows', 786, 440, 350, 98),
    region('trade_summary', 'Cargo summary lines', 786, 539, 350, 57),
    region('trade_status_strip', 'Price-event strip', 786, 603, 350, 25),
    region('trade_button_row', 'Buy / Sell / Done row', 800, 635, 325, 25),
    region('trade_frame', 'Whole dialog frame', 747, 414, 426, 252),
];

// ── Bar (PICT 8503) ────────────────────────────────────────────────────
const BAR_REGIONS = [
    region('bar_text_pane', 'Description pane', 836, 453, 246, 114),
    region('bar_button_grid', 'Hire/Gamble/Holovid/Leave grid',
        830, 571, 260, 56),
    region('bar_frame', 'Whole dialog frame', 829, 448, 263, 185),
];

export const dialogScenarios = [
    {
        id: 'dlg_bbs_earth',
        title: 'Mission BBS — Earth (interior)',
        description: 'The Earth Mission BBS with its arrival popup '
            + 'dismissed, compared pane by pane against '
            + 'mission_bbs/earth_mission_bbs.png: the header strip (fixed '
            + 'STR# 2002 caption + galactic date, no credits), the '
            + 'twelve-row list pane, the selected listing\'s name pane, '
            + 'the description pane and the Accept/Leave row. The '
            + 'LISTINGS themselves are generated per pilot and differ; '
            + 'the panes\' geometry does not.',
        // The reference is dated Nov 18th 1177; ours starts Jan 1st, so
        // the date string differs by design (content, not geometry).
        params: { ship: 'nova:164', system: EARTH.system },
        hideDebug: true,
        setup: landAndOpen(EARTH, 'Mission BBS', 'MissionBoard-Mission BBS'),
        references: [
            { name: 'earth_bbs', file: 'mission_bbs/earth_mission_bbs.png' },
            { name: 'un_shipping',
                file: 'mission_bbs/un_shipping_mission.png' },
        ],
        regions: BBS_REGIONS,
    },
    {
        id: 'dlg_mission_info',
        title: 'Mission info (8517) — interior',
        description: "The 'i' dialog in flight, compared against "
            + 'missions/missions_info.png: the "Currently active '
            + 'missions:" strip, the separate centred date strip, the '
            + 'seven-row list pane, the briefing pane and the '
            + 'Abort/Done row. This pilot has no active missions, so the '
            + 'list and briefing content differ; the chrome does not.',
        params: { ship: 'nova:164', system: EARTH.system },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.pressKey(page, 'KeyI');
            await driver.waitForContainer(page, 'MissionInfo');
            await driver.sleep(1000);
        },
        references: [
            { name: 'missions_info', file: 'missions/missions_info.png' },
        ],
        regions: MISSION_INFO_REGIONS,
    },
    {
        id: 'dlg_trade_earth',
        title: 'Trade center — Earth (interior)',
        description: 'The Earth Trade Center with its arrival popup '
            + 'dismissed, compared against '
            + 'trade_center/earth_trade_center.png. The commodity rows '
            + 'keep FIXED slots for the six standard commodities — Earth '
            + 'does not trade Equipment, so row 5 is blank and the jünk '
            + 'row lands on row 6, as in the reference. The reference '
            + 'pilot has escorts ("In Fleet:", a split free-space '
            + 'readout); ours does not, so the summary wording differs '
            + '(documented gap).',
        save: {
            ship: 'nova:164', outfits: [], system: EARTH.system,
            credits: 5000000,
        },
        hideDebug: true,
        setup: landAndOpen(EARTH, 'Trade Center', 'TradeCenter'),
        references: [
            { name: 'earth_trade',
                file: 'trade_center/earth_trade_center.png' },
        ],
        regions: TRADE_REGIONS,
    },
    {
        id: 'dlg_trade_port_kane',
        title: 'Trade center — Port Kane (mission cargo + öops event)',
        description: 'Port Kane trades all six standard commodities and '
            + 'the reference pilot flies solo, so this capture matches '
            + 'the reference\'s wording exactly: "In Hold:", an "Other '
            + 'cargo: N tons of mission cargo" line and a single "Free '
            + 'cargo space" line, plus the öops price-event sentence in '
            + 'the strip below the pane.',
        save: {
            ship: 'nova:164', outfits: [], system: PORT_KANE.system,
            credits: 600000,
            cargo: [['mission:nova:700', 5]],
        },
        hideDebug: true,
        setup: landAndOpen(PORT_KANE, 'Trade Center', 'TradeCenter'),
        references: [
            { name: 'port_kane_trade',
                file: 'trade_center/trade_center_port_kane_with_mission_cargo_and_lower_cost_food_event.png' },
        ],
        regions: TRADE_REGIONS,
    },
    {
        id: 'dlg_bar_earth',
        title: 'Bar — Earth (interior)',
        description: 'The Earth bar with its arrival popup dismissed. '
            + 'Compares the description pane (Geneva 9.4/12 on the '
            + 'original\'s 12px pitch) and the 2x2 button grid, whose '
            + 'left column is deliberately wider than its right '
            + '(bar/bar_earth.png: 135px of red face against 88).',
        params: { ship: 'nova:164', system: EARTH.system },
        hideDebug: true,
        setup: landAndOpen(EARTH, 'Bar', 'Bar'),
        references: [
            { name: 'bar_earth', file: 'bar/bar_earth.png' },
        ],
        regions: BAR_REGIONS,
    },
    {
        id: 'dlg_bar_port_kane',
        title: 'Bar — Port Kane (interior)',
        description: 'The same bar chrome at a second stellar, against '
            + 'bar/bar_port_kane.png. Only the description text differs.',
        params: { ship: 'nova:164', system: PORT_KANE.system },
        hideDebug: true,
        setup: landAndOpen(PORT_KANE, 'Bar', 'Bar'),
        references: [
            { name: 'bar_port_kane', file: 'bar/bar_port_kane.png' },
        ],
        regions: BAR_REGIONS,
    },
    {
        id: 'dlg_bar_news',
        title: 'Bar — news window (Hyper News Network)',
        description: 'The Holovid button opens the news feed on the '
            + 'government\'s NewsPic (PICT 9000+). Compared against '
            + 'bar/news/*.png: the 300x230 window is centred and its '
            + 'items are separated by a HALF line (6px), not a blank '
            + 'one. The news items themselves are crön-driven and '
            + 'differ.',
        params: { ship: 'nova:164', system: EARTH.system },
        hideDebug: true,
        setup: async (page, driver) => {
            await waitForAutopilot(page);
            await driver.landAt(page, EARTH.planet);
            await driver.dismissOfferPopup(page);
            await driver.sleep(400);
            await driver.clickContainer(page, 'Button:Bar');
            await driver.waitForContainer(page, 'Bar');
            await driver.sleep(600);
            await driver.dismissOfferPopup(page);
            await driver.sleep(400);
            await driver.clickContainer(page, 'Button:Holovid');
            await driver.waitForContainer(page, 'NewsDialog');
            await driver.sleep(800);
        },
        references: [
            { name: 'news_earth',
                file: 'bar/news/Screen Shot 2026-07-25 at 12.05.14 PM.png' },
        ],
        regions: [
            region('news_frame', 'News window', 810, 425, 300, 230),
            region('news_text_pane', 'News text pane', 812, 556, 296, 96),
        ],
    },
    {
        id: 'dlg_bar_gamble',
        title: 'Bar — Galactic Racing Network (8529)',
        description: 'The Gamble button\'s racing dialog. Compared '
            + 'against bar/gamble/gamble.png: the four 100x100 racer '
            + 'PICTs (8530-8533) blitted 1:1 at 115px centres, and the '
            + 'Help / Cancel row. Our betting model differs from the '
            + 'original (which stakes a fixed 1,000 on the click), so '
            + 'only the unchosen base dialog is comparable.',
        params: { ship: 'nova:164', system: EARTH.system },
        hideDebug: true,
        setup: async (page, driver) => {
            await waitForAutopilot(page);
            await driver.landAt(page, EARTH.planet);
            await driver.dismissOfferPopup(page);
            await driver.sleep(400);
            await driver.clickContainer(page, 'Button:Bar');
            await driver.waitForContainer(page, 'Bar');
            await driver.sleep(600);
            await driver.dismissOfferPopup(page);
            await driver.sleep(400);
            await driver.clickContainer(page, 'Button:Gamble');
            await driver.waitForContainer(page, 'GambleDialog');
            await driver.sleep(900);
        },
        references: [
            { name: 'gamble', file: 'bar/gamble/gamble.png' },
        ],
        regions: [
            region('gamble_racers', 'The four racer boxes',
                730, 505, 460, 115),
            region('gamble_button_row', 'Help / Cancel row',
                845, 620, 230, 25),
            region('gamble_frame', 'Whole dialog frame',
                725, 425, 470, 230),
        ],
    },
    {
        id: 'dlg_trade_quantity',
        title: 'Trade buy — bulk quantity dialog',
        description: 'Option-clicking Buy opens the bulk quantity '
            + 'dialog. The reference (trade_center/buy_quantity.png) is '
            + 'the original\'s NATIVE macOS dialog, which ours draws '
            + 'after it: a frameless white 172x72 panel centred on the '
            + 'screen (x874..1045, y504..575), a white black-edged field '
            + 'at x983..1039, y509..530 opening with its prefill '
            + 'selected, a white Aqua Cancel and the blue default button '
            + '(x884..953 / x966..1035, y546..566). The prefill differs: '
            + 'it is the fleet\'s free tonnage (390 in the reference, '
            + 'whose pilot has more hold than this one).',
        save: {
            ship: 'nova:164', outfits: [], system: EARTH.system,
            credits: 5000000,
        },
        hideDebug: true,
        setup: async (page, driver) => {
            await waitForAutopilot(page);
            await driver.landAt(page, EARTH.planet);
            await driver.dismissOfferPopup(page);
            await driver.sleep(400);
            await driver.clickContainer(page, 'Button:Trade Center');
            await driver.waitForContainer(page, 'TradeCenter');
            await driver.sleep(900);
            // Medical Supplies (row 2) — the reference's selection.
            await driver.pressKeyN(page, 'ArrowDown', 2);
            await driver.optionClick(page, 'Button:Buy');
            await driver.waitForContainer(page, 'QuantityDialog');
            await driver.sleep(600);
        },
        references: [
            { name: 'buy_quantity', file: 'trade_center/buy_quantity.png' },
        ],
        regions: [
            region('quantity_panel', 'Quantity panel (prefill digits differ)',
                874, 504, 172, 72),
            region('quantity_buttons', 'Cancel / default button row',
                874, 544, 172, 26),
        ],
    },
    {
        id: 'dlg_bar_hire_escort',
        title: 'Bar — hire escort (shipyard frame 8501)',
        description: 'The Hire Escort dialog on the 765x323 shipyard '
            + 'frame, against bar/hire_escort/select_escort.png. The '
            + 'grid content is a per-day HireRandom roll and differs; '
            + 'the compared regions are the price labels and the button '
            + 'row. The original also carries an Info button left of '
            + 'Hire Escort, which we do not draw (no pilot-info dialog).',
        params: { ship: 'nova:164', system: EARTH.system },
        hideDebug: true,
        setup: async (page, driver) => {
            await waitForAutopilot(page);
            await driver.landAt(page, EARTH.planet);
            await driver.dismissOfferPopup(page);
            await driver.sleep(400);
            await driver.clickContainer(page, 'Button:Bar');
            await driver.waitForContainer(page, 'Bar');
            await driver.sleep(600);
            await driver.dismissOfferPopup(page);
            await driver.sleep(400);
            await driver.clickContainer(page, 'Button:Hire Escort');
            await driver.waitForContainer(page, 'HireEscortDialog');
            await driver.sleep(900);
        },
        references: [
            { name: 'select_escort',
                file: 'bar/hire_escort/select_escort.png' },
        ],
        regions: [
            region('hire_price_labels', 'Hiring Price / You Have labels',
                1188, 594, 130, 40),
            region('hire_button_row', 'Hire Escort / Done row',
                940, 668, 230, 25),
        ],
    },
];
