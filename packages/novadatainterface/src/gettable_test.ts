import "jasmine";
import { Gettable } from "./gettable.js";
import { NovaIDNotFoundError } from "./nova_id_not_found_error.js";


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

describe("Gettable", () => {
    let g: Gettable<string>;
    let warn: (message: unknown) => void;
    beforeEach(() => {
        warn = jasmine.createSpy('warn');
        g = new Gettable<string>(getFunc, warn);
    });

    it("Should get values", async () => {
        await expectAsync(g.get("hello")).toBeResolvedTo("hellocats");
        await expectAsync(g.get("goodbye")).toBeResolvedTo("goodbyecats");
    });

    it("Should pass along rejections", async () => {
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

    it("getCached starts a background load of an uncached id", async () => {
        // Observed through the getter, not by spying on `get`: the miss
        // asks the getter once, and a later `get` reuses that load rather
        // than starting a second one.
        const getter = jasmine.createSpy("getter").and.callFake(getFunc);
        const g2 = new Gettable<string>(getter, warn);
        expect(g2.getCached("hello")).toBeUndefined();
        expect(getter).toHaveBeenCalledOnceWith("hello", 0);
        await expectAsync(g2.get("hello")).toBeResolvedTo("hellocats");
        expect(getter).toHaveBeenCalledTimes(1);
        expect(g2.getCached("hello")).toEqual("hellocats");
    });
});

describe("Gettable not-found caching", () => {
    let calls: string[];
    let g: Gettable<string>;
    let warn: jasmine.Spy;
    beforeEach(() => {
        calls = [];
        warn = jasmine.createSpy("warn");
        g = new Gettable<string>(async (id: string) => {
            calls.push(id);
            if (id === "gone") {
                throw new NovaIDNotFoundError("no " + id);
            }
            if (id === "flaky") {
                throw new Error("transport");
            }
            return id + "!";
        }, warn);
    });

    it("caches a not-found rejection instead of loading the id again", async () => {
        await expectAsync(g.get("gone")).toBeRejectedWithError(NovaIDNotFoundError);
        await expectAsync(g.get("gone")).toBeRejectedWithError(NovaIDNotFoundError, "no gone");
        expect(calls).toEqual(["gone"]);
        expect(g.isMissing("gone")).toBeTrue();
        expect(g.isMissing("hello")).toBeFalse();
    });

    it("getCached neither reloads nor re-warns a known-missing id", async () => {
        // The first miss starts the background load, as ever.
        expect(g.getCached("gone")).toBeUndefined();
        await expectAsync(g.get("gone")).toBeRejected();
        // From now on it is a cache hit on "does not exist".
        expect(g.getCached("gone")).toBeUndefined();
        expect(g.getCached("gone")).toBeUndefined();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(calls).toEqual(["gone"]);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it("does not cache other rejections, which a retry may fix", async () => {
        await expectAsync(g.get("flaky")).toBeRejectedWithError("transport");
        await expectAsync(g.get("flaky")).toBeRejectedWithError("transport");
        expect(calls).toEqual(["flaky", "flaky"]);
        expect(g.isMissing("flaky")).toBeFalse();
    });

    it("recognises a not-found error by name after it lost its class", async () => {
        // An error rebuilt across a worker boundary keeps its name only.
        const rebuilt = Object.assign(new Error("no x"), { name: "NovaIDNotFoundError" });
        const h = new Gettable<string>(async (id: string) => {
            calls.push(id);
            throw rebuilt;
        }, warn);
        await expectAsync(h.get("x")).toBeRejected();
        await expectAsync(h.get("x")).toBeRejected();
        expect(calls).toEqual(["x"]);
    });
});


