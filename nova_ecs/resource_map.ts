import { Resource, UnknownResource } from "./resource";
import { MutableImmutableMapHandle } from "./mutable_immutable_map_handle";
import { currentIfDraft } from "./utils";
import { CallWithDraft, State } from "./world";

export interface ReadonlyResourceMap extends ReadonlyMap<UnknownResource, unknown> {
    get<Data>(resource: Resource<Data, any, any, any>): Data | undefined;
}

export interface ResourceMap extends Map<UnknownResource, unknown> {
    get<Data>(resource: Resource<Data, any, any, any>): Data | undefined;
    set<Data>(resource: Resource<Data, any, any, any>, data: Data): this;
    delete(resource: Resource<any, any, any, any>): boolean;
}

export class ResourceMapHandle
    extends MutableImmutableMapHandle<UnknownResource, unknown>
    implements ResourceMap {
    constructor(mutableResources: ResourceMap,
        callWithDraft: CallWithDraft,
        private addResource: (resource: Resource<any, any, any, any>) => void) {
        super(mutableResources, (callback) => callWithDraft(
            draft => callback(draft.resources)),
            resource => resource.mutable,
            currentIfDraft)
    }

    get<Data>(resource: Resource<Data, any, any, any>): Data | undefined {
        return super.get(resource as UnknownResource) as Data;
    };

    set<Data>(resource: Resource<Data, any, any, any>, data: Data): this {
        this.addResource(resource);
        return super.set(resource as UnknownResource, data);
    };

    delete(_resource: Resource<any, any, any, any>): boolean {
        throw new Error('Resources can not be deleted since a system may depend on them');
        // TODO: Allow deletion of resources. Check the systems.
        //return super.delete(resource as UnknownResource);
    };
}
