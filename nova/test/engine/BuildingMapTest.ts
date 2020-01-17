import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import "mocha";
import { BuildingMap } from "../../src/engine/BuildingMap";
import { Stateful, StateIndexer, RecursivePartial } from "../../src/engine/Stateful";
import { fail } from "assert";

before(function() {
    chai.should();
    chai.use(chaiAsPromised);

});

const expect = chai.expect;


import * as t from "io-ts";
import { ObjectOf } from "../../src/engine/StatefulMap";
import { isRight } from "fp-ts/lib/Either";

const SimpleState = t.type({
    catCount: t.number,
    dogName: t.string
});

type SimpleState = t.TypeOf<typeof SimpleState>;

class SimpleClass implements Stateful<SimpleState> {
    catCount: number;
    dogName: string;

    constructor(catCount: number, dogName: string) {
        this.catCount = catCount;
        this.dogName = dogName;
    }

    getState(toGet: StateIndexer<SimpleState> = { catCount: {}, dogName: {} }): RecursivePartial<SimpleState> {
        let state: RecursivePartial<SimpleState> = {};
        if (toGet.catCount) {
            state.catCount = this.catCount;
        }
        if (toGet.dogName) {
            state.dogName = this.dogName;
        }
        return state;
    }

    setState(state: RecursivePartial<SimpleState>): StateIndexer<SimpleState> {
        let index: StateIndexer<SimpleState> = {};
        if (state.catCount !== undefined) {
            this.catCount = state.catCount;
        }
        else {
            index.catCount = {};
        }

        if (state.dogName !== undefined) {
            this.dogName = state.dogName;
        }
        else {
            index.dogName = {};
        }
        return index;
    }
}

function buildFromState(state: SimpleState): SimpleClass {
    return new SimpleClass(state.catCount, state.dogName);
}
function getFullState(partial: RecursivePartial<SimpleState>): SimpleState | undefined {
    const decoded = SimpleState.decode(partial);
    if (isRight(decoded)) {
        return decoded.right;
    }
    return undefined;
}

describe("BuildingMap", function() {
    const simpleMap: BuildingMap<SimpleClass, SimpleState>
        = new BuildingMap(buildFromState, getFullState);

    it("Should build any missing entries when given their complete states", function() {

        const state: RecursivePartial<ObjectOf<SimpleState>> = {
            complete1: {
                catCount: 4,
                dogName: "Fred"
            },
            incomplete1: {
                catCount: 2
            },
            complete2: {
                catCount: 11,
                dogName: "George"
            },
            incomplete2: {
                dogName: "Bob"
            }
        };

        simpleMap.setState(state);

        const resultState = simpleMap.getState();

        resultState.should.deep.equal({
            complete1: state.complete1,
            complete2: state.complete2
        });
    });

});
