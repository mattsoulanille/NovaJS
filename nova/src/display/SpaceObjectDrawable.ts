import { Animation } from "novadatainterface/Animation";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { NovaDataType } from "novadatainterface/NovaDataInterface";
import * as PIXI from "pixi.js";
import { Position } from "../../engine/Position";
import { ObjectType, SpaceObject } from "../../engine/State";
import { AnimationGraphic } from "./AnimationGraphic";
import { Drawable } from "./Drawable";

type DrawType = NovaDataType.Ship | NovaDataType.Planet;

/** 
 * Responsible for drawing a spaceobject state
 */
export class SpaceObjectDrawable implements Drawable<SpaceObject> {

    private drawType?: DrawType;
    private id?: string;
    readonly displayObject = new PIXI.Container();
    private animationGraphic?: AnimationGraphic;

    private wrappedAnimation?: Animation | Promise<Animation>;
    set animation(animation: Animation | Promise<Animation> | undefined) {
        if (this.wrappedAnimation === animation) {
            return;
        }

        this.wrappedAnimation = animation;
        if (animation) {
            if (this.animationGraphic) {
                this.displayObject.removeChild(this.animationGraphic.displayObject);
            }
            this.animationGraphic = new AnimationGraphic({
                gameData: this.gameData,
                animation: animation,
            });
            this.displayObject.addChild(this.animationGraphic.displayObject);
        }
    }
    get animation() {
        return this.wrappedAnimation;
    }

    // TODO: Make this take an animation factoryqueuemap
    // so it can get animations on the same frame
    constructor(private readonly gameData: GameDataInterface) { }

    async setDrawTypeAndId(drawType: DrawType, id: string | null | undefined) {
        if (drawType === this.drawType && id === this.id) {
            return;
        }

        this.drawType = drawType;
        this.id = id ?? "default";

        const gettable = this.gameData.data[this.drawType]
        const cached = gettable.getCached(this.id);
        if (cached) {
            this.animation = cached.animation;
        } else {
            this.animation = (await gettable.get(this.id)).animation;
        }
    }

    draw(state: SpaceObject, center: Position) {
        if (state.objectType === ObjectType.SHIP) {
            this.setDrawTypeAndId(NovaDataType.Ship, state.id);
        } else if (state.objectType === ObjectType.PLANET) {
            this.setDrawTypeAndId(NovaDataType.Planet, state.id);
        } else {
            console.warn(`Can't draw object of type ${ObjectType[state.objectType]}`);
            return false;
        }

        if (this.id === "default") {
            console.warn("SpaceObjectDrawable extraState had no id");
        }

        if (!this.animation) {
            console.warn("SpaceObjectDrawable asked to render without animation");
            return false;
        }
        if (!this.animationGraphic) {
            console.warn("Missing Animation Graphic");
            return false;
        }

        const screenPosition = state.position
            .getClosestRelativeTo(center)
            .subtract(center);

        // TODO: Maybe add a setter for position to AnimationGraphic?
        this.animationGraphic.displayObject.position.x = screenPosition.x;
        this.animationGraphic.displayObject.position.y = screenPosition.y;
        this.animationGraphic.rotation = state.rotation.angle;

        // TODO: Make glow alpha gradually increase and decrease
        this.animationGraphic.glowAlpha = state.accelerating;

        const turning = state.turning;
        if (turning < 0) {
            this.animationGraphic.setFramesToUse("left");
        } else if (turning > 0) {
            this.animationGraphic.setFramesToUse("right");
        } else {
            this.animationGraphic.setFramesToUse("normal");
        }
        return true;
    }
}
