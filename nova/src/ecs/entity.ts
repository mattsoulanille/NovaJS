import { Component, ComponentData } from "./component";

export class Entity<C extends Component<any, any>> {
    constructor(readonly components: Map<C, ComponentData<C>>,
        readonly multiplayer: boolean, readonly uuid: string) { }
}
