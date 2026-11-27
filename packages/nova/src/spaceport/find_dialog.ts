import { Observable } from 'rxjs';
import { ControlEvent } from '../nova_plugin/core/index.js';
import { AlertPromptDialog, AlertPromptLayout } from './alert_prompt.js';

// The starmap's Find dialog, drawn after the original's native Aqua alert
// (map/find_system.png, measured at 1920x1080): a 284x105 white panel with
// a 1 px grey edge, centred on the screen; the application icon (32x32) at
// its top left; "Enter the name of a system to find:" indented 51 px; a
// 206x22 black-edged field under it, indented 57 px; and a white rounded
// Cancel beside the blue default Find button (70x22 each, 12 px apart),
// 11 px above the bottom edge. The drawing is alert_prompt.ts's, shared
// with the shipyard's ship name prompt.
export const FIND_DIALOG_LAYOUT: AlertPromptLayout = {
    width: 284,
    height: 105,
    textX: 51,
    textY: 6,
    fieldX: 57,
    fieldY: 35,
    fieldWidth: 206,
    fieldHeight: 22,
    // Cancel and the default Find button sit together right of centre,
    // Find rightmost (map/find_system.png).
    cancelX: 83,
    confirmX: 83 + 70 + 12,
    buttonY: 72,
    buttonWidth: 70,
    buttonHeight: 22,
};
const MAX_LENGTH = 40;

/**
 * The Find dialog: resolves with the entered system name, or undefined on
 * cancel or an empty field.
 */
export class FindDialog {
    private dialog: AlertPromptDialog;

    constructor(controlEvents: Observable<ControlEvent>) {
        this.dialog = new AlertPromptDialog(controlEvents, 'FindDialog',
            FIND_DIALOG_LAYOUT, MAX_LENGTH);
    }

    get container() {
        return this.dialog.container;
    }

    /** Whether the dialog is up. */
    get shown(): boolean {
        return this.dialog.shown;
    }

    /** Replaces the field's text (headless driving). */
    type(text: string) {
        this.dialog.type(text);
    }

    /** Presses Find (headless driving). */
    confirm() {
        this.dialog.confirm();
    }

    /** Presses Cancel (headless driving). */
    cancel() {
        this.dialog.cancel();
    }

    /** Shows the dialog; resolves with the entered name or undefined. */
    async show(): Promise<string | undefined> {
        const name = await this.dialog.show({
            prompt: 'Enter the name of a system to find:',
            confirm: 'Find',
        });
        return name?.trim() ? name.trim() : undefined;
    }
}
