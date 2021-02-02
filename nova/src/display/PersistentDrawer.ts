import * as PIXI from "pixi.js";
import { Queue, QueueImpl } from "../../common/Queue";
import { FactoryQueue } from "../../common/FactoryQueue";
import { Drawable, PersistentDrawable } from "./Drawable";
import { Position } from "../../engine/Position";

// Draws multiple states per frame
export class PersistentDrawer<Item extends Drawable<State>, State> implements PersistentDrawable<State> {
    readonly displayObject = new PIXI.Container();
    private readonly offscreenQueue: FactoryQueue<Item>;
    private readonly lastFrameQueue: Queue<Item> = new QueueImpl<Item>();
    readonly onscreenQueue: Queue<Item> = new QueueImpl<Item>();


    constructor(factory: () => Promise<Item>) {
        this.offscreenQueue = new FactoryQueue(factory);
    }

    draw(state: State, center: Position) {
        const maybeItem = this.getItem();
        if (maybeItem) {
            const success = maybeItem.draw(state, center);
            this.onscreenQueue.enqueue(maybeItem);
            return success;
        }

        return false;
    }

    clear() {
        // First, remove all the Drawables that weren't drawn
        // from the container.
        this.removeUnused();

        // Then, put all that were drawn last frame into a queue.
        this.onscreenQueue.emptyTo((item) => {
            this.lastFrameQueue.enqueue(item);
        });
    }

    // Used to clean up any extra drawables that were drawn
    // last frame but not this frame.
    private removeUnused() {
        this.lastFrameQueue.emptyTo((item) => {
            this.displayObject.removeChild(item.displayObject);
            this.offscreenQueue.enqueue(item);
        });
    }

    private getItem(): Item | null {
        const maybeItem = this.lastFrameQueue.dequeue();
        if (maybeItem) {
            return maybeItem;
        }

        const offscreenItem = this.offscreenQueue.dequeue();
        if (offscreenItem) {
            this.displayObject.addChild(offscreenItem.displayObject);
            return offscreenItem;
        }

        return null;
    }
}
