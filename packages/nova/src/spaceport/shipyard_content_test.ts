import 'jasmine';
import { getDefaultOutfitData, OutfitData } from 'novadatainterface/outfit_data';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { Entity } from 'nova_ecs/entity';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { makeShip, OutfitsStateComponent } from '../nova_plugin/ship/index.js';
import { CreditsComponent } from '../nova_plugin/player/index.js';
import {
    buttonRightEdge,
    SHIPYARD_BUTTONS,
    SHIPYARD_PRICE_COLUMNS,
    SHIPYARD_PRICE_LABELS,
    SHIPYARD_PRICE_ROWS,
    shipyardPriceReadout,
} from './shipyard_content.js';
import {
    buildPurchasedShip,
    purchaseContextFrom,
    ShipPurchaseContext,
    shipPurchasePrice,
    tradeInValue,
} from './shipyard_rules.js';

/**
 * The shipyard's price pane. The Shipyard menu itself is PIXI-bound, so
 * as elsewhere in this package the pane is tested through the pure
 * function it delegates to, exercised in the same composition the menu
 * performs (purchaseContextFrom -> shipyardPriceReadout, re-run on every
 * selection change and after each purchase).
 *
 * The point of every spec here is that the quoted numbers are the SAME
 * numbers the purchase charges: each expectation is written against
 * tradeInValue / shipPurchasePrice rather than against a restated
 * formula, so a change to the rules cannot silently leave the display
 * quoting the old ones.
 */
describe('shipyard price pane', () => {
    function outfit(id: string, fields: Partial<OutfitData> = {}): OutfitData {
        return {
            ...getDefaultOutfitData(), id, ...fields,
            physics: { freeMass: 0, ...fields.physics },
        };
    }

    function ship(id: string, fields: Partial<ShipData> = {}): ShipData {
        const base = getDefaultShipData();
        return {
            ...base, id, ...fields,
            physics: { ...base.physics, ...fields.physics },
        };
    }

    function context(fields: {
        currentShip: ShipData,
        outfits?: [string, number][],
        catalogue?: OutfitData[],
        credits?: number,
    }): ShipPurchaseContext {
        const byId = new Map((fields.catalogue ?? []).map(o => [o.id, o]));
        return {
            currentShip: fields.currentShip,
            outfits: new Map(fields.outfits ?? []),
            getOutfit: id => byId.get(id),
            credits: fields.credits ?? Infinity,
        };
    }

    it('labels the rows as the original does', () => {
        // ui_screenshots/original_macos_screenshots/shipyard/
        // earth_spaceport.png, the pane under the ship picture.
        expect(SHIPYARD_PRICE_LABELS).toEqual({
            shipPrice: 'Ship Price:',
            tradeIn: 'Trade-In:',
            finalPrice: 'Final Price:',
            youHave: 'You Have:',
        });
    });

    describe('button row', () => {
        it('is Info / Buy Ship / Done, in that order', () => {
            // earth_spaceport.png: three pills under the browse pane.
            // The middle one says "Buy Ship", not "Buy". There is no
            // fourth button in the shipyard — the ship-info dialog owns
            // its own Done, and there is no confirm dialog in our
            // shipyard yet (documented seam in shipyard_rules.ts).
            expect(Object.keys(SHIPYARD_BUTTONS)).toEqual(
                ['info', 'buy', 'done']);
            expect(Object.values(SHIPYARD_BUTTONS).map(b => b.label))
                .toEqual(['Info', 'Buy Ship', 'Done']);
        });

        it('keeps the measured pill geometry', () => {
            // Inverted from the reference's red pill faces at screen x
            // 836-910 / 948-1042 / 1063-1157, all on one row.
            expect(SHIPYARD_BUTTONS).toEqual({
                info: { label: 'Info', width: 63, x: -129, y: 128 },
                buy: { label: 'Buy Ship', width: 83, x: -17, y: 128 },
                done: { label: 'Done', width: 83, x: 98, y: 128 },
            });
            // Buy Ship is wider than Info in the original; a uniform row
            // is what the unmeasured version got wrong.
            expect(SHIPYARD_BUTTONS.buy.width)
                .toBeGreaterThan(SHIPYARD_BUTTONS.info.width);
        });

        it('lays the pills out left to right without overlapping', () => {
            const row = [SHIPYARD_BUTTONS.info, SHIPYARD_BUTTONS.buy,
                SHIPYARD_BUTTONS.done];
            for (const [a, b] of row.slice(0, -1).map((a, i) => [a, row[i + 1]])) {
                expect(buttonRightEdge(a!)).toBeLessThan(b!.x);
            }
            // One row: all three share a y.
            expect(new Set(row.map(b => b.y)).size).toBe(1);
        });

        it('clears the price pane', () => {
            // The widened row must not run into the price labels to its
            // right (the reference leaves 35px between the Done pill and
            // the "Ship Price:" column).
            expect(buttonRightEdge(SHIPYARD_BUTTONS.done))
                .toBeLessThan(SHIPYARD_PRICE_COLUMNS.label);
        });
    });

    it('places the price rows on the measured 12px pitch', () => {
        // Text-box tops for ink rows 598 / 610 / 634 / 658 in
        // shipyard/earth_spaceport.png (our glyphs start 2px below the
        // box top).
        expect(SHIPYARD_PRICE_ROWS).toEqual({
            shipPrice: 56, tradeIn: 68, finalPrice: 92, youHave: 116,
        });
        // A blank line before "Final Price:" and another before "You
        // Have:", which is what the doubled gaps encode.
        const { shipPrice, tradeIn, finalPrice, youHave } = SHIPYARD_PRICE_ROWS;
        expect(tradeIn - shipPrice).toBe(12);
        expect(finalPrice - tradeIn).toBe(24);
        expect(youHave - finalPrice).toBe(24);
        expect(SHIPYARD_PRICE_COLUMNS.value)
            .toBeGreaterThan(SHIPYARD_PRICE_COLUMNS.label);
    });

    it('quotes exactly what the purchase rules compute', () => {
        const cannon = outfit('nova:200', { price: 12000 });
        const ctx = context({
            currentShip: ship('nova:100', { price: 40000 }),
            outfits: [['nova:200', 2]],
            catalogue: [cannon],
            credits: 546553,
        });
        const target = ship('nova:101', { price: 200000 });
        const readout = shipyardPriceReadout(target, ctx);

        // 0.25 * (40000 + 2*12000) = 16000; 200000 - 16000 = 184000.
        expect(tradeInValue(ctx)).toBe(16000);
        expect(shipPurchasePrice(target, ctx)).toBe(184000);
        expect(readout).toEqual({
            shipPrice: '200,000 cr',
            tradeIn: '16,000 cr',
            finalPrice: '184,000 cr',
            youHave: '546,553 cr',
        });
    });

    it('shows the same figures the rules return, whatever they are', () => {
        // The drift guard: the displayed strings are the formatted
        // outputs of tradeInValue / shipPurchasePrice, not a second
        // implementation of the 25% formula.
        const cannon = outfit('nova:200', { price: 7777 });
        const ctx = context({
            currentShip: ship('nova:100', { price: 123457 }),
            outfits: [['nova:200', 3]],
            catalogue: [cannon],
            credits: 98765,
        });
        const target = ship('nova:101', { price: 250000 });
        const readout = shipyardPriceReadout(target, ctx);
        expect(readout?.tradeIn)
            .toBe(`${tradeInValue(ctx).toLocaleString()} cr`);
        expect(readout?.finalPrice)
            .toBe(`${shipPurchasePrice(target, ctx).toLocaleString()} cr`);
        expect(readout?.shipPrice).toBe('250,000 cr');
        expect(readout?.youHave).toBe('98,765 cr');
    });

    it('shows the clamped 0 when the trade-in exceeds the price', () => {
        // The reference screenshot's exact case: a Shuttle selected
        // while flying something far more valuable.
        const ctx = context({
            currentShip: ship('nova:100', { price: 282000 }),
            credits: 546553,
        });
        const target = ship('nova:101', { price: 10000 });
        expect(tradeInValue(ctx)).toBe(70500);
        expect(shipPurchasePrice(target, ctx)).toBe(0);
        expect(shipyardPriceReadout(target, ctx)).toEqual({
            shipPrice: '10,000 cr',
            tradeIn: '70,500 cr',
            finalPrice: '0 cr',
            youHave: '546,553 cr',
        });
    });

    it('excludes persistent outfits from the quoted trade-in', () => {
        // oütf 0x0004 is excluded by tradeInValue; the pane inherits it
        // rather than re-deciding. A cloaking device (211) is the one
        // persistent stock outfit with a real price.
        const cloak = outfit('nova:211', { price: 100000, persistent: true });
        const cannon = outfit('nova:200', { price: 12000 });
        const base = {
            currentShip: ship('nova:100', { price: 40000 }),
            catalogue: [cloak, cannon],
            credits: 500000,
        };
        const target = ship('nova:101', { price: 200000 });
        const without = shipyardPriceReadout(target,
            context({ ...base, outfits: [['nova:200', 1]] }));
        const withCloak = shipyardPriceReadout(target,
            context({ ...base, outfits: [['nova:200', 1], ['nova:211', 1]] }));

        // 0.25 * (40000 + 12000) = 13000 either way: the cloak follows
        // the player onto the new hull, so it is not sold with the old.
        expect(without?.tradeIn).toBe('13,000 cr');
        expect(withCloak?.tradeIn).toBe('13,000 cr');
        expect(withCloak?.finalPrice).toBe('187,000 cr');
    });

    it('abbreviates millions the way the outfitter does', () => {
        const ctx = context({
            currentShip: ship('nova:100', { price: 0 }),
            credits: 4500000,
        });
        const target = ship('nova:101', { price: 1500000 });
        expect(shipyardPriceReadout(target, ctx)).toEqual({
            shipPrice: '1.500M cr',
            tradeIn: '0 cr',
            finalPrice: '1.500M cr',
            youHave: '4.500M cr',
        });
    });

    it('quotes nothing with no selection or no loaded hull', () => {
        // The menu blanks the pane instead of quoting a trade-in
        // computed from an incomplete valuation — the same state in
        // which it refuses to sell.
        const ctx = context({ currentShip: ship('nova:100', { price: 40000 }) });
        expect(shipyardPriceReadout(undefined, ctx)).toBeUndefined();
        expect(shipyardPriceReadout(ship('nova:101'), undefined)).toBeUndefined();
    });

    describe('refreshing', () => {
        const cannon = outfit('nova:200', { price: 12000 });

        function player(): Entity {
            const entity = makeShip(ship('nova:100', { price: 40000 }));
            entity.components.set(CreditsComponent, { credits: 500000 });
            entity.components.set(OutfitsStateComponent,
                new Map([['nova:200', { count: 2 }]]));
            entity.components.set(MultiplayerData, { owner: 'peer-1' });
            return entity;
        }

        /** What the menu does on every refresh: rebuild, then re-quote. */
        function quote(entity: Entity, currentShip: ShipData,
            selected: ShipData) {
            return shipyardPriceReadout(selected, purchaseContextFrom(
                entity, currentShip, id =>
                id === cannon.id ? cannon : undefined));
        }

        it('re-quotes when the selection changes', () => {
            const entity = player();
            const current = ship('nova:100', { price: 40000 });
            const cheap = ship('nova:101', { price: 100000 });
            const dear = ship('nova:102', { price: 900000 });

            // Trade-in is a property of what you fly, so it holds across
            // a selection change while price and final price follow the
            // newly selected hull. 0.25 * (40000 + 2*12000) = 16000.
            expect(quote(entity, current, cheap)).toEqual({
                shipPrice: '100,000 cr', tradeIn: '16,000 cr',
                finalPrice: '84,000 cr', youHave: '500,000 cr',
            });
            expect(quote(entity, current, dear)).toEqual({
                shipPrice: '900,000 cr', tradeIn: '16,000 cr',
                finalPrice: '884,000 cr', youHave: '500,000 cr',
            });
        });

        it('re-quotes against the new hull after a purchase', () => {
            // The second-purchase-same-visit case: once the hull swaps,
            // the trade-in is the hull just bought (plus the outfits it
            // came with) and the balance is what is left after paying.
            const entity = player();
            const current = ship('nova:100', { price: 40000 });
            const target = ship('nova:101', { price: 200000 });
            const before = quote(entity, current, target);
            expect(before).toEqual({
                shipPrice: '200,000 cr', tradeIn: '16,000 cr',
                finalPrice: '184,000 cr', youHave: '500,000 cr',
            });

            // Exactly what Shipyard.buyShip does: swap the entity, then
            // point currentShipData at the ship just bought.
            const context = purchaseContextFrom(entity, current,
                id => id === cannon.id ? cannon : undefined);
            const bought = buildPurchasedShip(entity, target, context);
            const after = quote(bought, target, target);

            // The 2 cannons went with the old hull, so the new trade-in
            // is 25% of the 200,000 hull alone; credits are 500,000 less
            // the 184,000 charged.
            expect(after).toEqual({
                shipPrice: '200,000 cr', tradeIn: '50,000 cr',
                finalPrice: '150,000 cr', youHave: '316,000 cr',
            });
            expect(after).not.toEqual(before!);
        });
    });
});
