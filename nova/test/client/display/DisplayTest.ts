import { ShipDrawable } from "novajs/nova/src/client/display/ShipDrawable";
import { Display } from "novajs/nova/src/client/display/Display";
import { Position } from "novajs/nova/src/engine/Position";
//import { ShipState } from "novajs/nova/src/proto/ship_state_pb";
import { MockGameData } from "novajs/novadatainterface/MockGameData";
import { DefaultShipData } from "novajs/novadatainterface/ShipData";

describe("Display", function() {

    let gameData: MockGameData;

    beforeEach(() => {
        gameData = new MockGameData();
    });

    it("Should be created", () => {
        const display = new Display({ gameData });
        expect(display).toBeDefined();
    })
});

