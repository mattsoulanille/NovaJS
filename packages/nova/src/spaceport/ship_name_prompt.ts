import { Observable } from 'rxjs';
import { ControlEvent, displayName } from '../nova_plugin/core/index.js';
import {
    derivedShipName, MAX_PLAYER_NAME_LENGTH, sanitizePlayerName,
} from '../nova_plugin/player/index.js';
import { AlertPromptDialog, AlertPromptLayout } from './alert_prompt.js';

/**
 * The shipyard's Buy Ship prompt: "Please name your new <ship>:", a field
 * prefilled with "<ship> <number>" and all of it selected, Cancel and OK
 * (reference 20261123-w11 mass_trade 09-buy-confirm.png, the original at
 * 1x in an 832x604 window). The original asks it after the price is
 * accepted, as a plain Mac alert over the shipyard.
 *
 * Measured off that capture: the panel is x236..595, y233..370 (360 x
 * 138), centred on the window; the icon at (7, 5) as in the Find dialog;
 * the prompt's ink 53 px in; the field x324..529, y294..315 (206 x 22, the
 * Find field's size); Cancel x406..475 and OK x488..557, both y339..359
 * (70 x 21, 12 px apart, OK 38 px from the right edge).
 */
export const SHIP_NAME_PROMPT_LAYOUT: AlertPromptLayout = {
    width: 360,
    height: 138,
    textX: 53,
    textY: 6,
    fieldX: 88,
    fieldY: 61,
    fieldWidth: 206,
    fieldHeight: 22,
    cancelX: 170,
    confirmX: 252,
    buttonY: 106,
    buttonWidth: 70,
    buttonHeight: 21,
};

/** The prompt's line for a hull type ("Please name your new Shuttle:"). */
export function shipNamePromptText(shipType: string): string {
    return `Please name your new ${shipType}:`;
}

/**
 * The name a confirmed prompt gives the ship: what was typed, cleaned
 * (player_names.ts sanitizePlayerName), or the prefill when nothing usable
 * is left. GUESS: the original's handling of an empty name has not been
 * measured; falling back to the prefill keeps every ship named.
 */
export function confirmedShipName(entered: string, prefill: string): string {
    return sanitizePlayerName(entered) ?? prefill;
}

/**
 * The prompt itself. `ask` resolves with the name to give the new ship,
 * or undefined when the player cancelled — which aborts the whole
 * purchase (GUESS until the reference measures it: credits and ship stay
 * as they were).
 */
export class ShipNamePrompt {
    private dialog: AlertPromptDialog;

    constructor(controlEvents: Observable<ControlEvent>) {
        this.dialog = new AlertPromptDialog(controlEvents, 'ShipNamePrompt',
            SHIP_NAME_PROMPT_LAYOUT, MAX_PLAYER_NAME_LENGTH);
    }

    get container() {
        return this.dialog.container;
    }

    /** The underlying alert, for headless driving (confirm / cancel). */
    get alert(): AlertPromptDialog {
        return this.dialog;
    }

    /**
     * Asks for the name of a new `rawShipName` (the shïp's name, "; note"
     * and all), prefilled with its derived name for `shipNumber`.
     */
    async ask(rawShipName: string, shipNumber?: number):
        Promise<string | undefined> {
        const shipType = displayName(rawShipName);
        const prefill = derivedShipName(shipType, shipNumber);
        const entered = await this.dialog.show({
            prompt: shipNamePromptText(shipType),
            confirm: 'OK',
            initial: prefill,
            selectAll: true,
        });
        return entered === undefined
            ? undefined : confirmedShipName(entered, prefill);
    }
}
