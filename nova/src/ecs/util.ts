import { Component } from "./component";

export interface WithComponents {
    components: ReadonlyMap<Component<unknown, unknown>, unknown>;
}
