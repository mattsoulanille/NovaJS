import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import "mocha";
import { Comparator, makeComparator, valueComparator, combineComparators } from "../../src/engine/Comparator";
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

    it("Should produce the correct diff when comparing", function() {
        let f1: PartialState<Foo> = {
            a: 42,
            b: "cat"
        }

        let f2: PartialState<Foo> = {
            a: 48,
        }

        let diff = FooComparator(f1, f2);
        diff.should.deep.equal({ a: 48 });


        let f0: PartialState<Foo> = {
            b: "cat"
        }

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

});
