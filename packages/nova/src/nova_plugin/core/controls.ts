import { isLeft, right } from 'fp-ts/lib/Either.js';
import * as t from 'io-ts';
import { DefaultMap } from 'nova_ecs/utils';


const ControlInputRecord = t.intersection([
    t.type({
        key: t.string,
    }),
    t.partial({
        modifiers: t.array(t.string),
    }),
]);
type ControlInputRecord = t.TypeOf<typeof ControlInputRecord>;

const ControlInput = t.union([t.string, ControlInputRecord]);
type ControlInput = t.TypeOf<typeof ControlInput>;

const ControlInputs = t.union([ControlInput, t.array(ControlInput)]);
type ControlInputs = t.TypeOf<typeof ControlInputs>;

const SavedControlsPartialObject = t.partial({
    'accelerate': ControlInputs,
    'turnRight': ControlInputs,
    'turnLeft': ControlInputs,
    'reverse': ControlInputs,
    'pointTo': ControlInputs,
    'firePrimary': ControlInputs,
    'fireSecondary': ControlInputs,
    'resetSecondary': ControlInputs,
    'nextTarget': ControlInputs,
    'friendlyTarget': ControlInputs,
    'escortTarget': ControlInputs,
    'nearestTarget': ControlInputs,
    'nextSecondary': ControlInputs,
    'previousSecondary': ControlInputs,
    'afterburner': ControlInputs,
    'cloak': ControlInputs,
    'selfDestruct': ControlInputs,
    'hail': ControlInputs,
    'board': ControlInputs,
    // Plunder-dialog actions (boarding_plugin.ts). These have no default
    // keybind in controls.json: the plunder/capture dialogs drive them
    // programmatically through the control-event input path (button
    // clicks and the dialog's own MenuControls), so every peer replays
    // the same take/capture at the same tick. Listed here so they are
    // valid ControlAction values for those synthetic ControlEvents.
    'plunderCargo': ControlInputs,
    'plunderCredits': ControlInputs,
    'plunderFuel': ControlInputs,
    'plunderAmmo': ControlInputs,
    'plunderCapture': ControlInputs,
    'plunderCaptureEscort': ControlInputs,
    'plunderDone': ControlInputs,
    // "This boarding produced a MISSION OFFER and nothing else" — sent by
    // the display when a përs Flags 0x0200 offer took the plunder
    // dialog's place, so the sim ends the session AND gives the hulk its
    // one plunder back (see BoardingActionSystem).
    'plunderOfferOnly': ControlInputs,
    // Debug cheat actions (status_bar.ts debug buttons). Like the
    // plunder actions, these have NO default keybind in controls.json:
    // the debug buttons drive them programmatically through the
    // control-event input path (DebugCheatSystem), so the cheat rides
    // input records and replays identically on every peer. Listed here
    // only so they are valid ControlAction values.
    'debugGiveCredits': ControlInputs,
    'debugClearRecord': ControlInputs,
    'escorts': ControlInputs,
    'holdPosition': ControlInputs,
    'attack': ControlInputs,
    'defend': ControlInputs,
    'formation': ControlInputs,
    'returnToBay': ControlInputs,
    'escortRestrictFire': ControlInputs,
    'map': ControlInputs,
    'smallMap': ControlInputs,
    'hyperjump': ControlInputs,
    'resetNav': ControlInputs,
    // Number keys 1..9 select the Nth stellar body in the current system
    // (controls_nits.txt); resetNav (tilde/backquote) clears the selection.
    'selectStellar1': ControlInputs,
    'selectStellar2': ControlInputs,
    'selectStellar3': ControlInputs,
    'selectStellar4': ControlInputs,
    'selectStellar5': ControlInputs,
    'selectStellar6': ControlInputs,
    'selectStellar7': ControlInputs,
    'selectStellar8': ControlInputs,
    'selectStellar9': ControlInputs,
    'land': ControlInputs,
    'tradeCenter': ControlInputs,
    'shipyard': ControlInputs,
    'outfitter': ControlInputs,
    'missionBBS': ControlInputs,
    'bar': ControlInputs,
    'up': ControlInputs,
    'down': ControlInputs,
    'left': ControlInputs,
    'right': ControlInputs,
    'sell': ControlInputs,
    'buy': ControlInputs,
    'depart': ControlInputs,
    // Landed-UI actions: refuel at the spaceport, the bar's venues,
    // hiring the selected escort, and accepting the selected mission.
    'recharge': ControlInputs,
    'hire': ControlInputs,
    'news': ControlInputs,
    'gamble': ControlInputs,
    'accept': ControlInputs,
    'properties': ControlInputs,
    'missions': ControlInputs,
    'fullscreen': ControlInputs,
    // Display scaling (display/display_scale.ts). Like 'fullscreen',
    // these are CLIENT-LOCAL presentation actions: the simulation has no
    // handler for them, and two peers at different scales stay in
    // lockstep. They live here so they can be bound and rebound through
    // the same controls.json / Set Prefs pipeline as everything else.
    'uiScaleUp': ControlInputs,
    'uiScaleDown': ControlInputs,
    'globalScaleUp': ControlInputs,
    'globalScaleDown': ControlInputs,
    'resetScale': ControlInputs,
});

export const ControlAction = t.keyof(SavedControlsPartialObject.props);

const SavedControlsObject = t.exact(SavedControlsPartialObject);
type SavedControlsObject = t.TypeOf<typeof SavedControlsObject>;

export type ControlAction = t.TypeOf<typeof ControlAction>;

export type SavedControls = Map<ControlAction, Required<ControlInputRecord>[]>;
export const SavedControls = new t.Type(
    'SavedControls',
    // `every`, not a seedless `reduce`: that throws on an empty Map
    // (#84's class). The value is the record LIST, not one record.
    (u): u is SavedControls => u instanceof Map
        && [...u.entries()].every(([k, v]) =>
            ControlAction.is(k) && t.array(ControlInputRecord).is(v)),
    (i, context) => {
        const savedControlsObject = SavedControlsObject.validate(i, context);
        if (isLeft(savedControlsObject)) {
            return savedControlsObject;
        }
        return right(new Map(Object.entries(savedControlsObject.right)
            .filter((entry): entry is [ControlAction, ControlInputs] =>
                typeof entry[1] !== 'undefined')
            .map(([controlAction, controlInputs]): [ControlAction,
                Required<ControlInputRecord>[]] => {

                const asArray = controlInputs instanceof Array
                    ? controlInputs
                    : [controlInputs];

                return [controlAction, asArray.map(controlInput => {
                    if (typeof controlInput === 'string') {
                        return {
                            key: controlInput,
                            modifiers: [],
                        };
                    } else {
                        return {
                            key: controlInput.key,
                            modifiers: controlInput.modifiers ?? [],
                        };
                    }
                })];
            }))
        );
    },
    (a) => SavedControlsObject.encode(
        Object.fromEntries([...a].map(([action, inputs]) => {
            if (inputs.length === 1) {
                return [action, compressInput(inputs[0])];
            } else {
                return [action, inputs.map(compressInput)];
            }
        }))
    )
);

function compressInput(input: Required<ControlInputRecord>) {
    if (input.modifiers.length === 0) {
        return input.key;
    }
    const result: ControlInputRecord = { ...input };
    if (!result?.modifiers?.length) {
        delete result.modifiers;
    }
    return result;
}

const ControlEntry = t.type({
    action: ControlAction,
    modifiers: t.array(t.string),
});
type ControlEntry = t.TypeOf<typeof ControlEntry>;

export type Controls = Map<string, ControlEntry[]>;

export const Controls = new t.Type(
    'Controls',
    (u): u is Controls => u instanceof Map
        && [...u.entries()].every(([k, v]) =>
            t.string.is(k) && t.array(ControlEntry).is(v)),
    (savedControls: SavedControls) => {
        const resultMap = new DefaultMap<string, ControlEntry[]>(() => []);
        for (const [action, controlInputs] of savedControls) {
            for (const controlInput of controlInputs) {
                const { key, modifiers } = controlInput;
                const result = resultMap.get(key);
                result.push({ action, modifiers });
            }
        }

        for (const controlInputs of resultMap.values()) {
            controlInputs.sort((a, b) => b.modifiers.length - a.modifiers.length);
        }

        return right(new Map(resultMap));
    },
    (controls): SavedControls => {
        const resultMap = new DefaultMap<ControlAction,
            Required<ControlInputRecord>[]>(() => []);
        for (const [key, controlEntries] of controls) {
            for (const controlEntry of controlEntries) {
                const { action, modifiers } = controlEntry;
                const result = resultMap.get(action);
                result.push({ key, modifiers });
            }
        }
        return new Map(resultMap);
    }
)

function modifiersPressed(event: KeyboardEvent, modifiers: string[]) {
    for (const modifier of modifiers) {
        if (!event.getModifierState(modifier)) {
            return false;
        }
    }
    return true;
}

export function getActions(controls: Controls,
    event: KeyboardEvent): ControlAction[] {
    const possibleActions = controls.get(event.code);
    if (!possibleActions) {
        return [];
    }

    // Most-specific-binding wins: a binding's modifiers must all be
    // pressed, and among the bindings that match, only those with the
    // most required modifiers fire. Without this, plain Tab
    // (nextTarget, no modifiers — vacuously satisfied) would ALSO fire
    // on Alt+Tab alongside escortTarget.
    const matched = possibleActions.filter(
        ({ modifiers }) => modifiersPressed(event, modifiers));
    const maxModifiers = Math.max(0,
        ...matched.map(({ modifiers }) => modifiers.length));
    return matched
        .filter(({ modifiers }) => modifiers.length === maxModifiers)
        .map(({ action }) => action);
}
