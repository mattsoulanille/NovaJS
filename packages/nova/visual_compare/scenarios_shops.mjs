// Shipyard / outfitter / ship-info scenarios for the "shops" fidelity
// pass. Kept out of scenarios.mjs so several passes can extend the
// harness at once; scenarios.mjs imports and splices this array in.
//
// What is measurable here and what is not
// ---------------------------------------
// The two grids are DYNAMIC. Our BuyRandom day roll is off, so the
// shipyard lists every variant of a hull (four "Shuttle" tiles) where the
// original's capture shows one plus its "- used -" twin; the outfitter's
// visibility bits likewise differ from the reference pilot's. Any region
// that covers tile ARTWORK or CAPTIONS therefore diffs for reasons that
// have nothing to do with layout.
//
// So the grid regions below are deliberately thin strips over the
// lattice RULES themselves (the 1px 0x404040 borders at screen x
// 587/670/753/836/919 and y 387/441/... ), which are pure geometry and
// identical whatever is stocked. The panes, price/mass readouts, denial
// caption and button rows are compared as whole blocks, because those do
// not depend on the stock.

const region = (id, label, x, y, width, height, extra = {}) => ({
    id, label, ref: { x, y, width, height }, ours: { x, y, width, height },
    ...extra,
});

/** The shipyard opened at Earth, with the first tile selected. */
const openShipyard = async (page, driver) => {
    await driver.landAt(page, 'planet nova:128');
    await driver.dismissOfferPopup(page);
    await driver.clickContainer(page, 'Button:Shipyard');
    await driver.waitForContainer(page, 'Shipyard');
    await driver.pressKey(page, 'ArrowRight');
    await driver.sleep(1200);
};

const openOutfitter = async (page, driver) => {
    await driver.landAt(page, 'planet nova:128');
    await driver.dismissOfferPopup(page);
    await driver.clickContainer(page, 'Button:Outfitter');
    await driver.waitForContainer(page, 'Outfitter');
    await driver.sleep(1200);
};

export function shopScenarios() {
    return [
        {
            id: 'shops_shipyard_lattice',
            title: 'Shipyard grid lattice (tile geometry only)',
            description: 'The ship grid\'s 1px borders, compared as thin '
                + 'strips that miss the tile artwork and captions entirely. '
                + 'shipyard/earth_spaceport.png puts the vertical rules at '
                + 'screen x 587/670/753/836/919 and the horizontal ones at y '
                + '387/441/495/549 (83x54 tiles from 587,387). WHICH ships '
                + 'are stocked legitimately differs -- our BuyRandom roll is '
                + 'disabled, so every hull variant is listed -- which is '
                + 'exactly why nothing here overlaps a tile\'s contents.',
            params: { ship: 'nova:164', system: 'nova:130' },
            hideDebug: true,
            setup: openShipyard,
            references: [
                { name: 'earth_shipyard', file: 'shipyard/earth_spaceport.png' },
            ],
            regions: [
                region('grid_rule_top', 'Top rule + 4 verticals (row 1)',
                    585, 385, 337, 5),
                region('grid_rule_row2', 'Rule between rows 1 and 2',
                    585, 439, 337, 5),
                region('grid_rule_row3', 'Rule between rows 2 and 3',
                    585, 493, 337, 5),
                region('grid_rule_left', 'Left rule down three rows',
                    585, 385, 5, 167),
                // Three columns ending ON the rule. The frame's inner
                // bevel immediately right of it (x 920-922) is left out
                // on purpose: the geometry there matches, but we decode
                // that highlight brighter than the original (lum 132/118/
                // 112 against 84/76/66) -- a PICT colour question for the
                // whole 8502/8500 chrome, not this grid's layout.
                region('grid_rule_right', 'Right rule down three rows',
                    917, 385, 3, 167),
            ],
        },
        {
            id: 'shops_shipyard_price_rows',
            title: 'Shipyard price pane — label and value columns',
            description: 'The four price rows under the ship picture. '
                + 'shipyard/earth_spaceport.png has the labels\' ink at screen '
                + 'x 1192 and the values\' at 1262, on rows whose ink tops are '
                + 'at y 598/610/634/658. The AMOUNTS differ (a different '
                + 'pilot, ship and balance), so the label column is measured '
                + 'on its own as well as the whole pane.',
            params: { ship: 'nova:164', system: 'nova:130' },
            hideDebug: true,
            setup: openShipyard,
            references: [
                { name: 'earth_shipyard', file: 'shipyard/earth_spaceport.png' },
            ],
            regions: [
                region('price_labels', 'Label column (wording + rows)',
                    1190, 594, 60, 74),
                region('price_pane', 'Whole price pane', 1185, 590, 158, 100),
                region('price_row_pitch', 'Ship Price / Trade-In pair',
                    1190, 596, 150, 24),
            ],
        },
        {
            id: 'shops_outfitter_info_pane',
            title: 'Outfitter info pane — price and mass readouts',
            description: 'An outfit selected so the right pane fills in. '
                + 'The original puts "Item Price:"/"You Have:" ink tops at '
                + 'screen y 599/611 and "Item Mass:"/"Available:" at 635/647, '
                + 'all starting at x 1196 with values at 1266 -- four pixels '
                + 'right and one down from the shipyard\'s pane, which is why '
                + 'the two menus carry separate constants. Values differ '
                + '(different outfit, different pilot).',
            params: { ship: 'nova:164', system: 'nova:130' },
            hideDebug: true,
            setup: async (page, driver) => {
                await openOutfitter(page, driver);
                // Any outfit with a mass makes all four rows show.
                await driver.pressKey(page, 'ArrowRight');
                await driver.sleep(600);
            },
            references: [
                { name: 'cant_hold_any',
                    file: 'outfitter/earth_outfitter_cant_hold_any.png' },
            ],
            regions: [
                region('info_labels', 'Label column (all four rows)',
                    1194, 594, 62, 62),
                region('info_pane', 'Whole info pane', 1188, 594, 148, 92),
            ],
        },
        {
            id: 'shops_outfitter_lattice',
            title: 'Outfitter grid lattice (tile geometry only)',
            description: 'The outfit grid\'s 1px borders. Note the original\'s '
                + 'outfitter lattice starts one pixel BELOW the shipyard\'s: '
                + 'its top rule runs y 388..658 (five 54px rows) against the '
                + 'shipyard\'s 387..549. Stock differs, so again only the '
                + 'rules are compared.',
            params: { ship: 'nova:164', system: 'nova:130' },
            hideDebug: true,
            setup: openOutfitter,
            references: [
                { name: 'earth_outfitter', file: 'outfitter/earth_outfitter.png' },
            ],
            regions: [
                region('grid_rule_top', 'Top rule + verticals',
                    585, 386, 337, 5),
                region('grid_rule_row2', 'Rule between rows 1 and 2',
                    585, 440, 337, 5),
                region('grid_rule_bottom', 'Bottom rule (row 5)',
                    585, 656, 337, 5),
                region('grid_rule_left', 'Left rule, full height',
                    585, 386, 5, 275),
            ],
        },
        {
            id: 'shops_outfitter_denial_owned',
            title: 'Outfitter denial caption — an outfit already owned',
            description: 'The pilot bulk-buys several outfits, then '
                + 're-selects one it already holds the most of: the info '
                + 'pane keeps a "Can\'t have any more!" caption up and Buy '
                + 'greys, which is exactly '
                + 'outfitter/earth_outfitter_cant_have_any_more.png. The '
                + 'caption band is compared on its own -- the WORDING and '
                + 'its baseline are the measurement; the glyph shapes are '
                + 'not (a different font rasterizer). '
                + 'The three sibling wordings are pinned by unit test '
                + '(shop_captions_test.ts) rather than driven here, because '
                + 'reaching each denial REASON on demand needs a hand-built '
                + 'hold: "Can\'t have any of this item!", "Can\'t hold any of '
                + 'this item!" and "Can\'t hold any more!" (the last read off '
                + 'the carbon-fibre capture, where the pilot owns three).',
            // A fat balance so the HOLD, not the wallet, is what runs out
            // (with the default purse the bulk buys trip "Can't afford
            // this item!" first, which is a different caption).
            save: {
                ship: 'nova:164', outfits: [], system: 'nova:130',
                credits: 5000000,
            },
            hideDebug: true,
            setup: async (page, driver) => {
                await openOutfitter(page, driver);
                // Skip the first tile (a mission-granting Trainee
                // Program), then bulk-buy until the hold is full.
                for (let i = 0; i < 6; i++) {
                    await driver.pressKey(page, 'ArrowRight');
                    await driver.sleep(150);
                    await driver.optionClick(page, 'Button:Buy');
                    await driver.sleep(400);
                    await driver.pressKey(page, 'Enter');
                    await driver.sleep(300);
                }
                // Step BACK to an outfit the early, roomy iterations
                // actually bought. Selecting an owned outfit while the
                // hold is full is what raises the "any more" caption and
                // greys Buy; the last tile the loop touched may have been
                // refused outright (nothing bought, so nothing owned) and
                // would show the "of this item" wording instead.
                await driver.pressKeyN(page, 'ArrowLeft', 5);
                await driver.sleep(400);
                await driver.clickContainer(page, 'Button:Buy');
                await driver.sleep(500);
            },
            references: [
                { name: 'cant_have_any_more',
                    file: 'outfitter/earth_outfitter_cant_have_any_more.png' },
            ],
            regions: [
                region('denial_caption', 'Denial caption line',
                    1192, 676, 144, 16),
                region('info_pane', 'Info pane incl. caption',
                    1188, 594, 148, 96),
                region('button_row', 'Buy (greyed) / Sell / Done',
                    660, 668, 520, 30),
            ],
        },
        {
            id: 'shops_ship_info_stats',
            title: 'Ship info dialog (8507) — name strip and stat block',
            description: 'The Shuttle\'s More Info dialog. The name strip '
                + 'prints the shïp Long Name ("Sigma Shipyards Alpha class '
                + 'Shuttle"), not the resource name, and the seven left-column '
                + 'stat rows sit on a flat 12px pitch with ink tops at screen '
                + 'y 719..791. The 600x400 info PICT is blitted 1:1 in the '
                + 'frame\'s well at screen x 660..1259, y 278..677 (all three '
                + 'shipyard/*_info.png captures); the picture region covers it '
                + 'plus the bevel around it, so a scaled or offset picture '
                + 'shows up as a gap inside the bevel.',
            params: { ship: 'nova:164', system: 'nova:130' },
            hideDebug: true,
            setup: async (page, driver) => {
                await driver.landAt(page, 'planet nova:128');
                await driver.dismissOfferPopup(page);
                await driver.clickContainer(page, 'Button:Shipyard');
                await driver.waitForContainer(page, 'Shipyard');
                await driver.clickGridTile(page, 'Shipyard', 'Shuttle');
                await driver.clickContainer(page, 'Button:Info');
                await driver.waitForContainer(page, 'ShipInfo');
                await driver.sleep(1200);
            },
            references: [
                { name: 'shuttle_info', file: 'shipyard/shuttle_info.png' },
            ],
            regions: [
                region('shipinfo_pict', 'Picture well incl. bevel',
                    653, 272, 614, 412),
                region('shipinfo_name_strip', 'Long Name strip',
                    655, 682, 610, 30),
                region('shipinfo_stats_left', 'Speed..Turrets column',
                    656, 715, 110, 84),
                region('shipinfo_stats_mid', 'Space..Crew column',
                    788, 715, 110, 84),
                region('shipinfo_weapons', 'Standard Weapons block',
                    906, 715, 200, 30),
                region('shipinfo_done', 'Done button', 1168, 780, 90, 24),
            ],
        },
    ];
}
