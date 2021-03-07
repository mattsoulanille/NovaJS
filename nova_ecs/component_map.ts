import { Component, UnknownComponent } from "./component";

export interface ReadonlyComponentMap extends ReadonlyMap<UnknownComponent, unknown> {
    get<Data>(component: Component<Data, any, any, any>): Data | undefined;
}

export interface ComponentMap extends Map<UnknownComponent, unknown> {
    get<Data>(component: Component<Data, any, any, any>): Data | undefined;
    set<Data>(component: Component<Data, any, any, any>, data: Data): this;
    delete(component: Component<any, any, any, any>): boolean;
}
