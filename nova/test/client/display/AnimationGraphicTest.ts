import { AnimationGraphic } from "novajs/nova/src/client/display/AnimationGraphic";
import { Position } from "novajs/nova/src/engine/Position";
import { MockGameData } from "novajs/novadatainterface/MockGameData";
import { DefaultAnimation } from "novajs/novadatainterface/Animation";
import { SpaceObjectState } from "novajs/nova/src/proto/space_object_state_pb";
import * as PIXI from "pixi.js";

describe("AnimationGraphic", function() {

    let gameData: MockGameData;

    beforeEach(() => {
        gameData = new MockGameData();
    });


    it("Should be created", () => {
        const animationGraphic = new AnimationGraphic({
            gameData: gameData,
            animation: DefaultAnimation
        });
        expect(animationGraphic).toBeDefined();
    })

    it("Should draw a space object state in the correct relative position", async () => {
        const animationGraphic = new AnimationGraphic({
            gameData: gameData,
            animation: DefaultAnimation
        });
        const spaceObjectState = new SpaceObjectState();
        spaceObjectState.setPosition(new Position(12, -14).getState());
        await animationGraphic.buildPromise;

        animationGraphic
            .drawSpaceObjectState(spaceObjectState, new Position(2, 3));

        expect(animationGraphic.position.x).toEqual(10); // 12 - 2
        expect(animationGraphic.position.y).toEqual(-17); // -14 - 3
    })

    it("Should draw a space object state in the correct rotation", async () => {
        const animationGraphic = new AnimationGraphic({
            gameData: gameData,
            animation: DefaultAnimation
        });

        const spaceObjectState = new SpaceObjectState();
        // Must have a position to be rendered
        spaceObjectState.setPosition(new Position(12, -14).getState());
        spaceObjectState.setRotation(3.2);
        await animationGraphic.buildPromise;

        animationGraphic
            .drawSpaceObjectState(spaceObjectState, new Position(0, 0));

        expect(animationGraphic.rotation).toEqual(3.2);
    })


});

