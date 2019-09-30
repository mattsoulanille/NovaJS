import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import "mocha";
import { Comparator, makeComparator, valueComparator, combineComparators, makeRecordComparator, neverComparator, subtractFromComparator, sufficientDifferenceComparator, allOrNothingComparator } from "../../src/engine/Comparator";
import { Stateful, StateIndexer, RecursivePartial, PartialState } from "../../src/engine/Stateful";
import { fail } from "assert";

before(function() {
    chai.should();
    chai.use(chaiAsPromised);

});

type Foo = {
    a: number,
    b: string
}

type Bar = Foo & {
    c: string
}

describe("Comparator", function() {

    const FooComparator = makeComparator<Foo>({
        a: valueComparator,
        b: valueComparator
    })

    const BarSpecific = makeComparator<Bar>({
        c: valueComparator
    })
    const BarComparator = combineComparators<Bar>(FooComparator, BarSpecific);

    let f0: PartialState<Foo> = {
        b: "cat"
    }

    let f1: PartialState<Foo> = {
        a: 42,
        b: "cat"
    }

    let f2: PartialState<Foo> = {
        a: 48,
    }

    it("Should produce the correct diff when comparing", function() {

        let diff = FooComparator(f1, f2);
        diff.should.deep.equal({ a: 48 });

        diff = FooComparator(f0, f2);
        diff.should.deep.equal({ a: 48 });

        let fsame: PartialState<Foo> = {
            a: 48,
            b: "cat"
        }

        diff = FooComparator(fsame, f2);
        diff.should.deep.equal({});
    })

    it("combineComparators should work", function() {
        let b1: PartialState<Bar> = {
            a: 42,
            c: "dog"
        }

        let b2: PartialState<Bar> = {
            a: 42,
            b: "cat",
            c: "moose"
        }

        let diff = BarComparator(b1, b2);
        diff.should.deep.equal({
            b: "cat",
            c: "moose"
        });
    })

    it("makeRecordComparator should work", function() {
        const recordFooComparator = makeRecordComparator(FooComparator);
        const r1: PartialState<{ [index: string]: Foo }> = {
            a: f0,
            b: f1,
            z: f1
        }
        const r2: PartialState<{ [index: string]: Foo }> = {
            a: f0,
            b: f2,
            c: f0
        }

        const diff = recordFooComparator(r1, r2);

        diff.should.deep.equal({
            b: FooComparator(f1, f2),
            c: f0
        });
    });

    it("subtractFromComparator should work", function() {
        const subtracted = subtractFromComparator(FooComparator, new Set("a"));
        let f4: Foo = {
            a: 12,
            b: "asdf"
        }

        let f5: Foo = {
            a: 18,
            b: "yes"
        }
        subtracted(f4, f5).should.deep.equal({ b: "yes" });
    });

    it("allOrNothingComparator should work", function() {
        let allBar = allOrNothingComparator(BarComparator)
        let b1: PartialState<Bar> = {
            a: 42,
            b: "cat"
        }
        let b2: PartialState<Bar> = {
            a: 42,
            b: "dog"
        }
        allBar(b1, b2).should.deep.equal(b2);
        allBar(b1, b1).should.deep.equal({});
    });

    it("sufficientDifferenceComparator should work", function() {
        const ignoreA = sufficientDifferenceComparator(BarComparator, {
            a: function() {
                return false;
            }
        })

        let t1: PartialState<Bar> = {
            a: 42,
            b: "cat",
            c: "dog"
        }
        let t2: PartialState<Bar> = {
            a: 512,
            b: "cat"
        }

        let t3: PartialState<Bar> = {
            a: 384,
            b: "moose"
        }

        // Differences in `a` don't trigger a difference,
        // but ~do~ get reported when a difference is triggered.
        ignoreA(t1, t2).should.deep.equal({});
        ignoreA(t1, t3).should.deep.equal({
            a: 384,
            b: "moose"
        });


    });
});
