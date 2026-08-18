// Scenario + region definitions for the visual-comparison harness.
//
// Shipyard / outfitter / ship-info scenarios live in their own file so
// several fidelity passes can extend the harness without colliding here.
import { shopScenarios } from './scenarios_shops.mjs';
import { hailInfoScenarios } from './scenarios_hail_info.mjs';
//
// ============================================================================
// HOW TO ADD A SCENARIO
// ============================================================================
// Append an object to the `scenarios` array below:
//
//   {
//     id: 'unique_slug',
//     title: 'Human title for the report',
//     description: 'One line on what state this captures.',
//     params: { ship: 'nova:164', system: 'nova:130' },   // ?query params
//     hideDebug: true,                                     // hide FPS/AddEnemy
//     setup: async (page, driver) => { ... },              // optional: drive UI
//     references: [ { name, file } ],   // reference PNG(s), relative to REFERENCE_DIR
//     regions: [ region, ... ],
//   }
//
// A REGION is a named rectangle compared between the reference image and our
// capture. Because the game's UI chrome is either right-anchored (status bar)
// or centered (dialogs), the SAME rectangle is used on both images:
//
//   region('id', 'Label', x, y, width, height)
//
// If our render is offset from the reference, pass explicit rects instead:
//   { id, label, ref:{x,y,width,height}, ours:{x,y,width,height} }
//
// Regions are the unit that could later become a threshold assertion
// (result.diffPercent < N). This file is the only place you edit to extend
// coverage; run.mjs and report.mjs are generic.
// ============================================================================

import { hudScenarios } from './scenarios_hud.mjs';
import { dialogScenarios } from './scenarios_dialogs.mjs';

const region = (id, label, x, y, width, height) => ({
    id, label, ref: { x, y, width, height }, ours: { x, y, width, height },
});

// --- Status-bar sub-regions (right 194px column, right-anchored) -------------
// Measured: our StatusBar container sits at x=1726, width=194; the reference
// frames put the identical chrome at the same left edge.
const STATUSBAR_REGIONS = [
    region('statusbar_column', 'Full status-bar column', 1726, 0, 194, 768),
    region('statusbar_radar', 'Radar box', 1734, 8, 178, 172),
    region('statusbar_bars', 'Shield / armor / fuel bars', 1732, 202, 184, 54),
    region('statusbar_bottom_chrome', 'Lower metal chrome (text-free)', 1726, 620, 194, 145),
];

// --- Star-map dialog chrome (the nova:8509 frame, centered) ------------------
// Identical positionable chrome across every map variant: the frame border,
// the bottom button row, the right properties column and the Ports/Hazards/
// date line. Validated against map_single_jump_route.png by the `starmap`
// scenario; reused so every map reference re-measures the same coordinates.
// (The map graph, route lines, borders and mission marks inside the frame are
// dynamic/overlay content, compared only where a scenario adds an explicit
// overlay region.)
const MAP_FRAME = region('map_frame', 'Whole dialog frame', 659, 281, 603, 517);
// Starts BELOW the Navigation Hazards / date line (whose ink reaches y=764
// on both sides now that the readouts sit on the original's rows): those
// strings differ by system and by capture date, and letting them into the
// button region measured text drift as if it were button drift.
const MAP_BUTTON_ROW =
    region('map_button_row', 'Bottom button row', 660, 765, 601, 33);
const MAP_INFO_PANEL =
    region('map_info_panel', 'Right info panel (Destination/Govt/...)',
        1140, 300, 122, 420);
const MAP_BOTTOM_INFO =
    region('map_bottom_info', 'Ports / Nav hazards / date line', 668, 718, 470, 44);

// The five Preferences tabs (set_pref_1..5), captured one per scenario. The
// original's Preferences is a native macOS window placed upper-center; ours is
// a centered HTML modal with the same tab bar (Game Settings + four control
// groups) and the same toggles/bindings. The tab order matches the reference
// captures left-to-right. Placement (centered vs upper-center) and native-vs-
// HTML rendering differ — CONTENT; the structure (tabs, two-column toggles,
// binding rows, Cancel/OK) is the faithful part we verify by eye.
const PREFS_TABS = [
    { file: 'set_pref_1', label: 'Game Settings' },
    { file: 'set_pref_2', label: 'Navigation Controls' },
    { file: 'set_pref_3', label: 'Battle Controls' },
    { file: 'set_pref_4', label: 'Escort Controls' },
    { file: 'set_pref_5', label: 'Misc Controls' },
];

function prefsScenarios() {
    return PREFS_TABS.map((tab, index) => ({
        id: `title_prefs_${index + 1}`,
        title: `Title — Preferences tab: ${tab.label}`,
        description: `The Preferences dialog (novaTitle action "setPrefs") on `
            + `the "${tab.label}" tab, vs title_screen/${tab.file}.png. Native `
            + `macOS window (upper-center) vs our centered HTML modal — `
            + `CONTENT. The tab bar, two-column layout and Cancel/OK are the `
            + `structural match we care about.`,
        entry: 'title',
        params: {},
        hideDebug: false,
        setup: async (page, driver) => {
            await driver.fireTitleAction(page, 'setPrefs');
            await driver.waitForTestId(page, 'preferences-dialog');
            if (index > 0) {
                await page.click(`[data-testid="prefs-tab-${index}"]`);
            }
            await driver.sleep(400);
        },
        references: [
            { name: tab.file, file: `title_screen/${tab.file}.png` },
        ],
        regions: [
            // Reference window: x628-1291, y195-498 (measured on set_pref_1);
            // ours is a centered HTML modal (minWidth 560).
            region('prefs_modal', 'Preferences dialog area', 640, 360, 640, 360),
        ],
    }));
}

// --- The sigma mission-text popups ------------------------------------------
// Frame rectangles as measured on the references (x, y, width, height); ours
// is the same rectangle unless the reference is the shifted offer capture.
const SIGMA_POPUPS = [
    {
        id: 'sigma_offer', key: 'offer', label: 'offer (dësc 4427)',
        file: 'sigma_mission_1/1_sigma_1_offer.png',
        accept: 'Yes', refuse: 'No', style: 'offer',
        ref: { x: 740, y: 428, width: 441, height: 162 },
        // Ours is centred: 8 lines -> a 163px frame, top at 540-81. (The
        // original's is 162: its offer dialog is a pixel shorter than the
        // same-line-count briefing dialogs, which our one formula cannot be
        // both of.)
        ours: { x: 740, y: 459, width: 441, height: 163 },
    },
    {
        id: 'sigma_accept', key: 'brief', label: 'briefing (dësc 5533)',
        file: 'sigma_mission_1/2_sigma_1_accept.png',
        accept: 'Okay', style: 'briefing',
        ref: { x: 740, y: 465, width: 441, height: 151 },
    },
    {
        id: 'sigma_pickup', key: 'loadCargo', label: 'cargo pickup (dësc 7518)',
        file: 'sigma_mission_1/3_sigma_1_pick_up_cargo.png',
        accept: 'Okay', style: 'briefing',
        ref: { x: 740, y: 483, width: 441, height: 115 },
    },
    {
        id: 'sigma_return', key: 'dropOffCargo',
        label: 'cargo drop-off (dësc 8533)',
        file: 'sigma_mission_1/4_sigma_1_return.png',
        accept: 'Okay', style: 'briefing',
        ref: { x: 740, y: 447, width: 441, height: 187 },
    },
    {
        id: 'sigma_completion', key: 'completion',
        label: 'completion with pict (dësc 9533 + PICT 5003)',
        file: 'sigma_mission_1/5_sigma_1_mission_text_with_pict.png',
        accept: 'Okay', style: 'briefing', pict: 'nova:5003',
        ref: { x: 636, y: 418, width: 649, height: 244 },
    },
];

function sigmaScenarios() {
    return SIGMA_POPUPS.map((popup) => {
        const ours = popup.ours ?? { ...popup.ref };
        const dy = ours.y - popup.ref.y;
        // Sub-regions are anchored to each frame's own edges: the text well
        // (wrapping + leading) to the top, the footer band (button size,
        // spacing and position) to the bottom — so a frame that differs in
        // height by a pixel still compares its buttons like for like.
        const height = Math.min(popup.ref.height, ours.height);
        const fromTop = (id, label, x, y, width, h) => ({
            id, label,
            ref: { x: popup.ref.x + x, y: popup.ref.y + y, width, height: h },
            ours: { x: ours.x + x, y: ours.y + y, width, height: h },
        });
        const fromBottom = (id, label, x, up, width, h) => ({
            id, label,
            ref: {
                x: popup.ref.x + x,
                y: popup.ref.y + popup.ref.height - up, width, height: h,
            },
            ours: {
                x: ours.x + x, y: ours.y + ours.height - up, width, height: h,
            },
        });
        const regions = [
            {
                id: 'popup_frame', label: 'Whole popup frame',
                ref: { ...popup.ref, height },
                ours: { ...ours, height },
            },
            popup.pict
                ? fromTop('popup_text', 'Text well', 5, 4, 427, 203)
                : fromTop('popup_text', 'Text well', 5, 6, 431, height - 49),
            fromBottom('popup_buttons', 'Footer band + buttons',
                0, 40, popup.ref.width, 40),
        ];
        return {
            id: popup.id,
            title: `Sigma mission text — ${popup.label}`,
            description: `mïsn nova:555's ${popup.label} in the popup that `
                + `shows it, against ${popup.file}. Compares the frame, the `
                + `text well (wrap points and leading) and the footer band `
                + (dy ? `(our centred frame is ${dy}px below the `
                    + `reference's shifted one — see the note above). `
                    : `. `)
                + `Background differs (docked spaceport vs the original's `
                + `venue) and is outside every region.`,
            params: { ship: 'nova:164', system: 'nova:130' },
            hideDebug: true,
            setup: async (page, driver) => {
                const { SIGMA_TEXTS } = await import('./sigma_texts.mjs');
                await driver.landAt(page, 'planet nova:128');
                await driver.dismissOfferPopup(page);
                await driver.showOfferPopup(page, {
                    text: SIGMA_TEXTS[popup.key],
                    accept: popup.accept, refuse: popup.refuse ?? null,
                    pict: popup.pict ?? null, style: popup.style,
                });
            },
            references: [{ name: popup.id, file: popup.file }],
            regions,
        };
    });
}

export const scenarios = [
    {
        id: 'in_space',
        title: 'In space — status bar chrome',
        description: 'Flying in the Sol system; compare the right status-bar '
            + 'column against three reference frames. Dynamic text (target, '
            + 'credits, stellar nav) legitimately differs; the chrome should not. '
            + 'The ship is a Starbridge (nova:133) rather than the Raven the '
            + 'other scenarios fly, because the status bar now follows the '
            + "player ship's government (EVN Bible gövt Interface; see "
            + 'scenarios_hud.mjs) and these references show the DEFAULT '
            + 'civilian bar — a Raven would correctly draw the Polaris one.',
        params: { ship: 'nova:133', system: 'nova:130' },
        hideDebug: true,
        setup: null,
        references: [
            { name: 'in_space', file: 'space/in_space.png' },
            { name: 'in_space_2', file: 'space/in_space_2.png' },
            { name: 'in_space_3', file: 'space/in_space_3.png' },
            // space/board_ship.png is a flight capture with the (unimplemented)
            // boarding-plunder dialog floating over the center — we skip that
            // dialog and only compare the right status-bar column, whose chrome
            // is the same right-anchored panel as the other in-space frames.
            // Dynamic content there (target ship name, cargo readout, credits)
            // legitimately differs; the radar box / bars / metal chrome should
            // not.
            { name: 'board_ship', file: 'space/board_ship.png' },
        ],
        regions: STATUSBAR_REGIONS,
    },
    {
        id: 'starmap',
        title: 'Star map — dialog chrome & buttons',
        description: 'Star map opened over space (KeyM). Compare the dialog '
            + 'frame, button row, right info panel and bottom info line against '
            + 'map_single_jump_route.png.',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => { await driver.openStarmap(page); },
        references: [
            { name: 'map', file: 'map/map_single_jump_route.png' },
        ],
        regions: [MAP_FRAME, MAP_BUTTON_ROW, MAP_INFO_PANEL, MAP_BOTTOM_INFO],
    },
    {
        id: 'map_multi_jump_route',
        title: 'Star map — multi-jump route',
        description: 'A pinned multi-jump route (shift-click waypoints, driven '
            + 'through SystemGraph.onClickSystem). Compare the same dialog '
            + 'chrome against map_multi_jump_route.png, plus a region over the '
            + 'route-line area: the multi-jump route must render as the '
            + 'STRONGER green line (map/notes.txt). The exact pinned systems '
            + 'and the Destination readout legitimately differ from the '
            + 'reference (route lines are dynamic overlay content).',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.openStarmap(page);
            // Pin a waypoint a few hops out; expandRoute fills the gap from
            // Sol with the shortest path, drawing the strong multi-jump line.
            await driver.plotRoute(page, { hops: 3 });
            await driver.sleep(400);
        },
        references: [
            { name: 'map_multi', file: 'map/map_multi_jump_route.png' },
        ],
        regions: [
            MAP_FRAME, MAP_BUTTON_ROW,
            // The route-line band around the current system (Sol) — a
            // full-frame-style overlay check, not chrome. Route geometry is
            // dynamic; classified by eye, not by threshold.
            region('map_route_band', 'Route-line band around Sol',
                820, 470, 220, 160),
        ],
    },
    {
        id: 'map_multi_and_normal',
        title: 'Star map — multi-jump + single-jump route',
        description: 'A pinned multi-jump route AND a single-jump pick set at '
            + 'once (map/notes.txt: both may be selected; the multi route takes '
            + 'precedence and renders stronger). Compare the dialog chrome '
            + 'against multi_jump_route_and_normal_route_set.png and eyeball the '
            + 'strong-vs-weak line rendering in the route band.',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.openStarmap(page);
            // Pin a multi-jump waypoint AND set a single-jump adjacent pick.
            await driver.plotRoute(page, { hops: 3, alsoSingle: true });
            await driver.sleep(400);
        },
        references: [
            { name: 'map_multi_normal',
              file: 'map/multi_jump_route_and_normal_route_set.png' },
        ],
        regions: [
            MAP_FRAME, MAP_BUTTON_ROW,
            region('map_route_band', 'Route-line band around Sol',
                820, 470, 220, 160),
        ],
    },
    {
        id: 'map_find_system',
        title: 'Star map — Find dialog',
        description: 'The Find dialog opened from the map (map/find_system.png). '
            + 'It is drawn with Graphics (not a game PICT frame), centered on '
            + "the map like the original's native Find sheet. Compare the "
            + 'panel frame and the Cancel/Find button row. Known CONTENT '
            + "differences: the original's sheet carries the NOVA app icon at "
            + 'left and a wider field; ours omits the icon. Text is HTML/Pixi '
            + 'vs the OS sheet.',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.openStarmap(page);
            await driver.clickStarmapButton(page, 'Find');
            await driver.waitForContainer(page, 'FindDialog');
            await driver.sleep(500);
        },
        references: [
            { name: 'find_system', file: 'map/find_system.png' },
        ],
        regions: [
            // Reference white panel interior spans x818-1102, y488-592
            // (measured); the outer frame + icon column start ~x800. Ours is
            // the 300x104 panel centered on screen (x810-1110, y488-592).
            region('find_panel', 'Find dialog panel frame', 803, 484, 312, 114),
            region('find_button_row', 'Cancel / Find button row',
                820, 556, 300, 34),
        ],
    },
    {
        id: 'map_borders_off',
        title: 'Star map — borders off (baseline)',
        description: 'The map with government borders OFF (the default). The '
            + 'left button reads "Show Borders". Compare the dialog chrome '
            + 'against map/borders_off.png. The info panel / route legitimately '
            + 'differ (fresh unexplored pilot vs the reference capture).',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => { await driver.openStarmap(page); },
        references: [
            { name: 'borders_off', file: 'map/borders_off.png' },
        ],
        regions: [MAP_FRAME, MAP_BUTTON_ROW],
    },
    {
        id: 'map_govt_borders',
        title: 'Star map — government borders on',
        description: 'The map with Show Borders toggled ON (button relabels to '
            + '"Hide Borders"). Compare the dialog chrome against '
            + 'map/govt_borders.png, plus a border-blob region. Our borders are '
            + 'known-approximate translucent blobs (two concentric circles per '
            + "governed system), not the original's soft territory shading — "
            + 'classified ART.',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.openStarmap(page);
            await driver.clickStarmapButton(page, 'Show Borders');
            await driver.sleep(500);
        },
        references: [
            { name: 'govt_borders', file: 'map/govt_borders.png' },
        ],
        regions: [
            MAP_FRAME, MAP_BUTTON_ROW,
            // The button relabels to "Hide Borders" — measured on the same
            // left button as "Show Borders".
            region('map_borders_button', 'Left button ("Hide Borders")',
                668, 768, 138, 26),
            // Border-blob fill around the Sol cluster (ART, not chrome).
            region('map_border_blob', 'Government border blob (approximate ART)',
                760, 430, 260, 200),
        ],
    },
    {
        id: 'map_zoomed_out',
        title: 'Star map — zoomed out',
        description: 'The map zoomed out (the "-" button) to show a wider view, '
            + 'like map/map_zoomed_out_showing_far_away_mission.png. Compare the '
            + 'dialog chrome. The zoom-level pills and the far-away mission mark '
            + 'are dynamic/overlay content; the pill styling is a known ART gap '
            + '(skipped).',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.openStarmap(page);
            await driver.clickStarmapButton(page, '-');
            await driver.clickStarmapButton(page, '-');
            await driver.sleep(500);
        },
        references: [
            { name: 'map_zoomed_out',
              file: 'map/map_zoomed_out_showing_far_away_mission.png' },
        ],
        regions: [MAP_FRAME, MAP_BUTTON_ROW],
    },
    {
        id: 'map_over_spaceport',
        title: 'Star map — opened over the spaceport',
        description: 'The map opened with KeyM while docked at Earth '
            + '(map/map_open_over_spaceport.png). The spaceport forwards the '
            + 'map key; the starmap re-adds itself to the top of the stage so '
            + 'it draws over the docked spaceport. Compare the dialog chrome — '
            + 'it sits at the same centered position as the in-flight map. The '
            + 'status bar shows the docked state (empty radar, Stellar '
            + 'Navigation: Earth) — dynamic content.',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.landAt(page, 'planet nova:128');
            // Landing at Earth offers a mission; its popup owns the keyboard
            // and would swallow the map key (the scenario used to time out
            // waiting for a StarMap that never opened).
            await driver.dismissOfferPopup(page);
            await driver.openStarmap(page);
        },
        references: [
            { name: 'map_over_spaceport', file: 'map/map_open_over_spaceport.png' },
        ],
        regions: [MAP_FRAME, MAP_BUTTON_ROW],
    },
    {
        id: 'bbs_map_green_mark',
        title: 'Star map from BBS — selected mission (green mark)',
        description: 'The map opened (KeyM) from the Mission BBS with a mission '
            + 'selected: the original marks the selected listing\'s destination '
            + 'GREEN (cicn 15001) — mission_bbs/notes.txt. The BBS auto-selects '
            + 'the first offer, so opening the map draws the green viewed mark '
            + 'at that mission\'s destination. Compared against the '
            + 'green-mark references; the marked SYSTEM legitimately differs '
            + '(our first Earth offer vs the reference capture\'s), so the mark '
            + 'placement is a rendering check (arrow anchored above-right of the '
            + 'system dot), not a coordinate match — CONTENT. The dialog chrome '
            + 'is the measured signal.',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.landAt(page, 'planet nova:128');
            await driver.clickContainer(page, 'Button:Mission BBS');
            await driver.waitForContainer(page, 'MissionBoard-Mission BBS');
            await driver.sleep(1000);
            // The BBS forwards 'm' to open the map with the selected
            // listing's green viewed marks.
            await driver.pressKey(page, 'KeyM');
            await driver.waitForContainer(page, 'StarMap');
            await driver.sleep(1200);
        },
        references: [
            { name: 'green_mark',
              file: 'mission_bbs/selected_mission_destination_green_mark.png' },
            { name: 'un_shipping_green',
              file: 'mission_bbs/un_shipping_mission_selected_destination_green_mark.png' },
        ],
        regions: [MAP_FRAME, MAP_BUTTON_ROW],
    },
    {
        id: 'bbs_map_orange_green_mark',
        title: 'Star map from BBS — accepted (orange) + selected (green)',
        description: 'A mission accepted (its destination marked ORANGE, cicn '
            + '15000) plus a still-selected listing marked GREEN — both may '
            + 'coexist on the map (mission_bbs/notes.txt). Driven by accepting '
            + 'the first BBS offer, then opening the map (which rides the active '
            + 'orange marks alongside the selected green ones). Marked systems '
            + 'differ from the reference capture (CONTENT); the chrome is the '
            + 'measured signal and the check is that both mark colors render.',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.landAt(page, 'planet nova:128');
            await driver.clickContainer(page, 'Button:Mission BBS');
            await driver.waitForContainer(page, 'MissionBoard-Mission BBS');
            await driver.sleep(1000);
            // Accept the auto-selected first offer (adds an active mission ->
            // orange mark), then open the map.
            await driver.clickContainer(page, 'Button:Accept');
            await driver.sleep(800);
            await driver.pressKey(page, 'KeyM');
            await driver.waitForContainer(page, 'StarMap');
            await driver.sleep(1200);
        },
        references: [
            { name: 'orange_green',
              file: 'mission_bbs/accepted_un_mission_orange_mark_and_selected_mission_green_mark.png' },
        ],
        regions: [MAP_FRAME, MAP_BUTTON_ROW],
    },
    {
        id: 'earth_spaceport',
        title: 'Landed at Earth — spaceport dialog',
        description: 'Autopiloted to Earth and docked. Compare the spaceport '
            + 'dialog frame, landing PICT, title bar and both button columns '
            + 'against spaceport/earth.png.',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.landAt(page, 'planet nova:128');
            // The first landing at Earth offers the Trainee Program
            // mission; its popup covers the whole 8500 frame, so every
            // region here was measuring the popup, not the spaceport.
            await driver.dismissOfferPopup(page);
            await driver.sleep(600);
        },
        references: [
            { name: 'earth', file: 'spaceport/earth.png' },
        ],
        regions: [
            region('spaceport_frame', 'Whole dialog frame', 651, 281, 618, 522),
            region('spaceport_landing_pict', 'Landing PICT (planet/ship art)', 655, 286, 610, 268),
            region('spaceport_title', 'Stellar name title bar', 812, 578, 292, 26),
            region('spaceport_left_buttons', 'Left button column (Bar/BBS/Trade)', 658, 578, 158, 122),
            region('spaceport_right_buttons', 'Right button column (Shipyard/Outfitter/Leave)', 1122, 578, 150, 165),
        ],
    },
    {
        id: 'port_kane_spaceport',
        title: 'Landed at Port Kane — standard landscape',
        description: 'Docked at Port Kane (CustPicID -1): the landing panel '
            + 'must show the STANDARD landscape for the stellar\'s Type, the '
            + 'pre-made PICT at 10000 + Type (10034 here — the station scene), '
            + 'not a placeholder. Compare against spaceport/port_kane.png.',
        params: { ship: 'nova:164', system: 'nova:128' },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.landAt(page, 'planet nova:137');
            // As above: any landing offer would sit over the frame.
            await driver.dismissOfferPopup(page);
            await driver.sleep(600);
        },
        references: [
            { name: 'port_kane', file: 'spaceport/port_kane.png' },
        ],
        regions: [
            region('spaceport_frame', 'Whole dialog frame', 651, 281, 618, 522),
            region('spaceport_landing_pict', 'Standard landscape (station scene)', 655, 286, 610, 268),
            region('spaceport_title', 'Stellar name title bar', 812, 578, 292, 26),
            region('spaceport_left_buttons', 'Left button column (Bar/BBS/Trade)', 658, 578, 158, 122),
            region('spaceport_right_buttons', 'Right button column (Outfitter/Leave)', 1122, 578, 150, 165),
        ],
    },
    {
        id: 'player_info_general',
        title: "Player info ('p') — General page",
        description: 'The player-info dialog toggled with KeyP in flight. '
            + 'Compare the 8518/8519/8520 three-part frame, tab row and Done '
            + 'row against p_properties/general.png. Text values legitimately '
            + 'differ (date, credits, ship), as do two rows by design: the '
            + 'reference pilot\'s "Expenses: 3,300 credits per day" line is '
            + 'absent here because this pilot has no escorts and no salaried '
            + 'ränk (the line only appears when there is one), and our Shield '
            + '/ Armor rows carry the ship\'s total points in parentheses.',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => { await driver.openPlayerInfo(page); },
        references: [
            { name: 'general', file: 'p_properties/general.png' },
        ],
        regions: [
            region('pinfo_frame', 'Whole dialog frame', 753, 425, 414, 231),
            region('pinfo_tab_row', 'Tab row (General/Cargo/Extras/Honors)', 757, 429, 406, 36),
            region('pinfo_done_row', 'Bottom strip with Done', 757, 615, 406, 37),
        ],
    },
    {
        id: 'player_info_cargo',
        title: "Player info ('p') — Cargo page",
        description: 'The Cargo page: greyed Cargo tab, cargo listing, and the '
            + 'greyed Jettison Cargo button next to Done, against '
            + 'p_properties/cargo.png.',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.openPlayerInfo(page);
            await driver.clickContainer(page, 'Button:Cargo');
        },
        references: [
            { name: 'cargo', file: 'p_properties/cargo.png' },
        ],
        regions: [
            region('pinfo_frame', 'Whole dialog frame', 753, 425, 414, 231),
            region('pinfo_tab_row', 'Tab row (Cargo tab greyed)', 757, 429, 406, 36),
            region('pinfo_bottom_row', 'Jettison Cargo + Done row', 757, 615, 406, 37),
        ],
    },
    {
        id: 'earth_outfitter',
        title: 'Earth outfitter — dialog chrome',
        description: 'The outfitter opened from the Earth spaceport. Compare '
            + 'the 8502 frame, item grid pane and button row against '
            + 'outfitter/earth_outfitter.png. Item selection state and the '
            + 'info-pane text legitimately differ.',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.landAt(page, 'planet nova:128');
            // The first landing offers a mission; its popup sits over the
            // outfitter's description pane and button row and swamped
            // every region here until it was dismissed (as the sibling
            // earth_shipyard scenario already did).
            await driver.dismissOfferPopup(page);
            await driver.clickContainer(page, 'Button:Outfitter');
            await driver.waitForContainer(page, 'Outfitter');
            await driver.sleep(1500);
        },
        references: [
            { name: 'earth_outfitter', file: 'outfitter/earth_outfitter.png' },
        ],
        regions: [
            region('outfitter_frame', 'Whole dialog frame', 578, 380, 765, 321),
            region('outfitter_grid', 'Item grid pane', 585, 388, 335, 278),
            region('outfitter_button_row', 'Buy/Sell/Done button row', 660, 668, 520, 30),
        ],
    },
    {
        id: 'earth_shipyard',
        title: 'Earth shipyard — browse pane and price readout',
        description: 'The shipyard opened from the Earth spaceport, with a '
            + 'ship selected so the price pane under the ship picture is '
            + 'filled in. Compare the 8502 frame and the price pane against '
            + 'shipyard/earth_spaceport.png, whose pane reads "Ship Price: / '
            + 'Trade-In: / Final Price: / You Have:". The label column and '
            + 'row rhythm should line up; the AMOUNTS legitimately differ '
            + "(the reference pilot flies a different ship with a different "
            + 'balance, and the selected ship is whichever tile the grid '
            + 'lands on here), as does the ship picture and description.',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.landAt(page, 'planet nova:128');
            // The first landing offers a mission; its popup would sit
            // over the browse pane.
            await driver.dismissOfferPopup(page);
            await driver.clickContainer(page, 'Button:Shipyard');
            await driver.waitForContainer(page, 'Shipyard');
            await driver.pressKey(page, 'ArrowRight'); // select a ship
            await driver.sleep(1500);
        },
        references: [
            { name: 'earth_shipyard', file: 'shipyard/earth_spaceport.png' },
        ],
        regions: [
            region('shipyard_frame', 'Whole dialog frame', 578, 380, 765, 321),
            region('shipyard_grid', 'Ship grid pane', 585, 388, 335, 278),
            // The info box under the ship picture: the four price rows.
            region('shipyard_price_pane', 'Price / trade-in pane',
                1185, 590, 158, 100),
            region('shipyard_button_row', 'Info/Buy/Done button row',
                820, 668, 360, 30),
        ],
    },
    {
        id: 'earth_trade_center',
        title: 'Earth trade center — commodity dialog',
        description: 'The Trade Center opened from the Earth spaceport '
            + '(a sub-dialog over the still-visible spaceport). Compare the '
            + 'dialog\'s top metal border and the Buy/Sell/Done button row '
            + 'against trade_center/earth_trade_center.png. The commodity '
            + 'list, prices and cargo lines legitimately differ (dynamic '
            + 'economy/cargo state); the compared regions are static chrome.',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.landAt(page, 'planet nova:128');
            await driver.clickContainer(page, 'Button:Trade Center');
            await driver.waitForContainer(page, 'TradeCenter');
            await driver.sleep(1200);
        },
        references: [
            { name: 'earth_trade_center', file: 'trade_center/earth_trade_center.png' },
        ],
        regions: [
            region('trade_top_border', 'Trade dialog top metal border', 768, 414, 388, 14),
            region('trade_button_row', 'Buy / Sell / Done button row', 806, 636, 308, 22),
        ],
    },
    {
        id: 'earth_mission_bbs',
        title: 'Earth mission BBS — mission board dialog',
        description: 'The Mission BBS opened from the Earth spaceport. '
            + 'Compare the dialog\'s top metal border and the Accept/Leave '
            + 'button row against mission_bbs/earth_mission_bbs.png. The '
            + 'available-mission list and the selected description '
            + 'legitimately differ (mission generation is stateful); the '
            + 'compared regions are static chrome.',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.landAt(page, 'planet nova:128');
            await driver.clickContainer(page, 'Button:Mission BBS');
            await driver.waitForContainer(page, 'MissionBoard-Mission BBS');
            await driver.sleep(1200);
        },
        references: [
            { name: 'earth_mission_bbs', file: 'mission_bbs/earth_mission_bbs.png' },
        ],
        regions: [
            region('mission_top_border', 'Mission dialog top metal border', 703, 438, 510, 14),
            region('mission_button_row', 'Accept / Leave button row', 970, 611, 200, 22),
        ],
    },
    {
        id: 'earth_bar',
        title: 'Earth bar — spaceport bar dialog',
        description: 'The Bar opened from the Earth spaceport. Compare the '
            + 'dialog\'s top metal border and the 2x2 button grid '
            + '(Hire Escort / Gamble / Holovid / Leave) against '
            + 'bar/bar_earth.png. The bar description text legitimately '
            + 'differs; the compared regions are static chrome.',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.landAt(page, 'planet nova:128');
            await driver.clickContainer(page, 'Button:Bar');
            await driver.waitForContainer(page, 'Bar');
            await driver.sleep(1200);
        },
        references: [
            { name: 'bar_earth', file: 'bar/bar_earth.png' },
        ],
        regions: [
            region('bar_top_border', 'Bar dialog top metal border', 773, 448, 340, 14),
            region('bar_button_grid', 'Hire/Gamble/Holovid/Leave button grid', 812, 576, 308, 54),
        ],
    },
    {
        id: 'title_screen',
        title: 'Title screen — layout, logo & buttons',
        description: 'The game entry screen (before the world is joined), '
            + 'rendered from the original resources (PICT 8000 background, '
            + 'animated title 8010, rollover emblem 8020, button sheets '
            + '8050-8055). Compared against title_screen/title_screen.png. '
            + 'The flame animation frame and the bottom pilot status '
            + 'legitimately differ; the frame chrome, logo placement and '
            + 'button cluster should match.',
        entry: 'title',
        params: {},
        hideDebug: false,
        setup: null,
        references: [
            { name: 'title_screen', file: 'title_screen/title_screen.png' },
        ],
        regions: [
            // Frame origin in the reference is screen (448,157); the art is
            // drawn at native 1024x768 centered, so the same rectangles
            // apply to our capture.
            //
            // PER-BUTTON regions: the six corner button pills (rlëD
            // 8050-8055) and the center ATMOS emblem (rlëD 8020) each get
            // their own rect so the density metric pins each button
            // individually — a single misplaced pill can no longer hide in a
            // coarse cluster average. Rects were measured off the reference
            // pill art (screen coords); each snugly bounds one pill + its
            // label with a ~3px margin. Left column x<915, right column
            // x>1001, emblem column x900-1035. After the layout fix each of
            // our pills registers onto the reference within ~1px.
            region('title_btn_new_pilot', 'New Pilot button (top-left)', 799, 549, 116, 67),
            region('title_btn_enter_ship', 'Enter Ship button (top-right)', 1001, 549, 119, 67),
            region('title_btn_open_pilot', 'Open Pilot button (mid-left)', 795, 617, 103, 63),
            region('title_btn_set_prefs', 'Set Prefs button (mid-right)', 1027, 617, 99, 63),
            region('title_btn_quit_nova', 'Quit Nova button (bottom-left)', 799, 682, 96, 61),
            region('title_btn_about_nova', 'About Nova button (bottom-right)', 1026, 682, 96, 61),
            region('title_emblem', 'Center ATMOS emblem', 897, 628, 126, 131),
            region('title_logo', 'Flaming NOVA title logo', 636, 305, 660, 220),
            region('title_left_fan', 'Left fan chrome (text-free)', 890, 300, 130, 260),
            region('title_right_fan', 'Right fan chrome (text-free)', 900, 300, 130, 260),
            region('title_top_frame', 'Top metal frame band', 620, 165, 680, 90),
        ],
    },
    // ------------------------------------------------------------------------
    // Title-screen modal dialogs (HTML overlays over the Pixi title). Captured
    // full-page (Puppeteer grabs the DOM overlay and the canvas together).
    // These are DELIBERATELY different rendering tech from the originals: the
    // retail dialogs are native OS sheets/windows (an in-frame credits panel,
    // Aqua alert sheets, a Finder file picker) placed upper-/mid-screen, while
    // ours are custom HTML modals rendered screen-centered. The regions below
    // sit over OUR centered modal so the report captures our chrome; the diff
    // vs the reference is expected to be large and is classified CONTENT
    // (different dialog implementation + HTML vs bitmap fonts). What we check
    // by eye is that our modal is structurally faithful (right fields, tabs,
    // buttons) — not pixel parity with a native OS dialog.
    {
        id: 'title_about',
        title: 'Title — About box (game-rendered 8527 frame)',
        description: 'The About panel (novaTitle action "about"). This is NOT '
            + 'native chrome in the original: title_screen/about.png shows '
            + 'the game\'s own desc+pict frame (PICT 8527, 649x244, blitted '
            + 'centred at screen 635,419) with the dësc 32767 credits in its '
            + 'text well, that dësc\'s Graphic (PICT 5005) in the pane beside '
            + 'them, and a red Okay with the two round scroll arrows beneath. '
            + 'NovaJS used to open an HTML modal here; it now renders the '
            + 'same OfferPopup the mission texts use. Regions: the whole '
            + 'frame, its text well and its picture pane.',
        entry: 'title',
        params: {},
        hideDebug: false,
        setup: async (page, driver) => {
            await driver.fireTitleAction(page, 'about');
            await driver.waitForContainer(page, 'AboutPopup');
            await driver.sleep(600);
        },
        references: [
            { name: 'about', file: 'title_screen/about.png' },
        ],
        regions: [
            // 8527 art rects (popup_layout's PICT_TEXT_WELL / PICT_PANE),
            // offset by the frame origin measured on about.png.
            region('about_frame', 'Whole 8527 About frame', 635, 419, 649, 244),
            region('about_text_well', 'Credits text well', 640, 423, 427, 203),
            region('about_pict_pane', 'dësc graphic pane', 1074, 423, 202, 203),
        ],
    },
    {
        id: 'title_new_pilot',
        title: 'Title — New Pilot dialog (HTML modal)',
        description: 'The New Pilot dialog (novaTitle action "newPilot"). Both '
            + 'the original (a native Aqua sheet) and ours (HTML modal) carry '
            + 'the same fields — Full Name "Shane Merrol", Nickname "Hawkeye", '
            + 'Gender, Strict Play, Cancel/OK. Structure matches closely; '
            + 'placement (centered vs the sheet position) and native-vs-HTML '
            + 'rendering differ — CONTENT.',
        entry: 'title',
        params: {},
        hideDebug: false,
        setup: async (page, driver) => {
            await driver.fireTitleAction(page, 'newPilot');
            await driver.waitForTestId(page, 'new-pilot-dialog');
            await driver.sleep(400);
        },
        references: [
            { name: 'new_pilot', file: 'title_screen/new_pilot.png' },
        ],
        regions: [
            // Reference Aqua sheet: x797-1123, y434-646 (measured). Ours is a
            // centered HTML modal at roughly the same center.
            region('new_pilot_modal', 'New Pilot dialog area', 760, 420, 400, 250),
        ],
    },
    {
        id: 'title_open_pilot',
        title: 'Title — Open Pilot dialog (HTML modal)',
        description: 'The Open Pilot dialog (novaTitle action "openPilot"). The '
            + 'original is the native macOS file picker (Finder column view); '
            + 'ours is a custom HTML pilot list with Cancel/Open. Fundamentally '
            + 'different surfaces — CONTENT. With a reset pilot our list is '
            + 'empty ("no saved pilots").',
        entry: 'title',
        params: {},
        hideDebug: false,
        setup: async (page, driver) => {
            await driver.fireTitleAction(page, 'openPilot');
            await driver.waitForTestId(page, 'open-pilot-dialog');
            await driver.sleep(400);
        },
        references: [
            { name: 'open_pilot', file: 'title_screen/open_pilot.png' },
        ],
        regions: [
            region('open_pilot_modal', 'Open Pilot dialog area', 700, 360, 520, 340),
        ],
    },
    ...prefsScenarios(),
    {
        id: 'ship_info',
        title: 'Shipyard ship info dialog (8507)',
        description: "The shipyard's Info button opens the ship-description "
            + 'dialog on the 8507 frame: the ship PICT, name strip, stat '
            + 'columns and Done button. Compare the frame chrome against '
            + 'shipyard/shuttle_info.png (the pictured ship, name and stat '
            + 'values legitimately differ — our parsed data is not the retail '
            + "capture's).",
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.landAt(page, 'planet nova:128');
            // The first landing offers a mission; its popup's modal
            // shield swallows the Info click (this scenario used to time
            // out waiting for ShipInfo, aborting the whole run).
            await driver.dismissOfferPopup(page);
            await driver.clickContainer(page, 'Button:Shipyard');
            await driver.waitForContainer(page, 'Shipyard');
            await driver.pressKey(page, 'ArrowRight'); // select a ship
            await driver.sleep(300);
            await driver.clickContainer(page, 'Button:Info');
            await driver.waitForContainer(page, 'ShipInfo');
            await driver.sleep(1200);
        },
        references: [
            { name: 'shuttle_info', file: 'shipyard/shuttle_info.png' },
        ],
        regions: [
            // The 614x537 8507 frame, centered on screen.
            region('shipinfo_frame', 'Whole dialog frame', 653, 271, 614, 537),
            region('shipinfo_name_strip', 'Ship name strip', 655, 682, 610, 30),
            region('shipinfo_done', 'Done button', 1168, 780, 90, 24),
        ],
    },
    {
        id: 'mission_info',
        title: "Mission info dialog (8517, 'i')",
        description: "The Mission Info dialog toggled with 'i' (KeyI) in "
            + 'flight, like the reference (missions_info.png is a flight '
            + 'capture). Compare the 8517 frame, the "Currently active '
            + 'missions:" header, the date strip and the Abort/Done row. The '
            + "list content legitimately differs (this capture's pilot has no "
            + 'active missions); the compared regions are the static chrome.',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            // In flight the plugin's own handler opens it for the world's
            // player ship (no landing / ambiguous button clicks needed).
            await driver.pressKey(page, 'KeyI');
            await driver.waitForContainer(page, 'MissionInfo');
            await driver.sleep(1000);
        },
        references: [
            { name: 'missions_info', file: 'missions/missions_info.png' },
        ],
        regions: [
            // The 471x155 8517 frame, centered on screen.
            region('missioninfo_frame', 'Whole dialog frame', 725, 463, 471, 155),
            region('missioninfo_header', 'Active-missions header', 731, 469, 200, 14),
            region('missioninfo_button_row', 'Abort / Done row', 731, 592, 460, 28),
        ],
    },

    // ========================================================================
    // DIALOG SWEEP — landed/dialog UI variants (dialog-sweep agent).
    // Extends coverage to every remaining landed/dialog reference. Shared
    // frames (trade 8510, bar 8503, mission BBS 8505, player-info
    // 8518-8520, ship-info 8507, outfitter 8502) reuse the already-proven
    // frame coordinates; the point is to measure each reference and surface
    // any content/positioning drift, not to re-derive the chrome.
    // ========================================================================

    {
        id: 'port_kane_bar',
        title: 'Port Kane bar — second bar layout',
        description: 'The Bar at Port Kane (a second stellar\'s bar). Any '
            + 'entry mission-offer popup is dismissed first so the bar\'s own '
            + '2x2 button grid shows. Compares the 8503 top border and the '
            + 'Hire/Gamble/Holovid/Leave grid against bar/bar_port_kane.png; '
            + 'same chrome as the Earth bar, different description text.',
        params: { ship: 'nova:164', system: 'nova:128' },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.landAt(page, 'planet nova:137');
            await driver.clickContainer(page, 'Button:Bar');
            await driver.waitForContainer(page, 'Bar');
            await driver.sleep(800);
            await driver.dismissOfferPopup(page);
            await driver.sleep(600);
        },
        references: [
            { name: 'bar_port_kane', file: 'bar/bar_port_kane.png' },
        ],
        regions: [
            region('bar_top_border', 'Bar dialog top metal border', 773, 448, 340, 14),
            region('bar_button_grid', 'Hire/Gamble/Holovid/Leave button grid', 812, 576, 308, 54),
        ],
    },

    {
        id: 'port_kane_trade',
        title: 'Port Kane trade — price event + mission cargo',
        description: 'The Trade Center at Port Kane. The reference shows a '
            + 'deterministic food-surplus öops price event and a mission-cargo '
            + 'line; those are content. Compares the 8510 frame top border, '
            + 'the Buy/Sell/Done row and the price-event line position against '
            + 'trade_center/trade_center_port_kane_with_mission_cargo_and_'
            + 'lower_cost_food_event.png.',
        // A save so a mission-cargo line and a stocked economy exist; the
        // öops event is date-driven, so the default Jan 1 1177 date is kept.
        save: {
            ship: 'nova:164', outfits: [], system: 'nova:128',
            credits: 600000,
            cargo: [['mission:nova:700', 5]],
        },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.landAt(page, 'planet nova:137');
            await driver.clickContainer(page, 'Button:Trade Center');
            await driver.waitForContainer(page, 'TradeCenter');
            await driver.sleep(1000);
        },
        references: [
            { name: 'port_kane_trade', file: 'trade_center/trade_center_port_kane_with_mission_cargo_and_lower_cost_food_event.png' },
        ],
        regions: [
            region('trade_top_border', 'Trade dialog top metal border', 768, 414, 388, 14),
            region('trade_button_row', 'Buy / Sell / Done button row', 806, 636, 308, 22),
            region('trade_list_header', 'Commodity / In Hold / Price header', 790, 428, 340, 12),
        ],
    },

    {
        id: 'earth_trade_variants',
        title: 'Earth trade — content variants (chrome)',
        description: 'Our Earth Trade Center captured once, its static chrome '
            + '(8510 top border + Buy/Sell/Done row) compared against three '
            + 'content variants of the same fixed frame: the plain board, the '
            + 'Medical-Supplies selection, and a large cargo buy. Commodity '
            + 'rows / prices / selection legitimately differ; the frame does '
            + 'not.',
        save: {
            ship: 'nova:164', outfits: [], system: 'nova:130', credits: 5000000,
        },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.landAt(page, 'planet nova:128');
            await driver.clickContainer(page, 'Button:Trade Center');
            await driver.waitForContainer(page, 'TradeCenter');
            await driver.sleep(900);
        },
        references: [
            { name: 'earth_trade_center', file: 'trade_center/earth_trade_center.png' },
            { name: 'medical_390', file: 'trade_center/390_medical_supplies.png' },
            { name: 'buy_lots', file: 'trade_center/buy_lots_of_cargo.png' },
        ],
        regions: [
            region('trade_top_border', 'Trade dialog top metal border', 768, 414, 388, 14),
            region('trade_button_row', 'Buy / Sell / Done button row', 806, 636, 308, 22),
        ],
    },

    {
        id: 'trade_buy_quantity',
        title: 'Trade buy — bulk quantity dialog',
        description: 'Option-clicking Buy in the Trade Center opens the bulk '
            + 'quantity dialog. The reference (buy_quantity.png) is the '
            + 'original\'s NATIVE macOS dialog (blue default Buy button); ours '
            + 'is a drawn grey-bevel panel — an intentional ART difference. '
            + 'The measured region is the panel position, not its styling.',
        save: {
            ship: 'nova:164', outfits: [], system: 'nova:130', credits: 5000000,
        },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.landAt(page, 'planet nova:128');
            await driver.clickContainer(page, 'Button:Trade Center');
            await driver.waitForContainer(page, 'TradeCenter');
            await driver.sleep(900);
            // Medical Supplies (row 2) — matches the reference selection.
            await driver.pressKeyN(page, 'ArrowDown', 2);
            await driver.optionClick(page, 'Button:Buy');
            await driver.waitForContainer(page, 'QuantityDialog');
            await driver.sleep(500);
        },
        references: [
            { name: 'buy_quantity', file: 'trade_center/buy_quantity.png' },
        ],
        regions: [
            region('quantity_panel', 'Quantity dialog panel (position; ART styling)', 846, 486, 240, 104),
        ],
    },

    {
        id: 'earth_player_info_extras',
        title: "Player info — Extras page",
        description: 'The Extras page of the player-info dialog (KeyP → '
            + 'Extras tab): owned outfits and ship trade-in value. Compares '
            + 'the 8518-8520 frame, tab row (Extras greyed) and Done row '
            + 'against p_properties/extras.png. Listed outfits / values '
            + 'legitimately differ.',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.openPlayerInfo(page);
            await driver.clickContainer(page, 'Button:Extras');
            await driver.sleep(400);
        },
        references: [
            { name: 'extras', file: 'p_properties/extras.png' },
        ],
        regions: [
            region('pinfo_frame', 'Whole dialog frame', 753, 425, 414, 231),
            region('pinfo_tab_row', 'Tab row (Extras greyed)', 757, 429, 406, 36),
            region('pinfo_done_row', 'Bottom strip with Done', 757, 615, 406, 37),
        ],
    },

    {
        id: 'earth_player_info_honors',
        title: "Player info — Honors page",
        description: 'The Honors page (KeyP → Honors tab). Ranks/honors are '
            + 'not parsed yet (shows "None."), a documented content gap. '
            + 'Compares the 8518-8520 frame, tab row (Honors greyed) and Done '
            + 'row against p_properties/honors.png.',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.openPlayerInfo(page);
            await driver.clickContainer(page, 'Button:Honors');
            await driver.sleep(400);
        },
        references: [
            { name: 'honors', file: 'p_properties/honors.png' },
        ],
        regions: [
            region('pinfo_frame', 'Whole dialog frame', 753, 425, 414, 231),
            region('pinfo_tab_row', 'Tab row (Honors greyed)', 757, 429, 406, 36),
            region('pinfo_done_row', 'Bottom strip with Done', 757, 615, 406, 37),
        ],
    },

    {
        id: 'earth_player_info_cargo_stuff',
        title: "Player info — Cargo page with cargo aboard",
        description: 'The Cargo page with cargo actually in the hold (a save '
            + 'seeds Food + Medical Supplies), so the Jettison Cargo button '
            + 'shows (greyed) beside Done — unlike the empty-hold cargo page. '
            + 'Compares the frame, tab row and the Jettison/Done bottom row '
            + 'against p_properties/cargo_with_stuff.png.',
        save: {
            ship: 'nova:164', outfits: [], system: 'nova:130', credits: 200000,
            cargo: [['cargo:0', 30], ['cargo:2', 20]],
        },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.openPlayerInfo(page);
            await driver.clickContainer(page, 'Button:Cargo');
            await driver.sleep(400);
        },
        references: [
            { name: 'cargo_with_stuff', file: 'p_properties/cargo_with_stuff.png' },
        ],
        regions: [
            region('pinfo_frame', 'Whole dialog frame', 753, 425, 414, 231),
            region('pinfo_tab_row', 'Tab row (Cargo greyed)', 757, 429, 406, 36),
            region('pinfo_bottom_row', 'Jettison Cargo + Done row', 757, 615, 406, 37),
        ],
    },

    {
        id: 'heavy_shuttle_info',
        title: 'Shipyard ship info — Heavy Shuttle',
        description: 'The shipyard Info dialog for the Heavy Shuttle (a '
            + 'different ship than the base ship_info scenario). Compares the '
            + '8507 frame, name strip and Done button against '
            + 'shipyard/heavy_shuttle_info.png. Ship PICT/stats differ from '
            + 'the retail capture; the frame chrome should match.',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.landAt(page, 'planet nova:128');
            // The first landing offers a mission; its popup's modal
            // shield swallows the Info click (this scenario used to time
            // out waiting for ShipInfo, aborting the whole run).
            await driver.dismissOfferPopup(page);
            await driver.clickContainer(page, 'Button:Shipyard');
            await driver.waitForContainer(page, 'Shipyard');
            await driver.sleep(400);
            // Pick the tile by its caption: a fixed number of ArrowRight
            // presses no longer lands on the Heavy Shuttle now that the
            // grid lists every variant (see driver.clickGridTile).
            await driver.clickGridTile(page, 'Shipyard', 'Heavy Shuttle');
            await driver.clickContainer(page, 'Button:Info');
            await driver.waitForContainer(page, 'ShipInfo');
            await driver.sleep(1000);
        },
        references: [
            { name: 'heavy_shuttle_info', file: 'shipyard/heavy_shuttle_info.png' },
        ],
        regions: [
            region('shipinfo_frame', 'Whole dialog frame', 653, 271, 614, 537),
            region('shipinfo_name_strip', 'Ship name strip', 655, 682, 610, 30),
            region('shipinfo_done', 'Done button', 1168, 780, 90, 24),
        ],
    },

    {
        id: 'ida_frigate_info',
        title: 'Shipyard ship info — IDA Frigate',
        description: 'The shipyard Info dialog for the IDA Frigate. Compares '
            + 'the 8507 frame, name strip and Done button against '
            + 'shipyard/ida_frigate_info.png.',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.landAt(page, 'planet nova:128');
            // The first landing offers a mission; its popup's modal
            // shield swallows the Info click (this scenario used to time
            // out waiting for ShipInfo, aborting the whole run).
            await driver.dismissOfferPopup(page);
            await driver.clickContainer(page, 'Button:Shipyard');
            await driver.waitForContainer(page, 'Shipyard');
            await driver.sleep(400);
            // By caption, not by a press count (see clickGridTile). The
            // IDA Frigate's displayWeight puts it past the first page, so
            // let the helper page forward until the tile shows.
            await driver.clickGridTile(page, 'Shipyard', 'IDA Frigate',
                { searchRows: 40 });
            await driver.clickContainer(page, 'Button:Info');
            await driver.waitForContainer(page, 'ShipInfo');
            await driver.sleep(1000);
        },
        references: [
            { name: 'ida_frigate_info', file: 'shipyard/ida_frigate_info.png' },
        ],
        regions: [
            region('shipinfo_frame', 'Whole dialog frame', 653, 271, 614, 537),
            region('shipinfo_name_strip', 'Ship name strip', 655, 682, 610, 30),
            region('shipinfo_done', 'Done button', 1168, 780, 90, 24),
        ],
    },

    {
        id: 'earth_mission_bbs_selected',
        title: 'Mission BBS — selected mission',
        description: 'The Mission BBS with a mission selected (highlighted in '
            + 'the list, its brief shown in the right pane). Compares the 8505 '
            + 'top border, list pane, description pane and Accept/Leave row '
            + 'against mission_bbs/un_shipping_mission.png. Which mission is '
            + 'offered/selected legitimately differs (random generation); the '
            + 'panes and chrome do not.',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.landAt(page, 'planet nova:128');
            await driver.clickContainer(page, 'Button:Mission BBS');
            await driver.waitForContainer(page, 'MissionBoard-Mission BBS');
            await driver.sleep(800);
            // Select the last offer, as the reference selects the bottom row.
            await driver.pressKeyN(page, 'ArrowDown', 4);
            await driver.sleep(400);
        },
        references: [
            { name: 'un_shipping_mission', file: 'mission_bbs/un_shipping_mission.png' },
        ],
        regions: [
            region('mission_top_border', 'Mission dialog top metal border', 703, 438, 510, 14),
            region('mission_button_row', 'Accept / Leave button row', 970, 611, 200, 22),
            region('mission_list_pane', 'Left mission-list pane', 712, 468, 205, 140),
            region('mission_desc_pane', 'Right description pane', 928, 478, 262, 120),
        ],
    },

    {
        id: 'earth_mission_bbs_accepted',
        title: 'Mission BBS — after accepting',
        description: 'The Mission BBS after accepting an offer: it moves under '
            + 'the "Active missions" header and the status line confirms it. '
            + 'Compares the 8505 top border, list pane and Accept/Leave row '
            + 'against mission_bbs/accepted_un_mission.png. The specific '
            + 'mission differs; the layout does not.',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.landAt(page, 'planet nova:128');
            await driver.clickContainer(page, 'Button:Mission BBS');
            await driver.waitForContainer(page, 'MissionBoard-Mission BBS');
            await driver.sleep(800);
            // Accept the first acceptable listing (KeyA = accept control).
            await driver.pressKey(page, 'KeyA');
            await driver.sleep(600);
        },
        references: [
            { name: 'accepted_un_mission', file: 'mission_bbs/accepted_un_mission.png' },
        ],
        regions: [
            region('mission_top_border', 'Mission dialog top metal border', 703, 438, 510, 14),
            region('mission_button_row', 'Accept / Leave button row', 970, 611, 200, 22),
            region('mission_list_pane', 'Left mission-list pane', 712, 468, 205, 140),
        ],
    },

    {
        id: 'earth_outfitter_denial',
        title: 'Outfitter — denial caption + greyed Buy',
        description: 'The outfitter driven into a purchase-denial state '
            + '(mass/hold filled by bulk buys, then a further buy attempted): '
            + 'the right info pane shows a persistent "Can\'t ..." caption and '
            + 'the Buy button greys. The four denial references differ only in '
            + 'the caption WORDING (content) and which button greys; the '
            + 'measured chrome — info-pane block, caption line position and '
            + 'button row — is identical across all of them.',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.landAt(page, 'planet nova:128');
            await driver.clickContainer(page, 'Button:Outfitter');
            await driver.waitForContainer(page, 'Outfitter');
            await driver.sleep(1500);
            // Fill the ship's outfit mass with bulk buys of several grid
            // outfits (the outfitter ignores credits), then a further buy
            // trips the "Can't hold ..." denial. Skip the first tile
            // (a mission-granting Trainee Program).
            for (let i = 0; i < 6; i++) {
                await driver.pressKey(page, 'ArrowRight');
                await driver.sleep(150);
                await driver.optionClick(page, 'Button:Buy');
                await driver.sleep(400);
                // Confirm the bulk quantity (fills to the max allowed).
                await driver.pressKey(page, 'Enter');
                await driver.sleep(300);
            }
            // A final plain buy on the current selection surfaces the
            // persistent denial caption + greys Buy.
            await driver.clickContainer(page, 'Button:Buy');
            await driver.sleep(400);
        },
        references: [
            { name: 'cant_have_any', file: 'outfitter/earth_outfitter_cant_have_any.png' },
            { name: 'cant_have_any_more', file: 'outfitter/earth_outfitter_cant_have_any_more.png' },
            { name: 'cant_hold_any', file: 'outfitter/earth_outfitter_cant_hold_any.png' },
            { name: 'cant_hold_any_more', file: 'outfitter/earth_outfitter_cant_hold_any_more.png' },
            { name: 'carbon_fiber_cant_hold_any_more', file: 'outfitter/earth_outfitter_carbon_fiber_cant_hold_any_more.png' },
        ],
        regions: [
            region('outfitter_frame', 'Whole dialog frame', 578, 380, 765, 321),
            region('outfitter_button_row', 'Buy/Sell/Done button row', 660, 668, 520, 30),
            region('outfitter_info_block', 'Right info pane (Price/Mass/caption)', 1188, 594, 148, 92),
        ],
    },

    {
        id: 'bar_offer_popup',
        title: 'Mission-offer popup (8521-8523) — frame & buttons',
        description: 'The mission-offer popup chrome. Our spaceport does not '
            + 'present offer popups on landing (only the bar and BBS surface '
            + 'missions), so this drives the Earth bar\'s entry offer to raise '
            + 'the same 8521-8523 offer frame, and measures its centered frame '
            + 'borders against spaceport/kiniké_kont_probe_mission_offer_in_'
            + 'spaceport.png. The popup is vertically CENTERED and its height '
            + 'tracks the (differing) text length, so only the vertical-centre '
            + 'border bands are position-comparable; the button-row Y and the '
            + 'text/background legitimately differ.',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.landAt(page, 'planet nova:128');
            await driver.clickContainer(page, 'Button:Bar');
            await driver.waitForContainer(page, 'OfferPopup');
            await driver.sleep(1000);
        },
        references: [
            { name: 'kinike_offer', file: 'spaceport/kiniké_kont_probe_mission_offer_in_spaceport.png' },
        ],
        regions: [
            region('offer_left_border', 'Left metal frame border (vertical centre)', 740, 500, 16, 80),
            region('offer_right_border', 'Right metal frame border (vertical centre)', 1165, 500, 16, 80),
        ],
    },

    // ========================================================================
    // HAIL SWEEP — the communications (hail) dialogs (PICTs 8511-8514).
    // Merged in a5b7adc1; the layout was eyeballed. All comm backgrounds share
    // one structure in the references: two stacked text boxes top-LEFT, a
    // vertical red-button column under them, and the target image filling a box
    // on the RIGHT. Driven deterministically via window.novaHailDialog.show()
    // with a crafted context (centered like the plugin's own control path).
    // The image CONTENT (which ship/planet) legitimately differs; the frame,
    // its image box, the left text boxes and the button column are the
    // positionable chrome. Escort-comm button SEMANTICS diverge (ours offers
    // fleet commands, the original manages a hired escort) and the haggle
    // popup differs structurally — classified content, not MOVE.
    // ========================================================================

    {
        id: 'hail_ship',
        title: 'Hail — ship comm (8511)',
        description: 'The ship communications dialog (greeting + Request '
            + 'Assistance). Compares the 8511 frame, its left text/button '
            + 'column and the right image box against hail/hail.png, '
            + 'greetings.png and request_assistance.png (all the same 8511 '
            + 'layout, different greeting text / target).',
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
        regions: [
            region('hail_frame', 'Whole comm frame', 748, 433, 423, 215),
            region('hail_left_col', 'Left text boxes + button column', 756, 440, 182, 200),
            region('hail_image_box', 'Right image box (border chrome)', 950, 435, 222, 208),
        ],
    },

    {
        id: 'hail_hostile',
        title: 'Hail — hostile ship (8511 + bribe)',
        description: 'A hostile ship comm: the hostile response line (STR# '
            + '3000 indices 10-14) over the identity block with its RED '
            + 'Status value, plus a Beg for Mercy (bribe) button above Close '
            + 'Channel. Compares the 8511 frame, left column and image box '
            + 'against hail/hail_hostile.png.',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            // The reference's own content: "What is it?" from the hostile
            // group, and the three identity lines with "Hostile" in red.
            await driver.showHail(page, {
                variant: 'ship',
                heading: 'Class: Fed Destroyer\n(Federation)\nStatus: Hostile',
                image: 'nova:5003',
                body: 'What is it?',
                bribe: { amount: 20000, canAfford: true },
            });
            await driver.sleep(1200);
        },
        references: [
            { name: 'hail_hostile', file: 'hail/hail_hostile.png' },
        ],
        regions: [
            region('hail_frame', 'Whole comm frame', 748, 433, 423, 215),
            region('hail_left_col', 'Left text boxes + button column', 756, 440, 182, 200),
            region('hail_image_box', 'Right image box (border chrome)', 950, 435, 222, 208),
        ],
    },

    {
        id: 'hail_planet',
        title: 'Hail — planet comm (8512)',
        description: 'The planet communications dialog (larger 8512 frame). '
            + 'Compares the frame, left text/button column and right image box '
            + 'against hail/hail_planet.png. Our planet comm lacks the '
            + 'Demand Tribute button (content gap); Close Channel and the '
            + 'layout are compared.',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.showHail(page, {
                variant: 'planet', heading: 'Earth',
                image: 'nova:10059',
                body: 'Channel open to Earth.\n[Earth/Luna System]',
            });
            await driver.sleep(1200);
        },
        references: [
            { name: 'hail_planet', file: 'hail/hail_planet.png' },
        ],
        regions: [
            region('hailp_frame', 'Whole planet comm frame', 690, 392, 540, 295),
            region('hailp_left_col', 'Left text boxes + button column', 698, 400, 210, 250),
            region('hailp_image_box', 'Right image box (border chrome)', 905, 398, 330, 285),
        ],
    },

    {
        id: 'hail_escort',
        title: 'Hail — escort comm (8513)',
        description: 'The escort communications dialog (8513): an escort '
            + 'MANAGEMENT panel (Upgrade Escort / Sell Escort / Release / Close '
            + 'Channel), not a fleet-command panel — commanding escorts is the '
            + 'keyboard escort-controls\' job. All three functions are live '
            + '(nova_plugin/escort_action.ts); Sell Escort renders GREYED for a '
            + 'HIRED escort, exactly as the reference greys it, because the '
            + 'player never owned that hull. '
            + 'The 8513 frame is shared by every escort reference, so this one '
            + 'scenario compares our single escort dialog against all four — '
            + 'the normal hired escort (hail_escort.png), the upgrading state '
            + '(hail_escort_upgrading.png: "Cancel Upgrade" — NovaJS applies '
            + 'the upgrade immediately instead of deferring it to the next '
            + 'shipyard, a documented divergence), and the captured '
            + 'variants (hail_captured_escort / sell_captured_escort: Sell '
            + 'Escort ACTIVE). The frame / left column / image box are the '
            + 'positionable chrome; the upper info box\'s daily Pay figure '
            + 'legitimately differs (CONTENT: 1,500 vs the reference\'s 1,100 '
            + '— see spaceport/escort_fees.ts).',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            // The whole identity block goes in the LOWER well, the way
            // computeContext builds it (and the way hail_escort.png stacks
            // "Hired Escort: / Terrapin / Standard" there); the upper well is
            // the reference's Upgrade Cost / Pay readout, with the blank row
            // between them that the reference shows for a hire.
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
            { name: 'hail_escort_upgrading', file: 'hail/hail_escort_upgrading.png' },
            { name: 'hail_captured_escort', file: 'hail/hail_captured_escort.png' },
            { name: 'sell_captured_escort', file: 'hail/sell_captured_escort.png' },
        ],
        regions: [
            region('haile_frame', 'Whole escort comm frame', 748, 410, 424, 259),
            region('haile_left_col', 'Left text boxes + button column', 756, 418, 182, 240),
            region('haile_image_box', 'Right image box (border chrome)', 950, 418, 222, 245),
        ],
    },

    {
        id: 'hail_haggle',
        title: 'Hail — beg for mercy / haggle (8514)',
        description: 'The bribe-haggle screen reached from a hostile ship\'s '
            + 'Beg for Mercy. The original shows a small 8514 popup ("Pay me X '
            + 'credits" / Lower Price / Accept Price) OVER the hostile dialog; '
            + 'ours replaces the dialog with the 8514 background and offers '
            + 'Pay / Never Mind — a documented structural divergence. Compared '
            + 'against hail/beg_mercy.png (frame position).',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.showHail(page, {
                variant: 'ship', heading: 'Class: Fed Destroyer',
                image: 'nova:5003',
                body: 'I\'m in a bad mood today, so it\'s going to cost extra.',
                bribe: { amount: 20000, canAfford: true },
            });
            await driver.sleep(800);
            // "Beg For Mercy" — the reference's capitalisation
            // (hail/hail_hostile.png).
            await driver.clickContainer(page, 'Button:Beg For Mercy');
            await driver.sleep(900);
        },
        references: [
            { name: 'beg_mercy', file: 'hail/beg_mercy.png' },
        ],
        regions: [
            region('haggle_frame', 'Haggle popup frame', 810, 462, 300, 156),
        ],
    },

    // ========================================================================
    // BOARDING SWEEP — the plunder (PICT 8515) and capture-assignment
    // (PICT 8516) dialogs. Merged in 1c600426; the layout was eyeballed.
    // Both are display slaves of the synced BoardingComponent on the player's
    // ship (display/boarding_plugin.ts); driver.openBoarding spawns a shuttle
    // victim and injects that component (the showHail pattern) rather than
    // fighting the physics gate. The frames are the game PICTs, centered.
    // The plunder button SET now matches the original: Energy / Cargo / Ammo
    // (top row), Credits / Capture Ship (second row), Abort (centered) — the
    // Ammo action transfers the victim's compatible ammunition. Remaining
    // CONTENT divergences (not MOVE): the booty-readout formatting, and the
    // capture-assignment dialog is drawn as a standalone 8516 frame with
    // "Keep as Escort" / "Release" rather than the original's escort-question
    // inset over the plunder dialog with a "Use As My Ship" swap seam. What we
    // measure/fix (MOVE) is the frame, title, body and button-block PLACEMENT
    // within the frame.
    // ========================================================================
    {
        id: 'boarding_plunder',
        title: 'Boarding — plunder dialog (8515)',
        description: 'The plunder dialog opened over a disabled, crewed '
            + 'victim. Compares the 8515 frame, the title/booty text block '
            + 'and the button grid against space/board_ship.png. The button '
            + 'set/order/placement now matches the original (Energy / Cargo / '
            + 'Ammo top row, Credits / Capture Ship, then centered Abort; Ammo '
            + 'greyed here since the injected victim carries no compatible '
            + 'ammo, as in the reference). The title wording and booty-readout '
            + 'format still differ (CONTENT); the frame is the same PICT.',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => { await driver.openBoarding(page); },
        references: [
            { name: 'board_ship', file: 'space/board_ship.png' },
        ],
        regions: [
            // Frame renders at screen 806,441 309x198 (measured), centered.
            region('plunder_frame', 'Whole plunder frame', 806, 441, 309, 198),
            region('plunder_title', 'Title line', 810, 448, 270, 16),
            region('plunder_body', 'Booty readout block', 809, 468, 220, 54),
            region('plunder_buttons', 'Button grid (metal lower third)',
                808, 550, 308, 88),
        ],
    },
    {
        id: 'boarding_capture_assignment',
        title: 'Boarding — capture-assignment dialog (8516)',
        description: 'The capture-assignment dialog after a successful capture '
            + 'roll (injected capture:"succeeded"). Compares the 8516 frame, '
            + 'the "You have captured the ship!" title and the '
            + 'Keep as Escort / Release buttons against '
            + 'space/capture_assignment.png. The original composites an escort '
            + 'question INSET over the still-visible plunder dialog with a '
            + 'ship-swap option; ours is a standalone 8516 frame with two '
            + 'buttons — a documented structural/CONTENT divergence. The MOVE '
            + 'signal is that the title and buttons sit INSIDE the 8516 frame.',
        params: { ship: 'nova:164', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.openBoarding(page, { capture: 'succeeded' });
        },
        references: [
            { name: 'capture_assignment', file: 'space/capture_assignment.png' },
        ],
        regions: [
            // 8516 frame renders at screen 827,476 267x128 (measured).
            region('assign_frame', 'Whole capture-assignment frame',
                827, 476, 267, 128),
            region('assign_title', 'Title line', 835, 484, 262, 18),
            region('assign_buttons', 'Escort / Release buttons',
                868, 520, 190, 80),
        ],
    },

    // ========================================================================
    // SIGMA MISSION TEXT — the mission-text popups, measured text-for-text.
    //
    // The Sigma Shipyards intro mission (mïsn nova:555) was captured on real
    // hardware at every step (sigma_mission_1/1..5), which makes it the one
    // place where our frame geometry, font and line breaking can be compared
    // against the original for the SAME string. Each scenario raises the
    // popup directly with that dësc's text (visual_compare/sigma_texts.mjs,
    // generated from the game data) through window.novaOfferPopups, exactly
    // as the hail scenarios drive the comm dialog: the popup is a display
    // slave of the text it is handed, so this is the same render the mission
    // flow produces without needing the mission state that offers it.
    //
    // The BACKGROUND differs by design — the references were taken over the
    // shipyard / landing view, ours over the docked spaceport — so only the
    // popup's own rectangles are compared.
    //
    // Vertical placement: the original centres these dialogs on the screen
    // (y=540). Four of the five references confirm it to the pixel; the
    // offer capture (1_sigma_1_offer.png) alone sits 31px higher, which no
    // other offer capture reproduces (the longer kont-probe offer is dead
    // centre), so that scenario compares our centred frame against the
    // reference's shifted one with explicit rects.
    ...sigmaScenarios(),
    ...shopScenarios(),
    // In-flight HUD coverage (status bar interfaces, cargo/target panels,
    // star-map properties column, status line) — see scenarios_hud.mjs.
    ...hudScenarios,
    // Bar / mission BBS / mission info / trade center interiors.
    ...dialogScenarios,
    // Fine-grained hail / boarding / player-info layout regions.
    ...hailInfoScenarios,
];
