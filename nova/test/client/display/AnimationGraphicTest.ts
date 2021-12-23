import { AnimationGraphic } from "novajs/nova/src/client/display/AnimationGraphic";
import { Position } from "novajs/nova/src/engine/Position";
import { MockGameData } from "nova_data_interface/MockGameData";
import { getDefaultAnimation } from "nova_data_interface/Animation";
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
            animation: getDefaultAnimation()
        });
        expect(animationGraphic).toBeDefined();
    })
});

