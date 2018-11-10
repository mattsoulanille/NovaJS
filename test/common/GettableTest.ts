
import { Gettable } from "../../src/common/Gettable";

import * as chai from "chai";
import "mocha";
import * as chaiAsPromised from "chai-as-promised";

before(function() {
    chai.should();
    chai.use(chaiAsPromised);

});

const expect = chai.expect;


function getFunc(id: string) {
    return new Promise<string>(function(fulfill, reject) {
        if (id != "foo") {
            fulfill(id + "cats");
        }
        else {
            reject("got foo!");
        }
    });
}


describe("Gettable", function() {

    var g: Gettable<string>;
    before(function() {
        g = new Gettable<string>(getFunc);
    });

    it("Should get values", function() {
        expect(g.get("hello")).to.eventually.equal("hellocats");
        expect(g.get("goodbye")).to.eventually.equal("goodbyecats");
    });

    it("Should pass along rejections", function() {
        expect(g.get("foo")).to.be.rejectedWith("got foo!");
    });


});


