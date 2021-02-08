import { SpaceObjectDrawable } from "novajs/nova/src/client/display/SpaceObjectDrawable";
import { Position } from "novajs/nova/src/engine/Position";
import { SpaceObjectState } from "novajs/nova/src/proto/space_object_state_pb";
import { MockGameData } from "novadatainterface/MockGameData";
import { DefaultSpaceObjectData } from "novadatainterface/SpaceObjectData";
import { DefaultAnimation } from "novadatainterface/Animation";

describe("SpaceObjectDrawable", function() {

    let gameData: MockGameData;

    beforeEach(() => {
        gameData = new MockGameData();
    });


    it("Should be created", () => {
        const spaceObjectDrawable = new SpaceObjectDrawable(gameData);
        expect(spaceObjectDrawable).toBeDefined();
    })

    it("Should draw on the screen", () => {
        // gameData.data.SpaceObject.map.set("nova:128", DefaultSpaceObjectData);

        const spaceObjectDrawable = new SpaceObjectDrawable(gameData);
        spaceObjectDrawable.animation = DefaultAnimation;
        const spaceObjectState = new SpaceObjectState();

        // spaceObjectDrawable.draw(spaceObjectState, new Position(0, 0));
        // expect(spaceObjectDrawable.displayObject.children[0]).toBeDefined();
    })
});
