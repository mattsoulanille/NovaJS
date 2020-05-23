import { Drawable } from "./Drawable";
import { Position } from "../../engine/space_object/Position";
import * as PIXI from "pixi.js";


export class DrawableMap<D extends Drawable<View>, View>
    implements Drawable<[string, View][]> {

    readonly displayObject = new PIXI.Container()
    private readonly uuidMap =
        new Map<string, { item: D, drawn: boolean }>();

    constructor(private readonly factory: () => D) { }

    draw(views: Iterable<[string, View]>, center: Position): boolean {
        for (const [uuid, view] of views) {
            if (!this.uuidMap.has(uuid)) {
                const item = this.factory();
                this.displayObject.addChild(item.displayObject);
                this.uuidMap.set(uuid, {
                    item: item,
                    drawn: false,
                });
            }
            const val = this.uuidMap.get(uuid)!;
            val.item.draw(view, center);
            val.drawn = true;
        }

        for (const [uuid, val] of this.uuidMap.entries()) {
            if (!val.drawn) {
                this.displayObject.removeChild(val.item.displayObject);
                this.uuidMap.delete(uuid);
            } else {
                val.drawn = false;
            }
        }
        return true;
    }
}
