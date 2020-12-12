import { Entity } from "./entity";
import { System } from "./system";

export class World<Systems extends System> {
    //entities = new Map<string /* UUID */, Entity>();
    //systems = new Map<string, System>();

    constructor(private systems: Set<Systems>)

    function spawn() {

}
}
