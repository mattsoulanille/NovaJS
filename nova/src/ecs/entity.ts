import v4 from "uuid/v4";

export class Entity {
    constructor(readonly uuid = v4()) {

    }
}
