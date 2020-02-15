import { GameDataInterface } from "novajs/novadatainterface/GameDataInterface";
import * as PIXI from "pixi.js";
import { Animation } from "../../../../novadatainterface/Animation";
import { SpriteSheetSprite } from "./SpriteSheetSprite";
import { Position } from "../../engine/Position";
import { SpaceObjectState } from "novajs/nova/src/proto/space_object_state_pb";

/**
 * An AnimationGraphic is responsible for managing all the PIXI Sprites
 * needed to draw a single animation, be it a ship, explosion, asteroid,
 * or planet.
 */
export class AnimationGraphic extends PIXI.Container {
    // We extend PIXI.Container since it would otherwise be confusing
    // to have to set rotation via a method on this object and position 
    // via displayObject.position. Might revisit this decision.
    // AnimationGraphic is not a Drawable since it doesn't draw a state.
    protected readonly gameData: GameDataInterface;

    readonly sprites: Map<string, SpriteSheetSprite> = new Map();
    private _rotation: number = 0;
    private animation: Animation | Promise<Animation>;
    readonly buildPromise: Promise<AnimationGraphic>;
    private built = false;

    constructor({ gameData, animation }: { gameData: GameDataInterface, animation: Animation | Promise<Animation> }) {
        super();
        this.animation = animation;
        this.gameData = gameData;
        this.rotation = 0;
        this.buildPromise = this.build();
    }

    private async build(): Promise<AnimationGraphic> {
        var promises: Promise<unknown>[] = [];
        for (let imageName in (await this.animation).images) {
            let image = (await this.animation).images[imageName];
            let sprite = new SpriteSheetSprite({
                id: image.id,
                imagePurposes: image.imagePurposes,
                gameData: this.gameData
            });

            if (imageName === "glowImage" || // Engine glow
                imageName === "lightImage") { // Lights

                sprite.blendMode = PIXI.BLEND_MODES.ADD;
            }

            this.sprites.set(imageName, sprite);
            this.addChild(sprite);
            promises.push(sprite.buildPromise);
        }
        await Promise.all(promises);
        this.rotation = this.rotation;
        this.built = true;
        return this;
    }

    // This might not be the right place for this function. 
    drawSpaceObjectState(state: SpaceObjectState, center: Position): boolean {
        // Center is the center of the viewport.
        if (!this.built) {
            console.warn("AnimationGraphic not yet built");
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

        this.position.x = screenPosition.x;
        this.position.y = screenPosition.y;
        this.rotation = state.getRotation();

        const glowImage = this.sprites.get('glowImage');
        if (glowImage) {
            glowImage.alpha = state.getAccelerating();;
        }

        // TODO: Handle this in the draw function instead?
        const turning = state.getTurning();
        if (turning < 0) {
            this.setFramesToUse("left");
        } else if (turning > 0) {
            this.setFramesToUse("right");
        } else {
            this.setFramesToUse("normal");
        }
        return true;
    }

    setFramesToUse(frames: string) {
        for (let sprite of this.sprites.values()) {
            sprite.setFramesToUse(frames);
        }
    }

    set rotation(angle: number) {
        this._rotation = angle;
        for (let sprite of this.sprites.values()) {
            sprite.rotation = angle;
        }
    }

    get rotation() {
        return this._rotation;
    }
}
