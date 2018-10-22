const chai = require("chai");
const expect = chai.expect;
const assert = chai.assert;

const vector = require("../libraries/vector.js");

describe("vector", function() {

    var a = new vector(45, 87);

    it("should save values", function() {
	expect(a.x).to.equal(45);
	expect(a.y).to.equal(87);
    });

    it("should allow [] access of values", function() {
	expect(a[0]).to.equal(a.x);
	expect(a[1]).to.equal(a.y);
    });

    it("should allow the spread operator", function() {
	expect([...a]).to.deep.equal([45, 87]);
    });

});
