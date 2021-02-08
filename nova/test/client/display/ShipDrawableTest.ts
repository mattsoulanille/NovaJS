import { ShipDrawable } from "novajs/nova/src/client/display/ShipDrawable";
import { Position } from "novajs/nova/src/engine/Position";
import { ShipState } from "novajs/nova/src/proto/ship_state_pb";
import { MockGameData } from "novadatainterface/MockGameData";
import { getDefaultShipData } from "novadatainterface/ShipData";

describe("ShipDrawable", function() {

    let gameData: MockGameData;

    beforeEach(() => {
        gameData = new MockGameData();
    });


    it("Should be created", () => {
        const shipDrawable = new ShipDrawable(gameData);
        expect(shipDrawable).toBeDefined();
    })

    // TODO: Test this better
    it("Should draw on the screen", () => {
        gameData.data.Ship.map.set("nova:128", getDefaultShipData());
        const shipDrawable = new ShipDrawable(gameData);
        const shipState = new ShipState();
        shipState.setId("nova:128");

        shipDrawable.draw(shipState, new Position(0, 0));
        expect(shipDrawable.displayObject.children[0]).toBeDefined();
    })
});

