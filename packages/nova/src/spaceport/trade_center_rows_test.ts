import { TradeGood } from '../nova_plugin/economy/trade_logic.js';
import {
    missionCargoTons, priceEventSentence, tradeSlot,
} from './trade_center.js';

const good = (key: string, name: string,
    event?: TradeGood['event']): TradeGood => ({
        key, name, tier: 'med', price: 100,
        canBuy: true, canSell: true, event,
    });

describe('trade center rows', () => {
    describe('tradeSlot', () => {
        /**
         * The original's exchange keeps a fixed row for each of the six
         * standard commodities. Earth does not trade Equipment (index 5)
         * and still shows its Duranium Alloy jünk row on row 6, leaving
         * row 5 blank (trade_center/earth_trade_center.png); Port Kane,
         * which trades all six, puts its jünk row on the same row 6
         * (trade_center_port_kane_...png).
         */
        it('keeps a standard commodity on its own STR# 4000 row', () => {
            const goods = [good('cargo:0', 'Food'),
                good('cargo:3', 'Luxury Goods')];
            expect(tradeSlot(goods[0], goods)).toBe(0);
            expect(tradeSlot(goods[1], goods)).toBe(3);
        });

        it('leaves an untraded commodity\'s row blank', () => {
            // Earth's five commodities skip index 5 (Equipment); the
            // jünk row still lands on 6, not on 5.
            const goods = [
                good('cargo:0', 'Food'), good('cargo:1', 'Industrial'),
                good('cargo:2', 'Medical Supplies'),
                good('cargo:3', 'Luxury Goods'), good('cargo:4', 'Metal'),
                good('junk:nova:200', 'Duranium Alloy'),
            ];
            expect(goods.map(g => tradeSlot(g, goods)))
                .toEqual([0, 1, 2, 3, 4, 6]);
        });

        it('stacks jünk rows below the six standard slots', () => {
            const goods = [
                good('cargo:0', 'Food'),
                good('junk:nova:200', 'Duranium Alloy'),
                good('junk:nova:201', 'Ancient Vell-os Sculpture'),
            ];
            expect(goods.map(g => tradeSlot(g, goods))).toEqual([0, 6, 7]);
        });
    });

    describe('missionCargoTons', () => {
        it('sums only the mission cargo', () => {
            expect(missionCargoTons(new Map([
                ['cargo:0', 12], ['mission:nova:700', 5],
                ['mission:nova:701', 2], ['junk:nova:200', 3],
            ]))).toBe(7);
        });

        it('is zero for a hold with no mission cargo', () => {
            expect(missionCargoTons(new Map([['cargo:0', 12]]))).toBe(0);
        });
    });

    describe('priceEventSentence', () => {
        /**
         * The öops resource's name is only the subject; the original
         * completes the sentence from STR# 2002 (191 "has", 192
         * "raised" / 193 "lowered", 180 "the price of"), producing the
         * reference's line verbatim.
         */
        it('completes the öops name into the reference sentence', () => {
            expect(priceEventSentence(good('cargo:0', 'Food', {
                name: 'An enormous food surplus', direction: 'lower',
            }))).toBe('An enormous food surplus has lowered the price '
                + 'of food.');
        });

        it('uses "raised" for a positive delta', () => {
            expect(priceEventSentence(good('cargo:2', 'Medical Supplies', {
                name: 'A plague', direction: 'higher',
            }))).toBe('A plague has raised the price of medical supplies.');
        });

        it('is empty for a commodity with no event', () => {
            expect(priceEventSentence(good('cargo:0', 'Food'))).toBe('');
        });
    });
});
