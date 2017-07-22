var assert = require("assert");
var idSpace = require("../idSpace");



describe("idSpace", function() {

    var novaData = {
	"rled" :["some", "example", "rleds"],
	"shan" :["more", "stuff"]
    };


    var p1Rleds = ["modifying"];
    p1Rleds[5] = "adding";
    p1Rleds[6] = "overwrite me";
    var plugin1 = {
	"rled" :p1Rleds,
	"shan" :["from", "plugin1"]
    };

    var p2Rleds = [];
    p2Rleds[6] = "overwritten by p2";

    var plugin2 = {
	"rled": p2Rleds
    };
    var ids = new idSpace(novaData);

    it("should store nova ids with the correct prefix", function() {

	assert.equal(ids.resources["rled"]["nova:0"], "some");
	assert.equal(ids.resources["rled"]["nova:1"], "example");
	assert.equal(ids.resources["rled"]["nova:2"], "rleds");
	assert.equal(ids.resources["shan"]["nova:0"], "more");
	assert.equal(ids.resources["shan"]["nova:1"], "stuff");

    });



    it("should store plugin ids separately if they are different from nova ids", function() {
	ids.addPlugin(plugin1, "plugin1");
	assert.equal(ids.resources["rled"]["plugin1:5"], "adding");
	assert.equal(ids.resources["rled"]["plugin1:6"], "overwrite me");
    });

    it("should overwrite nova ids if they have the same id number", function() {
	assert.equal(ids.resources["rled"]["nova:0"], "modifying");
    });
    

    it("should allow plugins to overwrite others' ids if they share a prefix", function() {
	ids.addPlugin(plugin2, "plugin1");
	assert.equal(ids.resources["rled"]["plugin1:6"], "overwritten by p2");
    });
    

});
