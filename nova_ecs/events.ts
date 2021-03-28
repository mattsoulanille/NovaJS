import * as t from 'io-ts';


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

export const StepEvent = new EcsEvent<undefined>('step');
export const DeleteEvent = new EcsEvent<undefined>('delete');

export type EventData<E> = E extends EcsEvent<infer Data, any> ? Data : never;

export type UnknownEvent = EcsEvent<unknown, unknown>;

