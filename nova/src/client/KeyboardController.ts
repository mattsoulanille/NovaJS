import * as t from "io-ts";
import { Controller, ControlEvent, ControlState, makeControlState, ControlEventInfo } from "../common/Controller";
import { $enum } from "ts-enum-util";


const controlEventKeys: { [key in ControlEvent]?: null } = {};
for (let val of $enum(ControlEvent).values()) {
    controlEventKeys[val] = null;
}

const ControlEventT = t.keyof(controlEventKeys);
const Keybindings = t.record(t.string, t.array(ControlEventT));
type Keybindings = t.TypeOf<typeof Keybindings>;




class KeyboardController implements Controller {
    private readonly controlState: ControlState;

    constructor(private readonly keybindings: Keybindings) {
        this.controlState = makeControlState();

        document.addEventListener("keydown", this.keyDownHandler.bind(this));
        document.addEventListener("keyup", this.keyUpHandler.bind(this));
    }



    poll(): ControlState {
        let toReturn = JSON.parse(JSON.stringify(this.controlState)) as ControlState; // Nasty hacky deep copy
        for (let state of Object.values(this.controlState)) {
            // Reset the key repeats
            // so they only happen as often as the keys
            // acutally repeat instead of as often
            // as it is polled.
            state.keyRepeat = false;

            // Make sure all keyDown events get seen
            // by only resetting them once they are checked
            state.keyDown = false;
        }
        return toReturn;
    }

    private forEachControlEvent(
        e: KeyboardEvent,
        f: (c: ControlEventInfo) => unknown) {

        let controlEvents = this.keybindings[e.keyCode];
        if (controlEvents !== undefined) {
            for (let controlEvent of controlEvents) {
                f(this.controlState[controlEvent]);
            }
        }
    }

    private keyDownHandler(e: KeyboardEvent) {
        this.forEachControlEvent(e, (c: ControlEventInfo) => {
            if (c.keyPressed) {
                c.keyRepeat = true;
            }
            else {
                c.keyDown = true;
            }

            c.keyPressed = true;
        });
    }

    private keyUpHandler(e: KeyboardEvent) {
        this.forEachControlEvent(e, (c: ControlEventInfo) => {
            c.keyPressed = false;
        });
    }


}

export { KeyboardController, Keybindings }
