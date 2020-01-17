import { fail } from "assert";
import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import "mocha";
import { filterUUIDs } from "../../src/communication/filterUUIDs";
import { GameState } from "../../src/engine/GameState";
import { PartialState } from "../../src/engine/Stateful";


before(function() {
    chai.should();
    chai.use(chaiAsPromised);
});

describe("filerUUIDs", function() {
    it("Should filter allowed UUIDs when given a partial gamestate and a set of UUIDs", function() {
        const gameState: PartialState<GameState> = {
            systems: {
                "s1": {
                    planets: {
                        "p1": {
                            id: "nova:129"
                        },
                        "p2": {
                            id: "nova:130"
                        }
                    },
                    ships: {
                        "s1": {
                            id: "nova:200"
                        },
                        "s2": {
                            id: "nova:201"
                        }
                    }

                }
            }

        };

        const allowedUUIDs = new Set(["p1", "s2"]);

        const filtered = filterUUIDs(gameState, allowedUUIDs);

        const filteredShouldEqual: PartialState<GameState> = {
            systems: {
                "s1": {
                    planets: {
                        "p1": {
                            id: "nova:129"
                        }
                    },
                    ships: {
                        "s2": {
                            id: "nova:201"
                        }
                    }

                }
            }

        };

        filtered.should.deep.equal(filteredShouldEqual);

    });
});
