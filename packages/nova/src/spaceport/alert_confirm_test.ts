import 'jasmine';
import { Subject } from 'rxjs';
import { ControlEvent } from '../nova_plugin/core/index.js';
import { hasJettisonableCargo, jettisonedMissionIds } from '../nova_plugin/ship/index.js';
import { ActiveMission, Missions } from '../nova_plugin/player/index.js';
import { AlertConfirmDialog, JETTISON_CONFIRM_LAYOUT } from './alert_confirm.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { MenuControls } from './menu_controls.js';
import {
    CARGO_JETTISONED, CARGO_JETTISONED_INDEX, JETTISON_CONFIRM,
    JETTISON_CONFIRM_INDEX,
} from './player_info.js';

describe('the Jettison Cargo confirmation', () => {
    beforeAll(() => installHeadlessPixi());

    it('asks in the original\'s words (STR# 2002, 0-based 290 / 288)', () => {
        expect(JETTISON_CONFIRM)
            .toBe('Are you sure you want to jettison your cargo?');
        expect(JETTISON_CONFIRM_INDEX).toBe(290);
        expect(CARGO_JETTISONED).toBe('Cargo jettisoned.');
        expect(CARGO_JETTISONED_INDEX).toBe(288);
    });

    it('is measured off the reference (a 356 x 110 panel, Cancel left of '
        + 'the default OK)', () => {
            expect(JETTISON_CONFIRM_LAYOUT.width).toBe(356);
            expect(JETTISON_CONFIRM_LAYOUT.height).toBe(110);
            expect(JETTISON_CONFIRM_LAYOUT.cancelX)
                .toBeLessThan(JETTISON_CONFIRM_LAYOUT.confirmX);
        });

    it('owns the keyboard while up and answers OK / Cancel', async () => {
        const alert = new AlertConfirmDialog(new Subject<ControlEvent>(),
            'JettisonConfirm');
        const ok = alert.show(JETTISON_CONFIRM);
        expect(alert.shown).toBeTrue();
        expect(MenuControls.focused).toBeDefined();
        alert.confirm();
        expect(await ok).toBeTrue();
        expect(alert.shown).toBeFalse();
        const cancelled = alert.show(JETTISON_CONFIRM);
        alert.cancel();
        expect(await cancelled).toBeFalse();
    });
});

describe('what a jettison takes', () => {
    const mission = (partial: Partial<ActiveMission>): ActiveMission => ({
        id: 'nova:200', acceptedDay: 1, acceptedAt: 'nova:128',
        travelPlanet: null, returnPlanet: 'nova:128', cargoType: -1,
        cargoQty: 0, cargoLoaded: false, travelDone: false, deadlineDay: null,
        ...partial,
    });

    it('is anything in the hold, or a mission\'s cargo aboard', () => {
        expect(hasJettisonableCargo(new Map(), new Map())).toBeFalse();
        expect(hasJettisonableCargo(new Map([['cargo:0', 0]]), undefined))
            .toBeFalse();
        expect(hasJettisonableCargo(new Map([['junk:nova:130', 1]]),
            undefined)).toBeTrue();
        const missions: Missions = new Map([
            ['nova:201', mission({ cargoType: 2, cargoQty: 3,
                cargoLoaded: true })],
        ]);
        expect(hasJettisonableCargo(new Map(), missions)).toBeTrue();
    });

    it('fails only missions whose cargo is aboard and not failed already',
        () => {
            const missions: Missions = new Map([
                ['nova:204', mission({ cargoType: 2, cargoQty: 3,
                    cargoLoaded: true })],
                ['nova:201', mission({ cargoType: 1, cargoQty: 2,
                    cargoLoaded: true })],
                // No cargo; cargo still to be picked up; already failed.
                ['nova:202', mission({})],
                ['nova:203', mission({ cargoType: 4, cargoQty: 1 })],
                ['nova:205', mission({ cargoType: 4, cargoQty: 1,
                    cargoLoaded: true, failed: true, failCause: 'scan' })],
            ]);
            expect(jettisonedMissionIds(missions))
                .toEqual(['nova:201', 'nova:204']);
        });
});
