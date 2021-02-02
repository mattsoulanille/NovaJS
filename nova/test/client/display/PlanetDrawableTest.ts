import { PlanetDrawable } from "novajs/nova/src/client/display/PlanetDrawable";
import { Position } from "novajs/nova/src/engine/Position";
import { PlanetState } from "novajs/nova/src/proto/planet_state_pb";
import { MockGameData } from "novajs/novadatainterface/MockGameData";
import { getDefaultPlanetData } from "novajs/novadatainterface/PlanetData";

describe("PlanetDrawable", function() {

    let gameData: MockGameData;

    beforeEach(() => {
        gameData = new MockGameData();
    });


    it("Should be created", () => {
        const planetDrawable = new PlanetDrawable(gameData);
        expect(planetDrawable).toBeDefined();
    })

    it("Should draw on the screen", () => {
        gameData.data.Planet.map.set("nova:128", getDefaultPlanetData());
        const planetDrawable = new PlanetDrawable(gameData);
        const planetState = new PlanetState();
        planetState.setId("nova:128");

        planetDrawable.draw(planetState, new Position(0, 0));
        expect(planetDrawable.displayObject.children[0]).toBeDefined();
    })
});
