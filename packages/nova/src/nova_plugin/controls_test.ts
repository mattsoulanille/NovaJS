import { isLeft } from 'fp-ts/lib/Either.js';
import 'jasmine';
import { Controls, getActions, SavedControls } from './controls.js';

describe('SavedControls', () => {
    it('parses single keys', () => {
        const savedControls = {
            nextTarget: 'Tab',
            firePrimary: 'Space',
        }
        const decoded = SavedControls.decode(savedControls);
        if (isLeft(decoded)) {
            throw new Error('Failed to decode');
        }

        expect(decoded.right).toEqual(new Map([
            ['nextTarget', [{ key: 'Tab', modifiers: [] }]],
            ['firePrimary', [{ key: 'Space', modifiers: [] }]],
        ]));
    });

    it('parses multiple keys', () => {
        const savedControls = {
            nextTarget: 'Tab',
            firePrimary: ['Space', 'KeyF'],
        }
        const decoded = SavedControls.decode(savedControls);
        if (isLeft(decoded)) {
            throw new Error('Failed to decode');
        }

        expect(decoded.right).toEqual(new Map([
            ['nextTarget', [{ key: 'Tab', modifiers: [] }]],
            ['firePrimary', [
                { key: 'Space', modifiers: [] },
                { key: 'KeyF', modifiers: [] },
            ]],
        ]));
    });

    it('parses keys with modifiers', () => {
        const savedControls = {
            nextTarget: { key: 'Tab', modifiers: ['Control'] },
            firePrimary: { key: 'Space' }
        }
        const decoded = SavedControls.decode(savedControls);
        if (isLeft(decoded)) {
            throw new Error('Failed to decode');
        }

        expect(decoded.right).toEqual(new Map([
            ['nextTarget', [
                { key: 'Tab', modifiers: ['Control'] }
            ]],
            ['firePrimary', [
                { key: 'Space', modifiers: [] },
            ]],
        ]));
    });

    // Finding B on #84: the is-guard was a seedless reduce (throws on
    // an empty Map) that also tested each value as ONE record rather
    // than the record list, so it rejected every populated map too.
    it('is-guard accepts an empty map and a decoded map', () => {
        expect(SavedControls.is(new Map())).toBe(true);
        const decoded = SavedControls.decode({ nextTarget: 'Tab' });
        if (isLeft(decoded)) {
            throw new Error('Failed to decode');
        }
        expect(SavedControls.is(decoded.right)).toBe(true);
        expect(SavedControls.is(new Map([['nextTarget', 'Tab']]))).toBe(false);
        expect(SavedControls.is({})).toBe(false);
    });

    it('encodes controls to an object', () => {
        const savedControls = {
            nextTarget: { key: 'Tab', modifiers: ['Control'] },
            firePrimary: 'space',
        };
        const decoded = SavedControls.decode(savedControls);
        if (isLeft(decoded)) {
            throw new Error('Failed to decode');
        }
        const encoded = SavedControls.encode(decoded.right);
        expect(encoded).toEqual(savedControls);
    });
});

describe('Controls', () => {
    it('stores controls by keyboard key', () => {
        const savedControls: SavedControls = new Map([
            ['firePrimary', [
                { key: 'Space', modifiers: [] }
            ]],
            ['nextTarget', [
                { key: 'Tab', modifiers: [] }
            ]]
        ]);
        const controls = Controls.decode(savedControls);
        if (isLeft(controls)) {
            throw new Error('Failed to decode');
        }

        expect(controls.right).toEqual(new Map([
            ['Space', [{ action: 'firePrimary', modifiers: [] }]],
            ['Tab', [{ action: 'nextTarget', modifiers: [] }]]
        ]));
    });

    it('sorts actions by length of modifier list ', () => {
        const savedControls: SavedControls = new Map([
            ['firePrimary', [
                { key: 'Tab', modifiers: [] }
            ]],
            ['nextTarget', [
                { key: 'Tab', modifiers: ['Control', 'Alt'] }
            ]],
            ['depart', [
                { key: 'Tab', modifiers: ['Control'] }
            ]]
        ]);
        const controls = Controls.decode(savedControls);
        if (isLeft(controls)) {
            throw new Error('Failed to decode');
        }

        expect(controls.right).toEqual(new Map([
            ['Tab', [
                { action: 'nextTarget', modifiers: ['Control', 'Alt'] },
                { action: 'depart', modifiers: ['Control'] },
                { action: 'firePrimary', modifiers: [] },
            ]]
        ]));
    })

    it('is-guard accepts an empty map and a decoded map', () => {
        expect(Controls.is(new Map())).toBe(true);
        const controls = Controls.decode(new Map([
            ['firePrimary', [{ key: 'Space', modifiers: [] }]]]));
        if (isLeft(controls)) {
            throw new Error('Failed to decode');
        }
        expect(Controls.is(controls.right)).toBe(true);
        expect(Controls.is(new Map([['Space', 'firePrimary']]))).toBe(false);
    });

    it('encodes Controls to SavedControls', () => {
        const savedControls: SavedControls = new Map([
            ['firePrimary', [
                { key: 'Tab', modifiers: [] }
            ]],
            ['nextTarget', [
                { key: 'Tab', modifiers: ['Control', 'Alt'] }
            ]],
            ['depart', [
                { key: 'Tab', modifiers: ['Control'] }
            ]]
        ]);
        const controls = Controls.decode(savedControls);
        if (isLeft(controls)) {
            throw new Error('Failed to decode');
        }

        const encoded = Controls.encode(controls.right);

        expect(encoded).toEqual(savedControls);
    });
});

describe('getActions', () => {
    // Tab is nextTarget bare and escortTarget with Alt — the live
    // layout this specificity rule exists for.
    const controls: Controls = new Map([
        ['Tab', [
            { action: 'escortTarget', modifiers: ['Alt'] },
            { action: 'nextTarget', modifiers: [] },
        ]],
    ]);

    function keyEvent(code: string, pressedModifiers: string[]) {
        return {
            code,
            getModifierState: (modifier: string) =>
                pressedModifiers.includes(modifier),
        } as unknown as KeyboardEvent;
    }

    it('fires the bare binding on an unmodified press', () => {
        expect(getActions(controls, keyEvent('Tab', [])))
            .toEqual(['nextTarget']);
    });

    it('the most specific matching binding wins: Alt+Tab fires ONLY ' +
        'escortTarget, not nextTarget too', () => {
            expect(getActions(controls, keyEvent('Tab', ['Alt'])))
                .toEqual(['escortTarget']);
        });

    it('returns nothing for unbound keys', () => {
        expect(getActions(controls, keyEvent('KeyQ', []))).toEqual([]);
    });
});
