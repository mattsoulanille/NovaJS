import { isLeft } from 'fp-ts/Either';
import 'jasmine';
import { Controls, SavedControls } from './controls';

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
