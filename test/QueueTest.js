var chai = require("chai");
var expect = chai.expect;
var assert = chai.assert;

var Queue = require("../libraries/Queue.js");


describe("Queue", function() {

    var q = new Queue();
    var things = [1,2,3,"asdf",114];

    it("should enqueue things", function() {
	for (let i in things) {
	    q.enqueue(things[i]);
	}
    });

    it ("should dequeue things", function() {
	for (let i in things) {
	    expect(q.dequeue()).to.equal(things[i]);
	}
    });
    
});
