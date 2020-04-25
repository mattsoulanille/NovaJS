import "jasmine";
import { Gettable } from "../Gettable";


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
    let g: Gettable<string>;
    beforeEach(function() {
        g = new Gettable<string>(getFunc);
    });

    it("Should get values", async function() {
        await expectAsync(g.get("hello")).toBeResolvedTo("hellocats");
        await expectAsync(g.get("goodbye")).toBeResolvedTo("goodbyecats");
    });

    it("Should pass along rejections", async function() {
        await expectAsync(g.get("foo")).toBeRejectedWith("got foo!");
    });
});


