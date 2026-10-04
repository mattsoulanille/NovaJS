import 'jasmine';
import { assistSlotAction } from './hail_dialog.js';

describe('assistSlotAction (the hail dialog\'s r key)', () => {
    it('requests assistance when the assist offer is present', () => {
        expect(assistSlotAction('main', { assist: { free: false } }))
            .toBe('assist');
    });

    it('begs for mercy against a hostile ship (the slot\'s replacement)',
        () => {
            expect(assistSlotAction('main',
                { bribe: { amount: 500, canAfford: true } })).toBe('beg');
        });

    it('begs a hostile ship that will not be bought too (refused plea)',
        () => {
            expect(assistSlotAction('main', { mercyRefused: 'No way.' }))
                .toBe('beg');
        });

    it('prefers assist if both offers somehow coexist', () => {
        expect(assistSlotAction('main', { assist: {}, bribe: {} }))
            .toBe('assist');
    });

    it('does nothing on the haggle page or with no offers', () => {
        expect(assistSlotAction('haggle', { bribe: {} })).toBeUndefined();
        expect(assistSlotAction('main', {})).toBeUndefined();
        expect(assistSlotAction('main', undefined)).toBeUndefined();
    });
});
