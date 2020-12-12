import { Entity } from "./entity";

export class World {
    entities = new Map<string, Entity>();
    systems = new Map<string, System>();
}
