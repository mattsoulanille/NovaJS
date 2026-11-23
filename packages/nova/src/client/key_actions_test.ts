import 'jasmine';
import * as fs from 'fs';
import * as path from 'path';
import { isLeft } from 'fp-ts/lib/Either.js';
import { Controls, SavedControls } from '../nova_plugin/core/index.js';
import { KeyActions } from './key_actions.js';

function stockControls(): Controls {
    const decoded = SavedControls.pipe(Controls).decode(JSON.parse(
        fs.readFileSync(path.resolve(process.cwd(), 'settings/controls.json'),
            'utf8')));
    if (isLeft(decoded)) {
        throw new Error('Failed to decode settings/controls.json');
    }
    return decoded.right;
}

function key(type: 'keydown' | 'keyup', code: string,
    { alt = false, repeat = false } = {}) {
    return {
        type, code, repeat,
        getModifierState: (modifier: string) => alt && modifier === 'Alt',
    } as unknown as KeyboardEvent;
}

describe('KeyActions', () => {
    const controls = stockControls();

    it('resolves presses and releases through the bindings', () => {
        const keys = new KeyActions();
        expect(keys.resolve(controls, key('keydown', 'KeyC'))).toEqual(['formation']);
        expect(keys.resolve(controls, key('keyup', 'KeyC'))).toEqual(['formation']);
        expect(keys.resolve(controls, key('keydown', 'KeyC', { alt: true })))
            .toEqual(['returnToBay']);
        expect(keys.resolve(controls, key('keyup', 'KeyC', { alt: true })))
            .toEqual(['returnToBay']);
    });

    it('Alt let go before C still releases returnToBay', () => {
        const keys = new KeyActions();
        expect(keys.resolve(controls, key('keydown', 'KeyC', { alt: true })))
            .toEqual(['returnToBay']);
        // The key-up resolves to plain C now; the press's action is
        // released with it.
        expect(keys.resolve(controls, key('keyup', 'KeyC')))
            .toEqual(['formation', 'returnToBay']);
        // ...once: the next plain C is plain again.
        keys.resolve(controls, key('keydown', 'KeyC'));
        expect(keys.resolve(controls, key('keyup', 'KeyC'))).toEqual(['formation']);
    });

    it('Alt pressed mid-hold: the release covers both resolutions', () => {
        const keys = new KeyActions();
        keys.resolve(controls, key('keydown', 'KeyC'));
        keys.resolve(controls, key('keydown', 'KeyC', { alt: true, repeat: true }));
        expect(keys.resolve(controls, key('keyup', 'KeyC', { alt: true })))
            .toEqual(['returnToBay', 'formation']);
    });

    it('an unbound key resolves to nothing', () => {
        const keys = new KeyActions();
        expect(keys.resolve(controls, key('keydown', 'F24'))).toEqual([]);
        expect(keys.resolve(controls, key('keyup', 'F24'))).toEqual([]);
    });
});
