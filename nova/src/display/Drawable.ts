import * as PIXI from "pixi.js";
import { Position } from "../../engine/Position";

// It's probably okay to extend PIXI.DisplayObject since it has a relatively stable interface, and it would be a pain to implement all the methods that simply pass through to 
export interface Drawable<State> {
    draw(state: State, center: Position): boolean;
    displayObject: PIXI.DisplayObject;
}

export interface WithId {
    readonly id: string;
}


// A drawable that can be drawn multiple times per frame.
export interface PersistentDrawable<State> extends Drawable<State> {
    clear(): void; // Clears everything that has been drawn
}

export interface DrawableWithId<State> extends Drawable<State>, WithId { };

export type DrawableFactory<O extends DrawableWithId<State>, State> = (id: string) => Promise<O>;
