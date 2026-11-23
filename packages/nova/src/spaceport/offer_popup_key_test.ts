import 'jasmine';
import { popupDepartChoice } from './offer_popup.js';

/**
 * Matthew, 2026-08-18: "'d' / esc should close the 'there are no ships
 * available for hire' dialog."
 *
 * That notice is an OfferPopup with a single OK button (bar.ts's empty
 * hire pool path), and 'depart' is the landed UI's Escape / 'd' action
 * (settings/controls.json binds both keys to it), which every other
 * spaceport surface already treats as "close this".
 */
describe('popupDepartChoice', () => {
    it('closes a one-button notice, as its OK button would', () => {
        expect(popupDepartChoice(false)).toBe('accept');
    });

    it('leaves a two-button offer alone', () => {
        // Accept-or-refuse is a real decision; Escape must not pick one.
        // The original agrees (catalogue K2, R8 wave 5 in
        // docs/reference_experiments.md): Escape pressed on Earth's bar
        // offer (No / Yes) left it up, unchanged 2s later.
        expect(popupDepartChoice(true)).toBeUndefined();
    });
});
