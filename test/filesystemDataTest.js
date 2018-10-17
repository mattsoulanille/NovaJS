var chai = require("chai");
var expect = chai.expect;
var assert = chai.assert;
var fs = require("fs");

var filesystemData = require("../parsing/filesystemData.js");

describe("filesystemData", function() {

    var fd;
    before(async function() {
	fd = new filesystemData("objects");
    });

    it("should read statusBars", async function() {
	var data = await fd.statusBars.get("civilian");
	console.log(data);
	expect(data).to.deep.equal(fs.readFileSync("objects/statusBars/civilian.json"));
    });
});
