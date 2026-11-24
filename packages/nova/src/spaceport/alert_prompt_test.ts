import 'jasmine';
import { Subject } from 'rxjs';
import { ControlEvent } from '../nova_plugin/core/index.js';
import { isTextEntryActive } from '../input_focus.js';
import {
    AlertPromptDialog, editPromptField, insertIntoField, PromptField,
} from './alert_prompt.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { MenuControls } from './menu_controls.js';
import {
    confirmedShipName, SHIP_NAME_PROMPT_LAYOUT, ShipNamePrompt,
    shipNamePromptText,
} from './ship_name_prompt.js';

const field = (text: string, selected = false): PromptField =>
    ({ text, selected });

describe('the alert prompt field', () => {
    it('replaces the opening select-all with the first typed character',
        () => {
            expect(editPromptField(field('Shuttle 552', true), 'R', 31))
                .toEqual(field('R'));
            expect(editPromptField(field('R'), 'o', 31))
                .toEqual(field('Ro'));
        });

    it('deletes the selection, or the last character', () => {
        expect(editPromptField(field('Shuttle 552', true), 'Backspace', 31))
            .toEqual(field(''));
        expect(editPromptField(field('Shuttle 552', true), 'Delete', 31))
            .toEqual(field(''));
        expect(editPromptField(field('Ro'), 'Backspace', 31))
            .toEqual(field('R'));
        const rocket = String.fromCodePoint(0x1f680);
        expect(editPromptField(field(`a${rocket}`), 'Backspace', 31))
            .toEqual(field('a'));
    });

    it('drops the selection on an arrow, Home or End (the caret goes to '
        + 'the end) and keeps typing there', () => {
        const moved = editPromptField(field('Shuttle 552', true),
            'ArrowRight', 31)!;
        expect(moved).toEqual(field('Shuttle 552'));
        expect(editPromptField(moved, 'x', 31)).toEqual(field('Shuttle 552x'));
        expect(editPromptField(field('a', true), 'End', 31))
            .toEqual(field('a'));
    });

    it('stops at the length cap', () => {
        expect(editPromptField(field('abc'), 'd', 3)).toEqual(field('abc'));
        expect(insertIntoField(field('ab'), 'cdef', 4)).toEqual(field('abcd'));
        expect(insertIntoField(field('ab', true), 'cdef', 4))
            .toEqual(field('cdef'));
    });

    it('selects all on Command-A and types nothing for other chords',
        () => {
            expect(editPromptField(field('abc'), 'a', 31, { meta: true }))
                .toEqual(field('abc', true));
            expect(editPromptField(field('abc'), 'A', 31, { ctrl: true }))
                .toEqual(field('abc', true));
            expect(editPromptField(field('abc'), 'd', 31, { meta: true }))
                .toBeUndefined();
        });

    it('ignores named keys (Tab, F1, Shift) and control characters', () => {
        for (const key of ['Tab', 'F1', 'Shift', 'Meta', '\u0007']) {
            expect(editPromptField(field('abc'), key, 31)).toBeUndefined();
        }
    });
});

describe('the ship name prompt', () => {
    beforeAll(() => installHeadlessPixi());

    it('asks in the original\'s words', () => {
        expect(shipNamePromptText('Kit Mass Roomy 300'))
            .toBe('Please name your new Kit Mass Roomy 300:');
    });

    it('is measured off the reference (360 x 138, the Find field size)',
        () => {
            expect(SHIP_NAME_PROMPT_LAYOUT.width).toBe(360);
            expect(SHIP_NAME_PROMPT_LAYOUT.height).toBe(138);
            expect(SHIP_NAME_PROMPT_LAYOUT.fieldWidth).toBe(206);
            // OK 38 px in from the right edge, Cancel 12 px left of it.
            expect(SHIP_NAME_PROMPT_LAYOUT.width
                - SHIP_NAME_PROMPT_LAYOUT.confirmX
                - SHIP_NAME_PROMPT_LAYOUT.buttonWidth).toBe(38);
            expect(SHIP_NAME_PROMPT_LAYOUT.confirmX
                - SHIP_NAME_PROMPT_LAYOUT.cancelX
                - SHIP_NAME_PROMPT_LAYOUT.buttonWidth).toBe(12);
        });

    it('falls back to the prefill for an empty name (GUESS) and cleans '
        + 'what was typed', () => {
        expect(confirmedShipName('', 'Shuttle 552')).toBe('Shuttle 552');
        expect(confirmedShipName('  \t', 'Shuttle 552')).toBe('Shuttle 552');
        expect(confirmedShipName(' Rocinante ', 'Shuttle 552'))
            .toBe('Rocinante');
    });

    it('opens prefilled and selected, owns the keyboard while up, and '
        + 'resolves with the name on OK', async () => {
        const prompt = new ShipNamePrompt(new Subject<ControlEvent>());
        const answer = prompt.ask('Kit Mass Roomy 300; test kit', 989);
        expect(prompt.alert.shown).toBeTrue();
        expect(prompt.alert.value).toEqual(
            field('Kit Mass Roomy 300 989', true));
        // Game hotkeys are dropped and the screen behind hears nothing.
        expect(isTextEntryActive()).toBeTrue();
        expect(MenuControls.focused).toBeDefined();
        prompt.alert.type('Rocinante');
        prompt.alert.confirm();
        expect(await answer).toBe('Rocinante');
        expect(prompt.alert.shown).toBeFalse();
        expect(isTextEntryActive()).toBeFalse();
        expect(MenuControls.focused).toBeUndefined();
    });

    it('resolves undefined on Cancel', async () => {
        const prompt = new ShipNamePrompt(new Subject<ControlEvent>());
        const answer = prompt.ask('Shuttle', 5);
        prompt.alert.cancel();
        expect(await answer).toBeUndefined();
        expect(isTextEntryActive()).toBeFalse();
    });

    it('keeps the prefill on an untouched OK', async () => {
        const prompt = new ShipNamePrompt(new Subject<ControlEvent>());
        const answer = prompt.ask('Shuttle', 5);
        prompt.alert.confirm();
        expect(await answer).toBe('Shuttle 5');
    });

    it('draws as one alert container, named for headless driving', () => {
        const dialog = new AlertPromptDialog(new Subject<ControlEvent>(),
            'Probe', SHIP_NAME_PROMPT_LAYOUT, 31);
        expect(dialog.container.name).toBe('Probe');
        expect(dialog.container.visible).toBeFalse();
        expect(dialog.container.getChildByName('Button:OK', true))
            .toBeTruthy();
        expect(dialog.container.getChildByName('Button:Cancel', true))
            .toBeTruthy();
    });
});
