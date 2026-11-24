import { Observable } from 'rxjs';
import { ControlEvent, displayName } from '../nova_plugin/core/index.js';
import { sanitizeShipName } from '../nova_plugin/player/index.js';
import { AlertPromptDialog, AlertPromptLayout } from './alert_prompt.js';

/**
 * The shipyard's Buy Ship prompt: "Please name your new <ship>:", a field
 * prefilled with "<ship> <number>" and all of it selected, Cancel and OK
 * (reference 20261123-w11 mass_trade 09-buy-confirm.png, the original at
 * 1x in an 832x604 window). The original asks it after the price is
 * accepted, as a plain Mac alert over the shipyard, for Buy Ship and
 * Option-click Buy Ship alike (wave 16, finding 4).
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
 * How many characters OK accepts. Measured (reference "W1 / C1 /
 * contraband / the shipyard prompt, wave 17", finding 5, bisected in one
 * prompt): 64 accepted; 65, 66, 68 and 72 refused at OK, the dialog
 * staying up with the text reselected; and nothing was cut while typing
 * (all 72 went in). Only the first 31 reach the pilot file, which is what
 * confirmedShipName keeps (wave 16, finding 5).
 */
export const SHIP_NAME_FIELD_LENGTH = 64;

/**
 * How many characters the field takes while typing, past the 64 OK
 * accepts (72 were typed in on the reference). GUESS: 255, a Pascal
 * string's limit; the original's own cap was not reached.
 */
export const SHIP_NAME_TYPING_LENGTH = 255;

/**
 * The prefill's number: "<class name> <random 100-999>", a fresh three
 * digits at every prompt (711, 151, 753, 386 for one hull, 275 for another;
 * wave 16, finding 2), not a counter. Client-side and outside the
 * simulation: only the name the player confirms enters player state.
 */
export function prefillShipNumber(random: () => number = Math.random):
    number {
    return 100 + Math.floor(random() * 900);
}

/**
 * The name a confirmed prompt gives the ship: what was typed, cleaned and
 * cut to 31 characters (player_names.ts sanitizeShipName). An emptied
 * field is accepted and names the ship with nothing: the original's `p`
 * screen then shows a blank Ship Name (wave 16, finding 3).
 */
export function confirmedShipName(entered: string): string {
    return sanitizeShipName(entered) ?? '';
}

/**
 * The prompt itself. `ask` resolves with the name to give the new ship,
 * or undefined when the player cancelled — which aborts the whole
 * purchase: credits, hull and trade-in stay as they were (wave 16,
 * finding 1). OK on more than {@link SHIP_NAME_FIELD_LENGTH} characters
 * is refused and the prompt stays up (wave 17, finding 5).
 *
 * Measured in docs/reference_experiments.md, "The shipyard's \"Please
 * name your new <ship>:\" prompt, wave 16" and "W1 / C1 / contraband /
 * the shipyard prompt, wave 17".
 */
export class ShipNamePrompt {
    private dialog: AlertPromptDialog;

    constructor(controlEvents: Observable<ControlEvent>) {
        this.dialog = new AlertPromptDialog(controlEvents, 'ShipNamePrompt',
            SHIP_NAME_PROMPT_LAYOUT, SHIP_NAME_TYPING_LENGTH,
            SHIP_NAME_FIELD_LENGTH);
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
     * and all), prefilled with "<class name> <random 100-999>".
     */
    async ask(rawShipName: string, random: () => number = Math.random):
        Promise<string | undefined> {
        const shipType = displayName(rawShipName);
        const entered = await this.dialog.show({
            prompt: shipNamePromptText(shipType),
            confirm: 'OK',
            initial: `${shipType} ${prefillShipNumber(random)}`,
            selectAll: true,
        });
        return entered === undefined ? undefined : confirmedShipName(entered);
    }
}
