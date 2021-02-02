import { World } from "./world";

export interface Plugin {
    name?: string;
    build: (world: World) => void;
}
