import "jasmine";
import { Gettable } from "./Gettable";


function getFunc(id: string) {
    return new Promise<string>(function(fulfill, reject) {
        if (id != "foo") {
            fulfill(id + "cats");
        }
        else {
            reject(new Error("got foo!"));
        }
    });
}

describe("Gettable", function() {
    let g: Gettable<string>;
    let warn: (message: unknown) => void;
    beforeEach(function() {
        warn = jasmine.createSpy('warn');
        g = new Gettable<string>(getFunc, warn);
    });

    it("Should get values", async function() {
        await expectAsync(g.get("hello")).toBeResolvedTo("hellocats");
        await expectAsync(g.get("goodbye")).toBeResolvedTo("goodbyecats");
    });

    it("Should pass along rejections", async function() {
        await expectAsync(g.get("foo")).toBeRejectedWith(new Error("got foo!"));
    });

    it("getCached fails if not cached", () => {
        expect(g.getCached("hello")).toBeUndefined();
    });

    it("getCached fails if an error occurs in the getter", async () => {
        expect(g.getCached("foo")).toBeUndefined();
        await expectAsync(g.get("foo")).toBeRejectedWith(new Error("got foo!"));
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it("getOrFail gets cached resources", async () => {
        await expectAsync(g.get("hello")).toBeResolvedTo("hellocats");
        expect(g.getCached("hello")).toEqual("hellocats");
    });

    it("getOrFail requests the resource if not cached", async () => {
        // TODO: This test is flaky and implementation-dependant
        const spy = spyOn(g, "get");
        spy.and.callThrough();
        expect(g.getCached("hello")).toBeUndefined();
        expect(spy).toHaveBeenCalledWith("hello");
    });
});


