import { fail } from "assert";
import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import "mocha";
import { Keybindings } from "../../src/client/KeyboardController";
import { ControlEvent } from "../../src/common/Controller";
import { PathReporter } from "io-ts/lib/PathReporter";
import { isRight } from "fp-ts/lib/Either";

before(function() {
    chai.should();
    chai.use(chaiAsPromised);
});

describe("Keybindings", function() {
    it("Should parse correct keybindings properly", function() {
        const correct: Keybindings = {
            20: [ControlEvent.firePrimary]
        }

        const decoded = Keybindings.decode(correct);

        if (isRight(decoded)) {
            decoded.right.should.deep.equal(correct);
        }
        else {
            fail(PathReporter.report(decoded).join("\n"));
        }
    })
});


