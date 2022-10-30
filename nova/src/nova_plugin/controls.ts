import { isLeft, right } from 'fp-ts/Either';
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
    'nearestTarget': ControlInputs,
    'nextSecondary': ControlInputs,
    'previousSecondary': ControlInputs,
    'afterburner': ControlInputs,
    'hail': ControlInputs,
    'board': ControlInputs,
    'escorts': ControlInputs,
    'holdPosition': ControlInputs,
    'attack': ControlInputs,
    'defend': ControlInputs,
    'formation': ControlInputs,
    'map': ControlInputs,
    'smallMap': ControlInputs,
    'hyperjump': ControlInputs,
    'resetNav': ControlInputs,
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
    'properties': ControlInputs,
    'missions': ControlInputs,
    'fullscreen': ControlInputs,
});

const ControlAction = t.keyof(SavedControlsPartialObject.props);

const SavedControlsObject = t.exact(SavedControlsPartialObject);
type SavedControlsObject = t.TypeOf<typeof SavedControlsObject>;

export type ControlAction = t.TypeOf<typeof ControlAction>;

export type SavedControls = Map<ControlAction, Required<ControlInputRecord>[]>;
export const SavedControls = new t.Type(
    'SavedControls',
    (u): u is SavedControls => u instanceof Map
        && [...u.entries()]
            .map(([k, v]) => ControlAction.is(k) && ControlInputRecord.is(v))
            .reduce((a, b) => a && b),
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
        && [...u.entries()]
            .map(([k, v]) => t.string.is(k) && ControlEntry.is(v))
            .reduce((a, b) => a && b),
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

    const actions: ControlAction[] = [];
    for (const { action, modifiers } of possibleActions) {
        if (modifiersPressed(event, modifiers)) {
            actions.push(action);
        }
    }
    return actions;
}
