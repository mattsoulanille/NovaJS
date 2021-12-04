import { World } from "./world";

export interface Plugin {
    name?: string;
    build: (world: World) => void | Promise<void>;
    remove?: (world: World) => void;
}
