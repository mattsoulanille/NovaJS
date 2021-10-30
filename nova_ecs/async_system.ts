import { applyPatches, createDraft, enableMapSet, enablePatches, finishDraft, isDraft, isDraftable, Patch, setAutoFreeze } from "immer";
import { ArgModifier } from "./arg_modifier";
import { ArgsToData, ArgTypes, UUID } from "./arg_types";
import { DeleteEvent, StepEvent } from "./events";
import { Optional } from "./optional";
import { Plugin } from "./plugin";
import { Resource } from "./resource";
import { BaseSystemArgs, System } from "./system";
import { DefaultMap } from "./utils";


class AsyncSystemData {
    systems: DefaultMap<string /* system name */,
        DefaultMap<string /* entity uuid */, {
            patches: Patch[][],
            promise: Promise<void>,
            running?: boolean, // Only meaningful on exclusive systems
        }>> = new DefaultMap(
            () => new DefaultMap(() => {
                return {
                    patches: [],
                    promise: Promise.resolve(),
                }
            })
        );
    done: Promise<void> = Promise.resolve();
}

export const AsyncSystemResource = new Resource<AsyncSystemData>('AsyncSystemResource');

export interface AsyncSystemArgs<StepArgTypes extends readonly ArgTypes[]>
    extends BaseSystemArgs<StepArgTypes> {
    step: (...args: ArgsToData<StepArgTypes>) =>
        Promise<void | boolean>;
    exclusive?: boolean; // Run this system only once at a time (per entity)
    skipIfApplyingPatches?: boolean; // Don't run the system if there are patches to apply from previous runs. Just apply the patches.
    alwaysRunOnEvents?: boolean; // Always run the system on events other than the step event.
}

enablePatches();
enableMapSet();
setAutoFreeze(false);

const OptionalStepEvent = Optional(StepEvent);

export class AsyncSystem<StepArgTypes extends readonly ArgTypes[] = readonly ArgTypes[]>
    extends System<[typeof AsyncSystemResource, typeof UUID, typeof OptionalStepEvent, ...StepArgTypes]> {
    constructor(systemArgs: AsyncSystemArgs<StepArgTypes>) {
        const alwaysRunOnEvents = systemArgs.alwaysRunOnEvents ?? true;
        super({
            ...systemArgs,
            args: [AsyncSystemResource, UUID, OptionalStepEvent, ...systemArgs.args],
            step: (asyncSystemData, UUID, step, ...stepArgs) => {
                const system = asyncSystemData.systems.get(this.name);
                const entityStatus = system?.get(UUID);
                if (!entityStatus) {
                    throw new Error("Expected default map to provide entity status");
                }

                const canSkip = step || !alwaysRunOnEvents;
                if (systemArgs.exclusive && entityStatus.running && canSkip) {
                    return;
                }
                entityStatus.running = true;

                // Apply patches from the previous complete run.
                // Note that this only runs if the entity still exists.

                // This is a hack to force immer to treat stepArgs
                // as if it were a draft. It greatly simplifies the rest
                // of the code, but may break in the future.
                (stepArgs as any)[Symbol.for('immer-state')] = true;
                const willSkip = systemArgs.skipIfApplyingPatches &&
                    entityStatus.patches.length > 0 && canSkip;
                for (const patches of entityStatus.patches) {
                    applyPatches(stepArgs, patches);
                }
                delete (stepArgs as any)[Symbol.for('immer-state')];
                entityStatus.patches = [];
                if (willSkip) {
                    return;
                }

                // Although, it looks simpler, can't do the following:
                // 'const draftArgs = createDraft(stepArgs);'
                // Must individually draft arguments so that if the argument
                // is already a draft, immer knows to use the original
                // (instead of the draft proxy) as the new draft's base.
                // Otherwise, when the original argument (which is a draft) is
                // finished, looking at the async system's draft of it will
                // look at the original arg's proxy, which is revoked.
                const draftArgs = stepArgs.map(arg => {
                    if (isDraftable(arg)) {
                        return createDraft(arg as Object);
                    }
                    return arg;
                }) as typeof stepArgs;

                // TODO: This error handling is wrong.
                entityStatus.promise = systemArgs.step(...draftArgs)
                    .then(apply => {
                        if (apply != null && !apply) {
                            // Do not apply patches
                            return;
                        }

                        const patches: Patch[] = [];
                        for (let i = 0; i < draftArgs.length; i++) {
                            const arg = draftArgs[i];
                            if (!isDraft(arg)) {
                                continue;
                            }

                            let argPatches: Patch[] | undefined;
                            finishDraft(arg, (forwardPatches) => {
                                argPatches = forwardPatches;
                            });

                            if (!argPatches) {
                                throw new Error('Got no patches when calling async system');
                            }
                            for (let patch of argPatches) {
                                // Edit the patch path to include the index
                                // of the argument.
                                patch.path.unshift(i);
                            }
                            patches.push(...argPatches);
                        }

                        if (patches.length > 0) {
                            entityStatus.patches.push(patches);
                        }
                        entityStatus.running = false;
                    });

                asyncSystemData.done = (async () => {
                    await asyncSystemData.done;
                    await entityStatus.promise;
                })();
            }
        });
    }
}

const AsyncSystemCleanup = new System({
    name: 'AsyncSystemCleanup',
    events: [DeleteEvent],
    args: [UUID, AsyncSystemResource] as const,
    step(deleted, asyncSystemData) {
        for (const entities of asyncSystemData.systems.values()) {
            entities.delete(deleted);
        }
    }
});

export const AsyncSystemPlugin: Plugin = {
    name: 'AsyncSystem',
    build: (world) => {
        world.resources.set(AsyncSystemResource, new AsyncSystemData());
        world.addSystem(AsyncSystemCleanup);
    }
};
