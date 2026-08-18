// Fine-grained regions for the hail / boarding / player-info / title-About
// sweep. Imported by scenarios.mjs and appended to its `scenarios` array.
//
// The scenarios in scenarios.mjs already cover these dialogs at frame scale
// ("is the frame in the right place?"). These add the regions that actually
// measure the LAYOUT INSIDE each frame — the individual black wells, the
// button column, the picture pane, the text table — so a wrong well, a wrong
// button pitch, or text stacked in the wrong box shows up as its own number
// instead of averaging away inside a whole-frame percentage.
//
// Every rectangle is quoted in SCREEN coordinates, derived from the frame
// origin measured by correlating the PICT art against the reference:
//
//   PICT 8511 ship comm      423x215 at (749,433)   hail/hail.png
//   PICT 8512 planet comm    540x295 at (690,393)   hail/hail_planet.png
//   PICT 8513 escort comm    424x259 at (748,411)   hail/hail_escort.png
//   PICT 8514 haggle          262x107 at (829,487)   hail/beg_mercy.png
//   PICT 8515 plunder        309x198 at (806,441)   space/board_ship.png
//   PICT 8518/8520 p-info    413x227 at (754,427)   p_properties/*.png
//
// and the well rects come out of the frame art itself (the black regions are
// painted into the PICT). See src/spaceport/hail_layout.ts for the same
// numbers as game constants, with the per-value citations.

const region = (id, label, x, y, width, height) => ({
    id, label, ref: { x, y, width, height }, ours: { x, y, width, height },
});

/** Frame-local rect -> screen rect, for a frame whose origin is (fx,fy). */
const inFrame = (fx, fy) => (id, label, x, y, width, height) =>
    region(id, label, fx + x, fy + y, width, height);

// ── Ship comm (8511) ────────────────────────────────────────────────────────
const ship = inFrame(749, 433);
const SHIP_REGIONS = [
    region('comm_frame', 'Whole 8511 frame', 749, 433, 423, 215),
    ship('comm_response_well', 'Upper well (what they said)', 9, 7, 196, 61),
    ship('comm_info_well', 'Lower well (who they are)', 33, 70, 141, 50),
    ship('comm_buttons', 'Button column (3 rows, 28px pitch)',
        21, 125, 166, 81),
    ship('comm_image_pane', 'Target picture pane', 211, 6, 207, 202),
];

// ── Planet comm (8512) ──────────────────────────────────────────────────────
const planet = inFrame(690, 393);
const PLANET_REGIONS = [
    region('commp_frame', 'Whole 8512 frame', 690, 393, 540, 295),
    planet('commp_response_well', 'Upper well', 6, 3, 204, 62),
    planet('commp_info_well', 'Lower well', 6, 78, 204, 54),
    planet('commp_buttons', 'Button column (3 rows, 30px pitch)',
        27, 184, 146, 85),
    planet('commp_image_pane', 'Planet picture pane', 218, 3, 314, 285),
];

// ── Escort comm (8513) ──────────────────────────────────────────────────────
const escort = inFrame(748, 411);
const ESCORT_REGIONS = [
    region('comme_frame', 'Whole 8513 frame', 748, 411, 424, 259),
    escort('comme_response_well', 'Upper well (Upgrade Cost / Pay)',
        5, 5, 202, 63),
    escort('comme_info_well', 'Lower well (Hired Escort: / class)',
        5, 75, 203, 56),
    escort('comme_buttons', 'Button column (4 rows, 28px pitch)',
        29, 141, 146, 109),
    escort('comme_image_pane', 'Escort picture pane', 212, 26, 204, 204),
];

// ── Plunder (8515) ──────────────────────────────────────────────────────────
const plunder = inFrame(806, 441);
const PLUNDER_REGIONS = [
    region('plunder8515_frame', 'Whole 8515 frame', 806, 441, 309, 198),
    plunder('plunder8515_well', 'Readout well', 4, 6, 299, 98),
    plunder('plunder8515_row1', 'Button row 1 (Energy/Cargo/Ammo)',
        16, 110, 277, 25),
    plunder('plunder8515_row2', 'Button row 2 (Credits/Capture Ship)',
        35, 138, 240, 25),
    plunder('plunder8515_row3', 'Button row 3 (Abort)', 91, 166, 126, 25),
];

// ── Player info (8518/8519/8520) ────────────────────────────────────────────
const pinfo = inFrame(754, 427);
const PINFO_REGIONS = [
    region('pinfo8518_frame', 'Whole 413x227 dialog', 754, 427, 413, 227),
    pinfo('pinfo8518_tabs', 'Tab row (4 pills, 100px pitch)', 7, 8, 399, 25),
    pinfo('pinfo8518_pane', 'Black content pane', 0, 40, 413, 147),
    pinfo('pinfo8518_bottom', 'Bottom strip (Done / Jettison)',
        0, 187, 413, 40),
];

/** Two runs of the same regions: with and without the picture pane, since a
 * planet/ship picture is CONTENT (which ship happens to be hailed) while the
 * pane's frame is chrome. Both are reported; only the frame/well/button
 * numbers are the fidelity signal. */
export const hailInfoScenarios = [
    {
        id: 'hail_ship_layout',
        title: 'Hail — ship comm 8511, layout inside the frame',
        description: 'The ship communications dialog measured well-by-well '
            + 'against hail/hail.png, greetings.png, request_assistance.png '
            + 'and hail_hostile.png (all the same 8511 frame). The regions '
            + 'are the frame art\'s own black wells and the button column: '
            + 'the UPPER well holds what the hailed ship SAYS and the LOWER '
            + 'well holds its identity block, which is what the two boxes are '
            + 'drawn for. The button column is a fixed Greetings / offer slot '
            + '/ Close Channel. Text CONTENT (which greeting line, which ship '
            + 'class) differs between our capture and every reference; the '
            + 'well rectangles, button pitch and picture pane do not.',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.showHail(page, {
                variant: 'ship', heading: 'Class: Terrapin',
                image: 'nova:5003', body: 'Channel open.',
                assist: { free: false },
            });
            await driver.sleep(1200);
        },
        references: [
            { name: 'hail', file: 'hail/hail.png' },
            { name: 'greetings', file: 'hail/greetings.png' },
            { name: 'request_assistance', file: 'hail/request_assistance.png' },
        ],
        regions: SHIP_REGIONS,
    },
    {
        id: 'hail_hostile_layout',
        title: 'Hail — hostile ship 8511 (Beg For Mercy in the offer slot)',
        description: 'A hostile ship comm. Same 8511 geometry; the offer slot '
            + 'holds Beg For Mercy instead of Request Assistance and the '
            + 'lower well gains the government and "Status: Hostile" lines, '
            + 'as hail_hostile.png shows them.',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.showHail(page, {
                variant: 'ship',
                heading: 'Class: Fed Destroyer\n(Federation)\nStatus: Hostile',
                image: 'nova:5003', body: 'What is it?',
                bribe: { amount: 20000, canAfford: true },
            });
            await driver.sleep(1200);
        },
        references: [
            { name: 'hail_hostile', file: 'hail/hail_hostile.png' },
        ],
        regions: SHIP_REGIONS,
    },
    {
        id: 'hail_planet_layout',
        title: 'Hail — planet comm 8512, layout inside the frame',
        description: 'The planet communications dialog against '
            + 'hail/hail_planet.png. Our planet comm has no Demand Tribute '
            + 'button (planet bribes are an unmodeled seam), so the button '
            + 'column\'s middle row is empty here — a CONTENT gap inside a '
            + 'button block whose position and pitch are measured.',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.showHail(page, {
                variant: 'planet', heading: 'Earth',
                image: 'nova:10059', body: 'Channel open to Earth.',
            });
            await driver.sleep(1200);
        },
        references: [
            { name: 'hail_planet', file: 'hail/hail_planet.png' },
        ],
        regions: PLANET_REGIONS,
    },
    {
        id: 'hail_escort_layout',
        title: 'Hail — escort comm 8513, layout inside the frame',
        description: 'The hired-escort management panel against '
            + 'hail/hail_escort.png and its three sibling captures. The whole '
            + 'identity block ("Hired Escort:" over the ship name and class) '
            + 'sits in the LOWER well as the reference stacks it; the UPPER '
            + 'well is the reference\'s Upgrade Cost / daily Pay readout, '
            + 'with the BLANK ROW between them that the reference shows (the '
            + 'resale slot, empty for a hire). Four buttons at the measured '
            + '28px pitch; Sell Escort is greyed, as the reference greys it '
            + 'for a hired escort. CONTENT gap: the wage reads 1,500 where '
            + 'the reference reads 1,100 — the one known divergence, see '
            + 'spaceport/escort_fees.ts.',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.showHail(page, {
                variant: 'escort',
                heading: 'Hired Escort:\n Terrapin\n Standard',
                image: 'nova:5003',
                body: 'Upgrade Cost: 50,000 credits\n\n'
                    + 'Pay: 1,500 credits per day',
                escort: {
                    provenance: 'hired',
                    upgrade: {
                        toShip: 'nova:137', cost: 50000, canAfford: true,
                    },
                    dailyFee: 1500,
                },
            });
            await driver.sleep(1200);
        },
        references: [
            { name: 'hail_escort', file: 'hail/hail_escort.png' },
            {
                name: 'hail_escort_upgrading',
                file: 'hail/hail_escort_upgrading.png',
            },
            {
                name: 'hail_captured_escort',
                file: 'hail/hail_captured_escort.png',
            },
            {
                name: 'sell_captured_escort',
                file: 'hail/sell_captured_escort.png',
            },
        ],
        regions: ESCORT_REGIONS,
    },
    {
        id: 'boarding_plunder_layout',
        title: 'Boarding — plunder 8515, layout inside the frame',
        description: 'The plunder dialog against space/board_ship.png, with '
            + 'the three button rows measured separately. The readout is a '
            + 'two-column table (labels at frame x=11, values at x=61, and a '
            + 'second pair for Capture Odds at x=131/207) rather than one '
            + 'space-padded string — a proportional font never aligns those. '
            + 'The Ammo button greys here exactly as in the reference (the '
            + 'victim carries no compatible ammunition).',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => { await driver.openBoarding(page); },
        references: [
            { name: 'board_ship', file: 'space/board_ship.png' },
        ],
        regions: PLUNDER_REGIONS,
    },
    {
        id: 'player_info_layout',
        title: "Player info ('p') — 413x227 frame, measured",
        description: 'The player-info dialog against all five p_properties '
            + 'references. The frame is a fixed 413x227 on every page (8518 '
            + 'at screen 754,427 and 8520 at 754,614 in each capture), so the '
            + 'tab row, content pane and bottom strip are compared as three '
            + 'separate bands. Two CONTENT differences are expected in the '
            + 'pane band and are not chrome drift: the reference pilot has '
            + 'hired escorts, so their General page carries an "Expenses: '
            + '3,300 credits per day" row that this capture (a fresh pilot '
            + 'with no escorts and no salaried ränk) correctly omits — the '
            + 'row only appears when there is something to show, see '
            + 'player_info.ts\'s budgetRows; and our Shield / Armor rows '
            + 'carry the ship\'s total points in parentheses ("100% (150)") '
            + 'where the original prints the percentage alone, a deliberate '
            + 'addition (Matthew: "let\'s put the total shields / armor next '
            + 'to Shield Status and Armor Status like we do for energy").',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => { await driver.openPlayerInfo(page); },
        references: [
            { name: 'general', file: 'p_properties/general.png' },
        ],
        regions: PINFO_REGIONS,
    },
    {
        id: 'player_info_cargo_layout',
        title: "Player info ('p') — Cargo page, measured",
        description: 'The Cargo page (greyed Cargo tab, prose listing, and '
            + 'the Jettison Cargo button beside Done when cargo is aboard) '
            + 'against p_properties/cargo.png and cargo_with_stuff.png. The '
            + 'prose pages are set at the font\'s natural 12px leading with '
            + 'blank lines between paragraphs (24px paragraph pitch), not on '
            + 'the General page\'s explicit 16px table step.',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.openPlayerInfo(page);
            await driver.clickContainer(page, 'Button:Cargo');
            await driver.sleep(500);
        },
        references: [
            { name: 'cargo', file: 'p_properties/cargo.png' },
            {
                name: 'cargo_with_stuff',
                file: 'p_properties/cargo_with_stuff.png',
            },
        ],
        regions: PINFO_REGIONS,
    },
];
