import { Component } from "./component";

export class Entity {
    constructor(public components: Set<Component<unknown, unknown>>,
        public multiplayer: boolean) {

    }
}
