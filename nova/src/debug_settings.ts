import { World } from "nova_ecs/world";
import { ConvexHullDisplayPlugin } from "./display/convex_hull_display_plugin";


export class DebugSettings {
    private wrappedShowCollisionShapes = false;

    constructor(public world: World, settings?: DebugSettings) {
        if (settings) {
            this.showCollisionShapes = settings.showCollisionShapes;
        }
    }

    set showCollisionShapes(val: boolean) {
        this.wrappedShowCollisionShapes = val;
        if (val) {
            this.world.addPlugin(ConvexHullDisplayPlugin);
        } else {
            this.world.removePlugin(ConvexHullDisplayPlugin);
        }
    }

    get showCollisionShapes() {
        return this.wrappedShowCollisionShapes;
    }
}
