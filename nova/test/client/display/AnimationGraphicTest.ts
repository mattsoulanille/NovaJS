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
});

