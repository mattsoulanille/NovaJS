var chai = require("chai");
var expect = chai.expect;
var assert = chai.assert;

var novaParse = require("novaParse");
var shanParse = require("../parsing/shanParse.js");

describe("shanParse", function() {

    var shuttle;
    var thunderforge;
    this.timeout(10000);
    
    before(async function() {
	var np = new novaParse("./Nova\ Data");
	await np.read();
	shuttle = new shanParse(np.ids.resources.shän['nova:128']);
	thunderforge = new shanParse(np.ids.resources.shän['nova:380']);
	await shuttle.build();
	await thunderforge.build();
    });


    it("should build imagePurposes metadata from frameInfo", function() {
	Object.values(shuttle.spriteSheets).forEach(function(sheet) {
	    expect(sheet.frameInfo.meta.imagePurposes).to.deep.equal({
		normal: { start: 0, length: 36 },
		left: { start: 36, length: 36 },
		right: { start: 72, length: 36 }
	    });
	});

	expect(thunderforge.spriteSheets.baseImage.frameInfo.meta.imagePurposes).to.deep.equal({
	    normal: { start: 0, length: 64 },
	    animation: { start: 64, length: 0}
	});
	expect(thunderforge.spriteSheets.altImage.frameInfo.meta.imagePurposes).to.deep.equal({
	    normal: { start: 0, length: 64 },
	    animation: { start: 64, length: 320 }
	});

    });

});
