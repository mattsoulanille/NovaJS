import { PathReporter } from "io-ts/lib/PathReporter";
import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import "mocha";
import * as t from "io-ts";
import { RecursivePartial, PartialGameState } from "../../src/engine/Stateful";
import { GameState } from "../../src/engine/GameState";
import { fail } from "assert";
import { isRight } from "fp-ts/lib/Either";

before(function() {
    chai.should();
    chai.use(chaiAsPromised);

});


describe("parseGameState", function() {

    it("Should accept objects that are a partial game state", function() {
        let validState: RecursivePartial<GameState> = {
            systems: {
                "s1": {
                    ships: {
                        "ship": {
                            position: { x: 4, y: 8.5 }
                        }
                    },
                }
            }
        }

        let s = PartialGameState.decode(validState);

        if (isRight(s)) {
            s.right.should.deep.equal(validState);
        }
        else {
            fail(PathReporter.report(s).join("\n"));
        }
    });

    it("Should reject objects that are not a partial game state", function() {
        let invalidState = {
            systems: {
                "s1": {
                    ships: {
                        "ship": {
                            position: { x: "Not ok", y: 4 }
                        }
                    },
                }
            }
        }

        let s = PartialGameState.decode(invalidState);

        if (isRight(s)) {
            fail("Parsed invalid state into the following:\n"
                + JSON.stringify(s.right));
        }
    });
});

