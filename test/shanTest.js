var assert = require('assert');
var resourceFork = require('resourceforkjs').resourceFork;

var shan = require('../parsers/shan.js');


describe("shan", function() {
    var rf;
    var miner;
    var thunderforge;
    var shuttle;
    before(function(done) {
	rf = new resourceFork("./test/files/shan.ndat", false);
	rf.read().then(function() {
	    var shans = rf.resources.shän;
	    var shuttle = new shan(shans[128]);
	    var thunderforge = new shan(shans[379]);
	    var miner = new shan(shans[380]);
	    done();
	}.bind(this));
    });

    it("should parse baseImageID", function() {
	
	
    });
    

});
