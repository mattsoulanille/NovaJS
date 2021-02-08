import * as PIXI from "pixi.js";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { Animation } from "../../../../novadatainterface/Animation";
import { Position } from "../../engine/space_object/Position";
import { Drawable } from "./Drawable";
import { SpaceObjectDrawable } from "./SpaceObjectDrawable";
import { SpaceObjectState } from "novajs/dist/bin/nova/src/proto/protobufjs_bundle";


export abstract class MainDrawable<State> implements Drawable<State> {
    readonly displayObject = new PIXI.Container();
    private animation?: Promise<Animation>;
    private id?: string;
    private spaceObjectDrawable: SpaceObjectDrawable;

    // id is the id for GameData. Not the UUID.
    constructor(protected readonly gameData: GameDataInterface) {
        this.spaceObjectDrawable = new SpaceObjectDrawable(gameData);
        this.displayObject.addChild(this.spaceObjectDrawable.displayObject);
    }

    protected abstract async getAnimation(id: string): Promise<Animation>;

    protected maybeUpdateId(id: string) {
        // TODO: Refactor the data format so animations are first class
        // so you can make a factoryQueueMap of animations that you
        // can quickly pull from.
        if (this.id !== id || !this.animation) {
            // This will start rendering as soon as the promise resolves.
            // The next frame if it's already cached, which is good enough.
            this.animation = this.getAnimation(id);
            this.spaceObjectDrawable.animation = this.animation;
            this.id = id;
        }
    }

    protected drawSpaceObject(state: SpaceObjectState | undefined, center: Position) {
        if (!state) {
            console.warn("State had no SpaceObjectState");
        } else {
            return this.spaceObjectDrawable.draw(state, center);
        }
        return false;
    }

    abstract draw(state: State, center: Position): boolean;
}
