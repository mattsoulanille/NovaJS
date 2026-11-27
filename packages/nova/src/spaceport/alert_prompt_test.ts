import 'jasmine';
import { Subject } from 'rxjs';
import { ControlEvent } from '../nova_plugin/core/index.js';
import { isTextEntryActive } from '../input_focus.js';
import {
    AlertPromptDialog, editPromptField, insertIntoField, PromptField,
    promptAnswer,
} from './alert_prompt.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { MenuControls } from './menu_controls.js';
import {
    CAPTURED_SHIP_NAME_PROMPT_INDEX, CAPTURED_SHIP_NAME_PROMPT_TEXT,
    CapturedShipNamePrompt, confirmedShipName, prefillShipNumber,
    SHIP_NAME_FIELD_LENGTH, SHIP_NAME_PROMPT_LAYOUT, ShipNamePrompt,
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

    it('accepts an empty name as a blank one, and keeps 31 of the 64 '
        + 'characters the field takes (wave 16, findings 3 and 5)', () => {
        expect(confirmedShipName('')).toBe('');
        expect(confirmedShipName('  \t')).toBe('');
        expect(confirmedShipName(' Rocinante ')).toBe('Rocinante');
        const typed = 'A123456789B123456789C123456789D123456789'
            + 'E123456789F123456789G123';
        expect(typed.length).toBe(SHIP_NAME_FIELD_LENGTH);
        expect(confirmedShipName(typed))
            .toBe('A123456789B123456789C123456789D');
    });

    it('prefills a fresh random 100-999 at every prompt (wave 16, '
        + 'finding 2)', () => {
        expect(prefillShipNumber(() => 0)).toBe(100);
        expect(prefillShipNumber(() => 0.999999)).toBe(999);
        expect(prefillShipNumber(() => 889.5 / 900)).toBe(989);
    });

    it('opens prefilled and selected, owns the keyboard while up, and '
        + 'resolves with the name on OK', async () => {
        const prompt = new ShipNamePrompt(new Subject<ControlEvent>());
        const answer = prompt.ask('Kit Mass Roomy 300; test kit',
            () => 889.5 / 900);
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
        const answer = prompt.ask('Shuttle');
        prompt.alert.cancel();
        expect(await answer).toBeUndefined();
        expect(isTextEntryActive()).toBeFalse();
    });

    it('keeps the prefill on an untouched OK', async () => {
        const prompt = new ShipNamePrompt(new Subject<ControlEvent>());
        const answer = prompt.ask('Shuttle', () => 0.5);
        prompt.alert.confirm();
        expect(await answer).toBe('Shuttle 550');
    });

    it('takes 72 characters while typing but refuses 65 or more at OK, '
        + 'the text reselected, and accepts 64 (wave 17, finding 5)',
        async () => {
            const prompt = new ShipNamePrompt(new Subject<ControlEvent>());
            const answer = prompt.ask('Shuttle');
            let settled = false;
            void answer.then(() => { settled = true; });
            for (const n of [72, 68, 66, 65]) {
                prompt.alert.type('x'.repeat(n));
                expect(prompt.alert.value).toEqual(field('x'.repeat(n)));
                prompt.alert.confirm();
                await Promise.resolve();
                expect(settled).withContext(`${n} characters`).toBeFalse();
                expect(prompt.alert.shown).toBeTrue();
                expect(prompt.alert.value)
                    .toEqual(field('x'.repeat(n), true));
            }
            prompt.alert.type('x'.repeat(SHIP_NAME_FIELD_LENGTH));
            prompt.alert.confirm();
            expect(await answer).toBe('x'.repeat(31));
            expect(prompt.alert.shown).toBeFalse();
        });

    it('refuses an over-long answer only where a limit is given', () => {
        expect(promptAnswer(field('x'.repeat(65)), 64))
            .toEqual({ refused: field('x'.repeat(65), true) });
        expect(promptAnswer(field('x'.repeat(64)), 64))
            .toEqual({ accepted: 'x'.repeat(64) });
        expect(promptAnswer(field('x'.repeat(65))))
            .toEqual({ accepted: 'x'.repeat(65) });
        // Counted in characters, as the field counts them.
        expect(promptAnswer(field('\u00e9'.repeat(64)), 64))
            .toEqual({ accepted: '\u00e9'.repeat(64) });
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

/**
 * The capture's "Use As My Ship" rename (reference "Capture \"Use As My
 * Ship\" (the hub's CU), wave 45", 63-use1.png): "Now rename this captured
 * ship:", prefilled "Kit Prize Hull 631" and selected, Cancel and OK, the
 * shipyard's alert at the shipyard's size.
 */
describe('the captured ship rename prompt', () => {
    beforeAll(() => installHeadlessPixi());

    it('asks in the original\'s words (STR# 2002 0-based 118)', () => {
        expect(CAPTURED_SHIP_NAME_PROMPT_TEXT)
            .toBe('Now rename this captured ship:');
        expect(CAPTURED_SHIP_NAME_PROMPT_INDEX).toBe(118);
    });

    it('opens prefilled "<class name> <number>" and selected, owns the '
        + 'keyboard, and names the ship what was typed on OK', async () => {
        const prompt = new CapturedShipNamePrompt(new Subject<ControlEvent>());
        expect(prompt.container.name).toBe('CapturedShipNamePrompt');
        const answer = prompt.ask('Kit Prize Hull; CU prize', undefined,
            () => 531.5 / 900);
        expect(prompt.alert.shown).toBeTrue();
        expect(prompt.alert.value).toEqual(field('Kit Prize Hull 631', true));
        expect(isTextEntryActive()).toBeTrue();
        prompt.alert.type('Prize Taken');
        prompt.alert.confirm();
        expect(await answer).toBe('Prize Taken');
        expect(prompt.alert.shown).toBeFalse();
        expect(isTextEntryActive()).toBeFalse();
        expect(MenuControls.focused).toBeUndefined();
    });

    it('answers no name on Cancel: the capture is abandoned (reference CU '
        + 'wave 46, finding 2)', async () => {
        const prompt = new CapturedShipNamePrompt(new Subject<ControlEvent>());
        const answer = prompt.ask('Kit Prize Hull', 'Custom wording:',
            () => 0.5);
        expect(prompt.alert.value).toEqual(field('Kit Prize Hull 550', true));
        prompt.alert.type('Never kept');
        prompt.alert.cancel();
        expect(await answer).toBeUndefined();
        expect(prompt.alert.shown).toBeFalse();
        expect(MenuControls.focused).toBeUndefined();
    });

    it('cleans and cuts a name as the shipyard\'s prompt does', async () => {
        const prompt = new CapturedShipNamePrompt(new Subject<ControlEvent>());
        const answer = prompt.ask('Kit Prize Hull');
        prompt.alert.type('  ' + 'y'.repeat(40));
        prompt.alert.confirm();
        expect(await answer).toBe('y'.repeat(31));
    });
});
