import { Component, UnknownComponent } from "./component";

export interface ReadonlyComponentMap extends ReadonlyMap<UnknownComponent, unknown> {
    get<Data>(component: Component<Data>): Data | undefined;
}

export interface ComponentMap extends Map<UnknownComponent, unknown> {
    get<Data>(component: Component<Data>): Data | undefined;
    set<Data>(component: Component<Data>, data: Data): this;
    has<Data>(component: Component<Data>): boolean;
    delete(component: Component<any>): boolean;
}
