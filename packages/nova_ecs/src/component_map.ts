import { Component, UnknownComponent } from "./component.js";
import { EventMap } from "./event_map.js";

export interface ReadonlyComponentMap extends ReadonlyMap<UnknownComponent, unknown> {
    get<Data>(component: Component<Data>): Data | undefined;
}

export interface ComponentMap extends EventMap<UnknownComponent, unknown> {
    get<Data>(component: Component<Data>): Data | undefined;
    set<Data>(component: Component<Data>, data: NoInfer<Data>): this;
    has<Data>(component: Component<Data>): boolean;
    delete(component: Component<any>): boolean;
}
