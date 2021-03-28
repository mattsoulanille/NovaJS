import { EventMap } from "./event_map";
import { Resource, UnknownResource } from "./resource";

export interface ReadonlyResourceMap extends ReadonlyMap<UnknownResource, unknown> {
    get<Data>(resource: Resource<Data, any, any, any>): Data | undefined;
}

export interface ResourceMap extends Map<UnknownResource, unknown> {
    get<Data>(resource: Resource<Data, any, any, any>): Data | undefined;
    set<Data>(resource: Resource<Data, any, any, any>, data: Data): this;
    has<Data>(resource: Resource<Data, any, any, any>): boolean;
    delete(resource: Resource<any, any, any, any>): boolean;
}

export class ResourceMapWrapped extends EventMap<UnknownResource, unknown> implements ResourceMap {
    get<Data>(resource: Resource<Data, any, any, any>): Data | undefined {
        return super.get(resource as UnknownResource) as Data | undefined;
    };
    set<Data>(resource: Resource<Data, any, any, any>, data: Data): this {
        super.set(resource as UnknownResource, data);
        return this;
    };
    has<Data>(resource: Resource<Data, any, any, any>): boolean {
        return super.has(resource as UnknownResource);
    }
}
