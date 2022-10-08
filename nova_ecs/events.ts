import * as t from 'io-ts';
import { Entity } from './entity';
import { System } from './system';


const eventSymbol = Symbol('Event');
export class EcsEvent<Data, DataSerialized = Data> {
    // Necessary so Query does not extend EcsEvent, which ruins the arg
    // type system.
    private readonly eventSymbol = eventSymbol;
    readonly name?: string;
    readonly type?: t.Type<Data, DataSerialized>;

    constructor(name?: string) {
        this.name = name;
    }
}

export const StepEvent = new EcsEvent<true>('step');
export const DeleteEvent = new EcsEvent<Set<[string /* uuid */, Entity]>>('delete');
export const AddEvent = new EcsEvent<[string /* uuid */, Entity]>('add');

export const RemoveSystemEvent = new EcsEvent<System>('RemoveSystem');
export const AddSystemEvent = new EcsEvent<System>('AddSystem');

export type EventData<E> = E extends EcsEvent<infer Data, any> ? Data : never;

export type UnknownEvent = EcsEvent<unknown, unknown>;

