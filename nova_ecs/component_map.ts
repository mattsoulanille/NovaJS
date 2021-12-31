import { Component, UnknownComponent } from "./component";
import { EventMap } from "./event_map";

export interface ReadonlyComponentMap extends ReadonlyMap<UnknownComponent, unknown> {
    get<Data>(component: Component<Data>): Data | undefined;
}

export interface ComponentMap extends EventMap<UnknownComponent, unknown> {
    get<Data>(component: Component<Data>): Data | undefined;
    set<Data>(component: Component<Data>, data: Data): this;
    has<Data>(component: Component<Data>): boolean;
    delete(component: Component<any>): boolean;
}
