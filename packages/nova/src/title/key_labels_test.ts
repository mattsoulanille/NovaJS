import 'jasmine';
import { bindingLabel, keyLabel } from './key_labels.js';

describe('keyLabel', () => {
    it('maps arrow keys to glyphs', () => {
        expect(keyLabel('ArrowUp')).toBe('↑');
        expect(keyLabel('ArrowDown')).toBe('↓');
        expect(keyLabel('ArrowLeft')).toBe('←');
        expect(keyLabel('ArrowRight')).toBe('→');
    });

    it('maps letter and digit codes to their character', () => {
        expect(keyLabel('KeyA')).toBe('A');
        expect(keyLabel('KeyZ')).toBe('Z');
        expect(keyLabel('Digit5')).toBe('5');
    });

    it('names Space and function keys', () => {
        expect(keyLabel('Space')).toBe('Space');
        expect(keyLabel('F12')).toBe('F12');
    });

    it('maps punctuation codes to their symbol', () => {
        expect(keyLabel('Backquote')).toBe('`');
        expect(keyLabel('Minus')).toBe('-');
    });

    it('labels numpad keys', () => {
        expect(keyLabel('Numpad5')).toBe('Num 5');
    });

    it('is empty for an unset binding', () => {
        expect(keyLabel(undefined)).toBe('');
        expect(keyLabel('')).toBe('');
    });

    it('falls back to the raw code for unknown values', () => {
        expect(keyLabel('MediaPlayPause')).toBe('MediaPlayPause');
    });
});

describe('bindingLabel', () => {
    it('prepends modifier glyphs ahead of the key label', () => {
        expect(bindingLabel({ key: 'KeyF', modifiers: ['Alt'] })).toBe('⌥F');
        expect(bindingLabel({ key: 'Minus', modifiers: ['Alt', 'Shift'] }))
            .toBe('⌥⇧-');
        expect(bindingLabel({ key: 'ArrowUp', modifiers: [] })).toBe('↑');
        expect(bindingLabel(undefined)).toBe('');
    });
});
