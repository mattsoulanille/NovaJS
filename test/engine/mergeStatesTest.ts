import { fail } from "assert";
import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import "mocha";
import { mergeStates } from "../../src/communication/mergeStates";
import { GameState } from "../../src/engine/GameState";
import { PartialState } from "../../src/engine/Stateful";


before(function() {
    chai.should();
    chai.use(chaiAsPromised);
});

describe("mergeStates", function() {

    it("Should correctly merge states", function() {
        const s1: PartialState<GameState> = {
            systems: {
                "system": {
                    planets: {},
                    ships: {
                        "ship": {
                            accelerating: 0,
                            position: { x: 4, y: 5 },
                            rotation: 3,
                            turning: 1
                        }
                    }
                }
            }
        }
        const s2: PartialState<GameState> = {
            systems: {
                "system": {
                    planets: {},
                    ships: {
                        "ship": {
                            accelerating: 1,
                            position: { x: 12, y: 15 }
                        },
                        "ship2": {
                            velocity: { x: 1, y: 5 }
                        }
                    }
                }
            }
        }

        mergeStates(s1, s2);

        s1.should.deep.equal({
            systems: {
                "system": {
                    planets: {},
                    ships: {
                        "ship": {
                            accelerating: 1,
                            position: { x: 12, y: 15 },
                            rotation: 3,
                            turning: 1
                        },
                        "ship2": {
                            velocity: { x: 1, y: 5 }
                        }
                    }
                }
            }
        });
    });
});
