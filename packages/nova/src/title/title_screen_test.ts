import 'jasmine';
import { hotkeyActionFor, shipClassLines, statusLayers } from './title_screen.js';

describe('title screen hotkeys', () => {
    it('maps each command letter to its action', () => {
        expect(hotkeyActionFor({ key: 'n' })).toBe('newPilot');
        expect(hotkeyActionFor({ key: 'o' })).toBe('openPilot');
        expect(hotkeyActionFor({ key: 'q' })).toBe('quit');
        expect(hotkeyActionFor({ key: 'e' })).toBe('enterShip');
        expect(hotkeyActionFor({ key: 'p' })).toBe('setPrefs');
        expect(hotkeyActionFor({ key: 'a' })).toBe('about');
    });

    it('is case-insensitive (a capitalized letter still maps)', () => {
        expect(hotkeyActionFor({ key: 'N' })).toBe('newPilot');
        expect(hotkeyActionFor({ key: 'A' })).toBe('about');
    });

    it('ignores non-hotkey keys', () => {
        expect(hotkeyActionFor({ key: 'x' })).toBeUndefined();
        expect(hotkeyActionFor({ key: 'Enter' })).toBeUndefined();
        expect(hotkeyActionFor({ key: 'ArrowUp' })).toBeUndefined();
        expect(hotkeyActionFor({ key: ' ' })).toBeUndefined();
    });

    it('ignores hotkeys while a modifier is held (Cmd/Ctrl/Alt)', () => {
        // e.g. Cmd+Q must remain the browser's quit, not "quit Nova".
        expect(hotkeyActionFor({ key: 'q', metaKey: true })).toBeUndefined();
        expect(hotkeyActionFor({ key: 'n', ctrlKey: true })).toBeUndefined();
        expect(hotkeyActionFor({ key: 'a', altKey: true })).toBeUndefined();
    });
});

describe('title screen ship class lines', () => {
    it('puts the shïp subtitle on a second line, as the original does',
        () => {
            // shïp 129: title_screen.png reads "Heavy Shuttle / Version A".
            expect(shipClassLines('Heavy Shuttle', 'Version A'))
                .toEqual(['Heavy Shuttle', 'Version A']);
        });

    it('drops a name\'s ;comment suffix', () => {
        expect(shipClassLines('Heavy Shuttle;Second-Hand - poor',
            'Version A')).toEqual(['Heavy Shuttle', 'Version A']);
    });

    it('has no second line without a distinct subtitle', () => {
        expect(shipClassLines('Raven', '')).toEqual(['Raven', '']);
        expect(shipClassLines('Raven')).toEqual(['Raven', '']);
        expect(shipClassLines('Raven;Cloaking', 'Raven'))
            .toEqual(['Raven', '']);
    });
});

describe('title screen pilot block layers', () => {
    it('puts labels and indented values on one shared line grid', () => {
        const [labels, values] = statusLayers([
            ['Ship Class:'], ['', 'Heavy Shuttle'], ['', 'Version A'], [''],
            ['Current Date:'], ['', 'Nov. 27th, 1177 NC'],
        ]);
        expect(labels.split('\n'))
            .toEqual(['Ship Class:', '', '', '', 'Current Date:', '']);
        expect(values.split('\n')).toEqual(['', '  Heavy Shuttle',
            '  Version A', '', '', '  Nov. 27th, 1177 NC']);
    });
});
