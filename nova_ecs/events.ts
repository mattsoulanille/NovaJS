import * as t from 'io-ts';


const eventSymbol = Symbol('Event');
export class EcsEvent<Data, DataSerialized = Data> {
    // Necessary so Query does not extend EcsEvent, which ruins the arg
    // type system.
    private readonly eventSymbol = eventSymbol;
    readonly name?: string;
    readonly type?: t.Type<Data, DataSerialized>;

    constructor(args?: { name?: string, type?: t.Type<Data, DataSerialized> }) {
        this.name = args?.name;
        this.type = args?.type;
    }
}

export const StepEvent = new EcsEvent<undefined>({ name: 'step' });
export const DeleteEvent = new EcsEvent<undefined>({ name: 'delete' });

export type EventData<E> = E extends EcsEvent<infer Data, any> ? Data : never;

export type UnknownEvent = EcsEvent<unknown, unknown>;

