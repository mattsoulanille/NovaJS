import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import "mocha";
import { StatefulMap } from "../../src/engine/StatefulMap";
import { Stateful, StateIndexer } from "../../src/engine/Stateful";
import { fail } from "assert";


import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { NovaParse } from "novaparse/NovaParse";
import { Engine } from "../../src/engine/Engine";

before(function() {
    chai.should();
    chai.use(chaiAsPromised);

});


describe("Engine", function() {


    const gameData: GameDataInterface = new NovaParse("./Nova\ Data/", false);
    const engine: Engine = new Engine({ gameData });

    it("Should construct the required objects when setting the state", async function() {

        engine.setState({});





    });

});
