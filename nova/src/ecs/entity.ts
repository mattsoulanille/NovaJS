import { Component } from "./component";

export class Entity {
    constructor(public components: Set<Component<string, unknown, unknown>>) {

    }
}
