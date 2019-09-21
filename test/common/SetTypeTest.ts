import { fail } from "assert";
import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import "mocha";
import { SetType } from "../../src/common/SetType";
import * as t from "io-ts";

before(function() {
    chai.should();
    chai.use(chaiAsPromised);
});

describe("SetType", function() {

    const numberStringSet = SetType(t.union([t.number, t.string]));
    it("Should decode arrays as sets and encode sets as arrays", function() {
        const input = [1, "two", "three", 4, 5, "six"];

        const decoded = numberStringSet.decode(input);
        if (decoded.isRight()) {
            decoded.value.should.deep.equal(new Set(input));
        }
        else {
            fail("Failed to parse " + input + " as a set");
        }

        const toEncode = new Set(input);
        numberStringSet.encode(toEncode).should.deep.equal(input);
    });

    it("Should not parse things that are not the correct type of set", function() {
        const invalid = [{}, 4, 5]
        const decoded = numberStringSet.decode(invalid);
        if (decoded.isRight()) {
            fail("Decoded invalid set " + invalid);
        }
    });

    it("Should 'decode' sets as sets", function() {
        const input = new Set([1, "two", "three", 4]);

        let decoded = numberStringSet.decode(input);
        if (decoded.isRight()) {
            decoded.value.should.deep.equal(input);
        }
        else {
            fail(`Failed to parse ${input}`);
        }

        const invalid = new Set([1, {}, undefined]);

        decoded = numberStringSet.decode(invalid);
        if (decoded.isRight()) {
            fail(`Accepted invalid input ${invalid}`);
        }
    });
})

