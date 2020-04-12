import "jasmine";
import * as jspb from "google-protobuf";
import { StatefulMap, MapState } from "novajs/nova/src/engine/StatefulMap";
import { Stateful } from "novajs/nova/src/engine/Stateful";
import { MapKeys } from "novajs/nova/src/proto/map_keys_pb";
import { take } from "rxjs/operators";


interface FooState {
    val: string
}

class Foo implements Stateful<FooState> {
    // not 'val' because I don't want Foo
    // to accidentally implement FooState
    constructor(public value = "") { }

    getState(): FooState {
        return { val: this.value };
    }

    setState(state: FooState): void {
        this.value = state.val;
    }
}

function fooFactory() {
    return new Foo();
}


describe("StatefulMap", function() {

    let warn: jasmine.Spy<(msg: string) => void>;

    function makeTestMap() {
        warn = jasmine.createSpy("warnSpy");
        const map = new StatefulMap<Foo, FooState>(fooFactory, warn);
        map.set("one", new Foo("oneFoo"));
        map.set("two", new Foo("twoFoo"));
        map.set("three", new Foo("threeFoo"));
        return map;
    }

    function makeTestKeysList() {
        const testKeys = new MapKeys();
        const keySet = new MapKeys.KeySet();
        keySet.setKeyList(["one", "two", "three"]);
        testKeys.setKeyset(keySet);
        return testKeys;
    }

    function makeTestState() {
        const testKeys = makeTestKeysList();
        const testState: MapState<FooState> = {
            map: new jspb.Map<string, FooState>([
                ["one", { val: "oneFoo" }],
                ["two", { val: "twoFoo" }],
                ["three", { val: "threeFoo" }],
            ]),
            mapKeys: testKeys
        }
        return testState;
    }

    it("should be instantiated", () => {
        const map = new StatefulMap(fooFactory);
        expect(map).toBeDefined();
    });

    it("should be a map", () => {
        const map = new StatefulMap(fooFactory);
        expect(map instanceof Map).toBe(true);
    });

    it("getState retrieves the map's state", () => {
        const map = makeTestMap();
        const expectedState = makeTestState();

        expect(map.getState()).toEqual(expectedState);
    });

    it("setState sets each object's state", () => {
        const map = makeTestMap();
        const newState = makeTestState();
        newState.map.get("one")!.val = "a new value";

        // Doesn't have to provide a state for each object
        newState.map.del("three");

        map.setState(newState);

        expect(map.get("one")!.value).toEqual("a new value");
        expect(map.get("two")!.value).toEqual("twoFoo");
        expect(map.get("three")!.value).toEqual("threeFoo");
    });

    it("setState removes objects not in the keys list", () => {
        const map = makeTestMap();
        const newState = makeTestState();
        const keySet = newState.mapKeys.getKeyset()!;
        keySet.setKeyList(["one", "three"]);

        // Even though the map does not have the key "one",
        // the keySet does, so it should not be removed.
        newState.map.del("one");
        newState.map.del("two");

        map.setState(newState);

        expect(map.get("one")!.value).toEqual("oneFoo");
        expect(map.get("two")).toBeUndefined();
        expect(map.get("three")!.value).toEqual("threeFoo");
    });

    it("setState adds new objects in the keys list", () => {
        const map = makeTestMap();
        const newState = makeTestState();
        const keySet = newState.mapKeys.getKeyset()!;
        keySet.setKeyList(["one", "two", "three", "four"]);
        newState.map.set("four", { val: "fourFoo" });

        // Even though the map does not have the key "one",
        // the keySet does, so it should not be removed.
        newState.map.del("one");
        newState.map.del("two");

        map.setState(newState);

        expect(map.get("one")!.value).toEqual("oneFoo");
        expect(map.get("two")!.value).toEqual("twoFoo");
        expect(map.get("three")!.value).toEqual("threeFoo");
        expect(map.get("four")!.value).toEqual("fourFoo");
    });

    it("setState applies a key delta", () => {
        const map = makeTestMap();
        const newState = makeTestState();
        newState.mapKeys.clearKeyset();
        const delta = new MapKeys.KeyDelta();
        delta.setAddList(["four"]);
        newState.map.set("four", { val: "fourFoo" });
        delta.setRemoveList(["two"]);
        newState.map.del("two");
        newState.mapKeys.setKeydelta(delta);

        map.setState(newState);

        expect(map.get("one")!.value).toEqual("oneFoo");
        expect(map.get("two")).toBeUndefined();
        expect(map.get("three")!.value).toEqual("threeFoo");
        expect(map.get("four")!.value).toEqual("fourFoo");
    });

    it("setState warns if a key to be removed has a state", () => {
        const map = makeTestMap();
        const newState = makeTestState();
        const keySet = newState.mapKeys.getKeyset()!;
        keySet.setKeyList(["one", "three"]);

        map.setState(newState);

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.calls.mostRecent().args[0])
            .toMatch("given state with key 'two' but that key is being removed");
    });

    it("setState emits desync when state has an unknown key", async () => {
        const map = makeTestMap();
        const newState = makeTestState();
        newState.map.set("unknownKey", { val: "asdf" });

        const desyncPromise = map.desync.pipe(take(1)).toPromise();
        map.setState(newState);
        const desync = await desyncPromise;

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.calls.mostRecent().args[0])
            .toMatch("Missing key 'unknownKey'");
        expect(desync).toEqual("unknownKey");
    });
});
