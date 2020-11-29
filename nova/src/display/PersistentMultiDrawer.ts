import { GameDataInterface } from "novajs/novadatainterface/GameDataInterface";
import * as PIXI from "pixi.js";
import { FactoryQueueMap } from "../../common/FactoryQueueMap";
import { Position } from "../../engine/Position";
import { DrawableWithId, Drawable, PersistentDrawable } from "./Drawable";
import { PersistentDrawer } from "./PersistentDrawer";

interface GetId {
    getId(): string;
}

// Draws multiple instances of drawables that have different IDs
class PersistentMultiDrawer<Item extends DrawableWithId<State>, State extends GetId> implements PersistentDrawable<State> {

    readonly displayObject = new PIXI.Container();

    // A map from ids to corresponding drawers
    private readonly drawers = new Map<string, PersistentDrawer<Item, State>>();

    constructor(private readonly itemFactory: (id: string) => Promise<Item>) { }

    draw(state: State, center: Position) {
        const id = state.getId();
        if (!this.drawers.has(id)) {
            const drawer = new PersistentDrawer(() => {
                return this.itemFactory(id);
            });
            this.drawers.set(id, drawer);
        }

        // Exists because if it didn't, it was just added above.
        const drawer = this.drawers.get(id)!;
        return drawer.draw(state, center);
    }

    clear() {
        for (const drawer of this.drawers.values()) {
            drawer.clear()
        }
    }
}

export { PersistentMultiDrawer };
