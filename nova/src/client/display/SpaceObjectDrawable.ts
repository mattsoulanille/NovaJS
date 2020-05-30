import { GameDataInterface } from "novajs/novadatainterface/GameDataInterface";
import { AnimationGraphic } from "./AnimationGraphic";
import { Drawable } from "./Drawable";
import { Position } from "../../engine/space_object/Position";
import { Animation } from "novajs/novadatainterface/Animation";
import * as PIXI from "pixi.js";
import { SpaceObjectView } from "../../engine/TreeView";
import { NovaDataType } from "novajs/novadatainterface/NovaDataInterface";

type DrawType = NovaDataType.Ship | NovaDataType.Planet;

/** 
 * Responsible for drawing a spaceobject state
 */
export class SpaceObjectDrawable implements Drawable<SpaceObjectView> {

    private drawType?: DrawType;
    private id?: string;
    readonly displayObject = new PIXI.Container();
    private animationGraphic?: AnimationGraphic;

    // The id of the animation to use isn't encoded directly in
    // the SpaceObjectState because there are several different
    // types of objects, like planets and ships, that render
    // using SpaceObjectDrawable and have different namespaces
    // for the animations they use. The id is instead stored
    // in the extraState field, which is a oneof field with
    // ship / planet / etc. information.
    private wrappedAnimation?: Animation | Promise<Animation>;
    set animation(animation: Animation | Promise<Animation> | undefined) {
        if (this.wrappedAnimation === animation) {
            return;
        }

        this.wrappedAnimation = animation;
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

    draw(state: SpaceObjectView, center: Position) {
        if (state.protobuf.shipState) {
            this.setDrawTypeAndId(NovaDataType.Ship, state.protobuf.shipState.id);
        } else if (state.protobuf.planetState) {
            this.setDrawTypeAndId(NovaDataType.Planet, state.protobuf.planetState.id)
        } else {
            console.warn("SpaceObjectDrawable had no extraState");
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

        if (!state.protobuf.position) {
            console.warn("State had no position")
            return false;
        }

        const realPosition = Position.fromProto(state.protobuf.position);
        const screenPosition = realPosition
            .getClosestRelativeTo(center)
            .subtract(center);

        this.animationGraphic.position.x = screenPosition.x;
        this.animationGraphic.position.y = screenPosition.y;
        this.animationGraphic.rotation = state.protobuf.rotation ?? 0;

        // TODO: Make glow alpha gradually increase and decrease
        this.animationGraphic.glowAlpha = state.protobuf.accelerating ?? 0;

        const turning = state.protobuf.turning ?? 0;
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
