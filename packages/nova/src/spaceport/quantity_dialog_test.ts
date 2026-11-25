import 'jasmine';
import { Subject } from 'rxjs';
import { ControlEvent } from '../nova_plugin/core/index.js';
import { isTextEntryActive } from '../input_focus.js';
import { PromptField } from './alert_prompt.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import {
    clampQuantity, editQuantityField, editQuantityText, QuantityDialog,
} from './quantity_dialog.js';

const field = (text: string, selected = false): PromptField =>
    ({ text, selected });

describe('editQuantityField', () => {
    it('replaces the opening selection with the first digit typed', () => {
        expect(editQuantityField(field('390', true), '5'))
            .toEqual(field('5'));
        expect(editQuantityField(field('5'), '0')).toEqual(field('50'));
    });

    it('clears the selection with Backspace or Delete', () => {
        expect(editQuantityField(field('390', true), 'Backspace'))
            .toEqual(field(''));
        expect(editQuantityField(field('390', true), 'Delete'))
            .toEqual(field(''));
        expect(editQuantityField(field('390'), 'Backspace'))
            .toEqual(field('39'));
        // The caret sits at the end: nothing after it to delete.
        expect(editQuantityField(field('390'), 'Delete')).toBeUndefined();
    });

    it('drops the selection on the arrows, keeping the text', () => {
        expect(editQuantityField(field('390', true), 'ArrowLeft'))
            .toEqual(field('390'));
        expect(editQuantityField(field('390', true), 'End'))
            .toEqual(field('390'));
    });

    it('selects everything on Command-A / Control-A', () => {
        expect(editQuantityField(field('390'), 'a', { meta: true }))
            .toEqual(field('390', true));
        expect(editQuantityField(field('390'), 'A', { ctrl: true }))
            .toEqual(field('390', true));
        expect(editQuantityField(field(''), 'a', { meta: true }))
            .toEqual(field(''));
        expect(editQuantityField(field('390'), 'v', { meta: true }))
            .toBeUndefined();
    });

    it('ignores letters, selected or not', () => {
        for (const key of ['d', 'b', 's', ' ', '-', 'e']) {
            expect(editQuantityField(field('12', true), key))
                .toBeUndefined();
        }
    });
});

describe('QuantityDialog', () => {
    beforeAll(() => installHeadlessPixi());

    it('opens with its prefill selected and answers it untouched', async () => {
        const dialog = new QuantityDialog(new Subject<ControlEvent>());
        const answer = dialog.show({ verb: 'Buy', initial: 390, max: 390 });
        expect(dialog.container.visible).toBeTrue();
        expect(dialog.value).toEqual(field('390', true));
        expect(isTextEntryActive()).toBeTrue();
        dialog.confirm();
        expect(await answer).toBe(390);
        expect(dialog.container.visible).toBeFalse();
        expect(isTextEntryActive()).toBeFalse();
    });

    it('resolves undefined on Cancel', async () => {
        const dialog = new QuantityDialog(new Subject<ControlEvent>());
        const answer = dialog.show({ verb: 'Sell', initial: 3, max: 3 });
        dialog.cancel();
        expect(await answer).toBeUndefined();
    });

    it('names its Aqua buttons for headless driving', () => {
        const dialog = new QuantityDialog(new Subject<ControlEvent>());
        void dialog.show({ verb: 'Bet', initial: 10, max: 100 });
        expect(dialog.container.getChildByName('Button:Cancel', true))
            .toBeTruthy();
        expect(dialog.container.getChildByName('Button:Bet', true))
            .toBeTruthy();
        dialog.cancel();
    });
});

describe('editQuantityText', () => {
    it('appends typed digits', () => {
        expect(editQuantityText('', '1')).toBe('1');
        expect(editQuantityText('1', '0')).toBe('10');
    });

    it('replaces a lone zero instead of making a leading zero', () => {
        expect(editQuantityText('0', '5')).toBe('5');
        expect(editQuantityText('0', '0')).toBe('0');
    });

    it('deletes with Backspace', () => {
        expect(editQuantityText('10', 'Backspace')).toBe('1');
        expect(editQuantityText('', 'Backspace')).toBe('');
    });

    it('ignores everything that is not a digit or Backspace', () => {
        // Letters must not edit the field: 'd' cancels, 'b'/'s' are
        // navigation keys elsewhere, and none of them belong in a
        // quantity.
        for (const key of ['d', 'b', 's', 'ArrowUp', ' ', '-', '.', 'e']) {
            expect(editQuantityText('12', key)).toBeUndefined();
        }
    });

    it('stops appending at the field capacity', () => {
        const full = '999999999';
        expect(editQuantityText(full, '1')).toBe(full);
    });
});

describe('clampQuantity', () => {
    it('parses the entered quantity', () => {
        expect(clampQuantity('8', 100)).toBe(8);
        expect(clampQuantity('42', 100)).toBe(42);
    });

    it('clamps over-entered quantities to the most allowed', () => {
        expect(clampQuantity('5000', 3977)).toBe(3977);
        expect(clampQuantity('999999999', 1)).toBe(1);
    });

    it('treats empty and zero entries as nothing', () => {
        expect(clampQuantity('', 100)).toBe(0);
        expect(clampQuantity('0', 100)).toBe(0);
    });

    it('never returns a negative quantity', () => {
        expect(clampQuantity('5', -3)).toBe(0);
    });
});
