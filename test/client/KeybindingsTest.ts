import { fail } from "assert";
import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import "mocha";
import { Keybindings } from "../../src/client/KeyboardController";
import { ControlEvent } from "../../src/client/Controller";
import { PathReporter } from "io-ts/lib/PathReporter";

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

        if (decoded.isRight()) {
            decoded.value.should.deep.equal(correct);
        }
        else {
            fail(PathReporter.report(decoded).join("\n"));
        }
    })


});


