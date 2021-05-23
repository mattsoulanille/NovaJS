import { EventMap } from "./event_map";
import { Resource, UnknownResource } from "./resource";

export interface ReadonlyResourceMap extends ReadonlyMap<UnknownResource, unknown> {
    get<Data>(resource: Resource<Data>): Data | undefined;
}

export interface ResourceMap extends Map<UnknownResource, unknown> {
    get<Data>(resource: Resource<Data>): Data | undefined;
    set<Data>(resource: Resource<Data>, data: Data): this;
    has<Data>(resource: Resource<Data>): boolean;
    delete(resource: Resource<any>): boolean;
}

export class ResourceMapWrapped extends Map<UnknownResource, unknown> implements ResourceMap {
    constructor(private addResource: (resource: Resource<any>) => void,
        private removeResource: (resource: Resource<any>) => boolean) {
        super();
    }

    get<Data>(resource: Resource<Data>): Data | undefined {
        return super.get(resource as UnknownResource) as Data | undefined;
    };
    set<Data>(resource: Resource<Data>, data: Data): this {
        this.addResource(resource);
        super.set(resource as UnknownResource, data);
        return this;
    };
    has<Data>(resource: Resource<Data>): boolean {
        return super.has(resource as UnknownResource);
    }
    delete(resource: Resource<any>): boolean {
        return this.removeResource(resource) &&
            super.delete(resource as UnknownResource);
    };
}
