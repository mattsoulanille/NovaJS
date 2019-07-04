import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import "mocha";
import { StatefulMap } from "../../src/engine/StatefulMap";
import { Stateful, StateIndexer } from "../../src/engine/Stateful";
import { fail } from "assert";

before(function() {
    chai.should();
    chai.use(chaiAsPromised);

});

type TestState = Array<string>

class TestObject implements Stateful<TestState> {
    private state: TestState

    constructor(items: Array<string>) {
        this.state = items;
    }

    getState(_missing?: StateIndexer<TestState>): TestState {
        return this.state;

    }

    setState(state: TestState): StateIndexer<TestState> {
        this.state = state;
        return {}
    }


}


const expect = chai.expect;

describe("StatefulMap", function() {

    const animalsObject = new TestObject(["cat", "dog", "moose"]);
    const plantsObject = new TestObject(["rose", "sunflower"]);
    const rocksObject = new TestObject(["basalt", "granite"]);


    const thingsMap = new StatefulMap<TestObject, TestState>([
        ["animals", animalsObject],
        ["plants", plantsObject],
        ["rocks", rocksObject]]);

    const goodIdeas = new TestObject(["Comment your code"])
    const badIdeas = new TestObject(["don't use git"])

    const ideasMap = new StatefulMap<TestObject, TestState>();
    ideasMap.set("good", goodIdeas);
    ideasMap.set("bad", badIdeas);

    const everythingMap = new StatefulMap<StatefulMap<TestObject, TestState>, { [index: string]: TestState }>([["things", thingsMap], ["ideas", ideasMap]]);

    it("Should get the state", function() {
        thingsMap.getState().should.deep.equal({
            animals: animalsObject.getState(),
            plants: plantsObject.getState(),
            rocks: rocksObject.getState()
        });

        everythingMap.getState().should.deep.equal({
            things: thingsMap.getState(),
            ideas: ideasMap.getState()
        })
    });

    it("Should ask for missing entries when setting state", function() {
        var state = everythingMap.getState();
        let things = state["things"];
        if (things == undefined) {
            expect.fail();
        }
        else {
            things["animals"] = ["cow"];
            things["food"] = ["bread", "rice"];
            var missing = everythingMap.setState(state);


            things = everythingMap.getState()["things"]
            if (things == undefined) {
                expect.fail()
            }
            else {
                let animals = things["animals"];
                if (animals == undefined) {
                    expect.fail()
                }
                else {
                    animals.should.deep.equal(["cow"]);
                }
            }

            missing.should.deep.equal({
                things: {
                    food: {}
                }
            });
        }
    });

    it("Should provide specific entries upon request", function() {
        thingsMap.getState({ rocks: {} }).should.deep.equal(
            {
                rocks: ["basalt", "granite"]
            });

        everythingMap.getState({
            things: {
                rocks: {}
            },
            ideas: {}
        }).should.deep.equal({
            things: {
                rocks: ["basalt", "granite"]
            },
            ideas: {
                good: ["Comment your code"],
                bad: ["don't use git"]
            }
        })
    });

});





