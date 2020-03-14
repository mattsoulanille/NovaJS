import { SpaceObjectState } from "novajs/nova/src/proto/space_object_state_pb";
import { GameDataInterface } from "novajs/novadatainterface/GameDataInterface";
import { AnimationGraphic } from "./AnimationGraphic";
import { Drawable } from "./Drawable";
import { Position } from "../../engine/Position";
import { Animation } from "novajs/novadatainterface/Animation";
import * as PIXI from "pixi.js";

/**
 * Responsible for drawing a spaceobject state
 */
export class SpaceObjectDrawable implements Drawable<SpaceObjectState> {

    readonly displayObject = new PIXI.Container();
    private animationGraphic?: AnimationGraphic;

    // The id of the animation to use can't be encoded in
    // the SpaceObjectState because there are several different
    // types of objects, like planets and ships, that render
    // using SpaceObjectDrawable and have different namespaces
    // for the animations they use.
    private _animation?: Animation | Promise<Animation>;
    set animation(animation: Animation | Promise<Animation> | undefined) {
        if (this._animation === animation) {
            return;
        }

        this._animation = animation;
        if (animation) {
            if (this.animationGraphic) {
                this.displayObject.removeChild(this.animationGraphic);
            }
            this.animationGraphic = new AnimationGraphic({
                gameData: this.gameData,
                animation: animation,
            });
            this.displayObject.addChild(this.animationGraphic);
        }
    }
    get animation() {
        return this._animation;
    }

    // TODO: Make this take an animation factoryqueuemap
    // so it can get animations on the same frame
    constructor(private readonly gameData: GameDataInterface) { }

    draw(state: SpaceObjectState, center: Position) {
        if (!this.animation) {
            console.warn("SpaceObjectDrawable asked to render without animation");
            return false;
        }
        if (!this.animationGraphic) {
            console.warn("Missing Animation Graphic");
            return false;
        }


        const statePosition = state.getPosition();
        if (!statePosition) {
            console.warn("State had no position")
            return false;
        }

        const realPosition = Position.fromProto(statePosition);
        const screenPosition = realPosition
            .getClosestRelativeTo(center)
            .subtract(center);

        this.animationGraphic.position.x = screenPosition.x;
        this.animationGraphic.position.y = screenPosition.y;
        this.animationGraphic.rotation = state.getRotation();

        // TODO: Make glow alpha gradually increase and decrease
        this.animationGraphic.glowAlpha = state.getAccelerating();

        const turning = state.getTurning();
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
