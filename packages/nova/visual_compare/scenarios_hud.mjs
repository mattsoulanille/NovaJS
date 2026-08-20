// IN-FLIGHT HUD scenarios: the status bar's seven per-government interfaces,
// its cargo/target panels, the star map's properties column and the
// bottom-left status line. Appended to `scenarios` by scenarios.mjs.
//
// ---------------------------------------------------------------------------
// THE ïntf REFERENCES ARE EDITOR WINDOWS, NOT GAME FRAMES
// ---------------------------------------------------------------------------
// ui_screenshots/original_macos_screenshots/statusbar/*.png are 687x850 shots
// of the retail mission-computer's ïntf editor, one per status bar. Each one
// carries a LIVE 1:1 PREVIEW of that interface down its right-hand side, and
// that preview is what these scenarios compare against: the pane's status-bar
// origin sits at (424, 51) in every one of the seven windows (verified by the
// "Stellar Navigation" row landing on image y=308 in all of them, which is the
// same status-bar-local y=257 the in-flight captures show), so a rectangle at
// (1726 + x, y) in our 1920x1080 frame maps to (424 + x, 51 + y) in the
// reference. `previewRegion` builds that pair.
//
// The preview's CONTENT is the editor's fixture (an "Earth" destination, a
// Starbridge target, "Food: 10", 1.81M credits), so only the chrome regions
// mean anything: the metal frame, the radar box, the three indicator bars
// (whose colours are exactly what the ïntf resource sets) and the decorative
// art at the bottom, which is the loudest per-government difference.
//
// WHICH interface a scenario gets is decided by the ship it flies — the EVN
// Bible's gövt Interface rule, implemented in display/status_bar.ts's
// SelectStatusBarInterface. The ships below were picked from the parsed data
// (visual_compare/output/probe_shipbars.mjs) as the plainest member of each
// government's set.
// ---------------------------------------------------------------------------

const region = (id, label, x, y, width, height) => ({
    id, label, ref: { x, y, width, height }, ours: { x, y, width, height },
});

/** Our status bar's left edge at 1920x1080, and the preview pane's origin. */
const STATUSBAR_X = 1726;
const PREVIEW_ORIGIN = { x: 424, y: 51 };

/**
 * A region over the status bar given in STATUS-BAR-LOCAL coordinates (x from
 * the bar's left edge, y from the top of the screen), mapped onto our frame
 * and onto the ïntf editor's preview pane.
 */
function previewRegion(id, label, x, y, width, height) {
    return {
        id, label,
        ref: {
            x: PREVIEW_ORIGIN.x + x, y: PREVIEW_ORIGIN.y + y, width, height,
        },
        ours: { x: STATUSBAR_X + x, y, width, height },
    };
}

/**
 * The four chrome bands of a status bar, in status-bar-local coordinates.
 * The pane interiors (nav / weapon / target / cargo) are deliberately left
 * out: their text is the editor's fixture on one side and live game state on
 * the other.
 */
const PREVIEW_REGIONS = [
    previewRegion('sb_radar_frame', 'Radar box + top frame', 0, 0, 194, 196),
    previewRegion('sb_bars', 'Shield / armour / fuel bars', 28, 195, 160, 52),
    // The metal strips BETWEEN the readout panes: chrome that carries no
    // text on either side (the panes themselves hold the editor's fixture
    // strings against our live ones).
    previewRegion('sb_strip_nav', 'Metal strip under the navigation pane',
        0, 286, 194, 14),
    previewRegion('sb_strip_cargo', 'Metal strip above the cargo pane',
        0, 442, 194, 16),
    previewRegion('sb_art', 'Lower decorative art (per-government)',
        0, 560, 194, 148),
];

/**
 * The seven stock status bars and a ship that selects each. ïntf 128 is the
 * default civilian bar every government whose Interface is unset falls back
 * to; 129-134 are named after the government whose Interface points at them.
 */
const STATUS_BAR_VARIANTS = [
    {
        id: 'default_128', file: 'statusbar/default 128.png',
        ship: 'nova:133', shipName: 'Starbridge; Class A',
        bar: 'nova:128', label: 'default (ïntf 128 / PICT 700)',
        why: 'a class with no inherent government at all, so it falls back '
            + 'to the civilian bar',
    },
    {
        id: 'polaris_129', file: 'statusbar/polaris 129.png',
        ship: 'nova:164', shipName: 'Raven',
        bar: 'nova:129', label: 'Polaris (ïntf 129 / PICT 701)',
        why: "InherentGovt 147 (Nil'kemorya), whose Interface is 129",
    },
    {
        id: 'federation_130', file: 'statusbar/federation 130.png',
        ship: 'nova:144', shipName: 'Fed Viper; Fighter',
        bar: 'nova:130', label: 'Federation (ïntf 130 / PICT 702)',
        why: 'InherentGovt 1128 — the attributes-only encoding of gövt 128 '
            + '(Federation), whose Interface is 130',
    },
    {
        id: 'rebellion_131', file: 'statusbar/rebellion 131.png',
        ship: 'nova:178', shipName: 'Rebel Starbridge',
        bar: 'nova:131', label: 'Rebellion (ïntf 131 / PICT 703)',
        why: 'InherentGovt 1141 (Rebellion), whose Interface is 131',
    },
    {
        id: 'auroran_132', file: 'statusbar/auroran 132.png',
        ship: 'nova:155', shipName: 'Firebird; Thamgiir',
        bar: 'nova:132', label: 'Auroran (ïntf 132 / PICT 704)',
        why: 'InherentGovt 1129 (Auroran Empire), whose Interface is 132',
    },
    {
        id: 'pirate_133', file: 'statusbar/pirate 133.png',
        ship: 'nova:148', shipName: 'Pirate Starbridge; Class B',
        bar: 'nova:133', label: 'Pirate (ïntf 133 / PICT 705)',
        why: 'InherentGovt 1137 (Pirate), whose Interface is 133',
    },
    {
        id: 'vellos_134', file: 'statusbar/vell-os 134.png',
        ship: 'nova:173', shipName: 'Vell-os Dart',
        bar: 'nova:134', label: 'Vell-os (ïntf 134 / PICT 706)',
        why: 'InherentGovt 136 (Vell-os), whose Interface is 134',
    },
];

function statusBarVariantScenarios() {
    return STATUS_BAR_VARIANTS.map(variant => ({
        id: `statusbar_${variant.id}`,
        title: `Status bar — ${variant.label}`,
        description: `Flying a ${variant.shipName} (${variant.ship}): `
            + `${variant.why}, so the bar must be drawn from ${variant.bar}. `
            + `Compared against the ïntf editor's live preview of that same `
            + `resource (see the header of scenarios_hud.mjs for the (424,51) `
            + `mapping). The preview's readouts are the editor's own fixture `
            + `text and are outside every region; the frame, radar box, `
            + `indicator-bar colours and lower art are the measured signal. `
            + `Our fuel bar is only as full as the ship's tank, so the bars `
            + `region keeps a small residual.`,
        params: { ship: variant.ship, system: 'nova:130' },
        hideDebug: true,
        setup: null,
        references: [{ name: variant.id, file: variant.file }],
        regions: PREVIEW_REGIONS,
    }));
}

export const hudScenarios = [
    ...statusBarVariantScenarios(),

    {
        id: 'statusbar_cargo_manifest',
        title: 'Status bar — loaded cargo manifest',
        description: 'A hold carrying nine tons each of the five commodities '
            + 'board_ship.png shows, so the cargo panel renders the same five '
            + 'manifest lines. Verifies the layout the original uses: dim '
            + 'commodity names down the left column at a 14px pitch with '
            + 'their BRIGHT quantities in a shared column (so "Food: 9" and '
            + '"LuxG: 9" put their 9 at the same x), and a right column of '
            + 'dim label + bright value pairs — "Free:" and its count on one '
            + 'row, then "Special:"/"Credits:" over their indented values at '
            + 'fixed rows. Free space and the credit balance legitimately '
            + 'differ (a Terrapin\'s hold, not the reference pilot\'s), and '
            + 'our Special line reads the generic "Cargo" where the original '
            + "names the mission's own commodity (\"Probe\") — a known "
            + 'content gap.',
        save: {
            ship: 'nova:136', outfits: [], system: 'nova:130',
            credits: 510429,
            cargo: [['cargo:0', 9], ['cargo:1', 9], ['cargo:2', 9],
                ['cargo:3', 9], ['cargo:4', 9], ['mission:nova:700', 6]],
        },
        hideDebug: true,
        setup: null,
        references: [
            { name: 'board_ship', file: 'space/board_ship.png' },
            { name: 'in_space_3', file: 'space/in_space_3.png' },
        ],
        regions: [
            region('cargo_pane', 'Cargo panel', 1734, 456, 178, 96),
            region('cargo_manifest', 'Manifest column (names + quantities)',
                1734, 456, 70, 76),
            region('cargo_right_column', 'Free / Special / Credits column',
                1806, 456, 100, 90),
        ],
    },

    {
        id: 'statusbar_target_pane',
        title: 'Status bar — locked target readout',
        description: 'A spawned ship targeted with the next-target control, so '
            + "the target pane fills in. The original draws the locked ship's "
            + 'sprite RED-ONLY (every pixel of the reference pane is #RR0000, '
            + 'with no green or blue at all), the ship name bright with its '
            + 'class subtitle bright underneath, "Shield:" dim with a bright '
            + 'percentage bottom-left and the government dim bottom-right. '
            + 'Which ship gets spawned and targeted is random, so the pane\'s '
            + 'text is CONTENT; what this measures is that the pane renders '
            + 'in the right places and the silhouette is red.',
        params: { ship: 'nova:133', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            await page.evaluate(() => {
                const dw = window.displayWorld;
                for (const [k] of dw.events) {
                    if (k.name === 'AddEnemyEvent') {
                        dw.emit(k, { shipId: 'nova:128' });
                        break;
                    }
                }
            });
            await driver.sleep(4000);
            await driver.pressKey(page, 'Tab');
            await driver.sleep(1200);
        },
        references: [
            { name: 'in_space', file: 'space/in_space.png' },
        ],
        regions: [
            region('target_pane', 'Target pane', 1734, 330, 178, 112),
            region('target_bottom_row', 'Shield / government row',
                1734, 424, 178, 18),
        ],
    },

    {
        id: 'map_properties_column',
        title: 'Star map — properties column & bottom readouts',
        description: 'The star map over Sol, measured on the parts of the '
            + 'right-hand column that are the same on both sides. The five '
            + 'captions sit at FIXED rows in the original — 297 / 360 / 404 / '
            + '440 / 535 on every map reference, whatever the length of the '
            + 'Goods Traded list above them — and are drawn in #c0c0c0 with '
            + 'their values indented 5px and white. Sol\'s values (Federation, '
            + 'Citizen, the six commodities, the three services) match ours, '
            + 'so this column is genuinely comparable; the map GRAPH beside it '
            + 'is not (our Nova_Data carries plug-ins the reference machine '
            + 'did not, so the systems themselves differ) and is excluded.',
        params: { ship: 'nova:133', system: 'nova:130' },
        hideDebug: true,
        setup: async (page, driver) => {
            await driver.discoverAllSystems(page);
            await driver.openStarmap(page);
        },
        references: [
            { name: 'borders_off', file: 'map/borders_off.png' },
            { name: 'single_jump', file: 'map/map_single_jump_route.png' },
        ],
        regions: [
            region('map_prop_captions', 'Caption column (fixed rows)',
                1142, 294, 90, 250),
            region('map_prop_values', 'Values under the captions',
                1147, 306, 110, 240),
            region('map_ports_label', '"Ports:" caption', 674, 721, 40, 16),
            region('map_hazards_label', '"Navigation Hazards:" caption',
                674, 745, 96, 16),
        ],
    },

    {
        id: 'status_line',
        title: 'Space view — bottom-left status line',
        description: 'The transient status message the game writes in the '
            + "bottom-left corner (status_text.txt). The original's line "
            + 'starts at x=25 and its descenders reach y=1071 of 1080 '
            + '(measured on map/mini_map/mini_map.png, "Jumping into the Tau '
            + 'Ceti system on March 17th, 1178 NC."), which is what the '
            + 'inset constants now reproduce. The SENTENCE differs — ours '
            + 'names the system and date this capture actually arrived in — '
            + 'so the region measures where the line sits, not what it says.',
        params: { ship: 'nova:133', system: 'nova:130' },
        hideDebug: true,
        setup: null,
        references: [
            { name: 'mini_map', file: 'map/mini_map/mini_map.png' },
        ],
        regions: [
            region('status_line_start', 'First words of the status line',
                20, 1055, 120, 22),
        ],
    },
];
