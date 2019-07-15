import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import "mocha";
import { StatefulMap } from "../../src/engine/StatefulMap";
import { Stateful, StateIndexer, PartialState } from "../../src/engine/Stateful";
import { ValuesToGetters, ValuesToSetters, getStateFromGetters, setStateFromSetters } from "../../src/engine/StateTraverser";
import { fail } from "assert";

before(function() {
    chai.should();
    chai.use(chaiAsPromised);

});


type FooState = {
    a: number,
    b: string
}
type BarState = {
    foo: FooState,
    c: number
}

type BazState = BarState & {
    foo2: FooState
}

class Foo implements Stateful<FooState> {
    public a: number
    public b: string
    public stateGetters: ValuesToGetters<FooState>;
    public stateSetters: ValuesToSetters<FooState>;
    constructor(a: number, b: string) {
        this.a = a;
        this.b = b;
        this.stateGetters = {
            a: () => this.a,
            b: () => this.b
        }
        this.stateSetters = {
            a: (newVal) => { this.a = newVal },
            b: (newVal) => { this.b = newVal }
        }
    }

    getState(toGet: StateIndexer<FooState> = {}): PartialState<FooState> {
        return getStateFromGetters<FooState>(toGet, this.stateGetters);
    }

    setState(state: PartialState<FooState>): StateIndexer<FooState> {
        return setStateFromSetters<FooState>(state, this.stateSetters);
    }
}

class Bar implements Stateful<BarState> {
    public foo: Foo;
    public c: number;
    constructor() {
        this.foo = new Foo(123, "abc");
        this.c = 0;
    }

    getState(toGet: StateIndexer<BarState> = {}): PartialState<BarState> {
        return getStateFromGetters<BarState>(toGet, {
            foo: (toGet) => this.foo.getState(toGet),
            c: () => this.c
        });
    }

    setState(state: PartialState<BarState>): StateIndexer<BarState> {
        return setStateFromSetters<BarState>(state, {
            foo: (state) => this.foo.setState(state),
            c: (newVal) => { this.c = newVal }
        });
    }
}

class Baz extends Bar implements Stateful<BazState> {
    public foo2: Foo;
    constructor() {
        super();
        this.foo2 = new Foo(42, "the answer");
    }

    getState(toGet: StateIndexer<BazState> = {}): PartialState<BazState> {
        return {
            ...super.getState(toGet),
            ...getStateFromGetters(toGet, {
                foo2: (g) => this.foo2.getState(g)
            })
        };
    }
    setState(state: PartialState<BazState>): StateIndexer<BazState> {
        return {
            ...super.setState(state),
            ...setStateFromSetters<BazState>(state, {
                foo2: (s) => this.foo2.setState(s)
            })
        }
    }
}


describe("StateTraverser", function() {

    const baz = new Baz();

    it("Should get the complete state", function() {
        baz.getState().should.deep.equal({
            foo: { a: 123, b: 'abc' },
            c: 0,
            foo2: { a: 42, b: 'the answer' }
        });
    });

    it("Should get a partial state", function() {
        const stateIndex: StateIndexer<BazState> = {
            c: {},
            foo: {}
        };

        baz.getState(stateIndex).should.deep.equal({
            c: 0,
            foo: { a: 123, b: 'abc' }
        });
    });

    it("Should set the complete state", function() {
        baz.setState({
            c: 11,
            foo: {
                a: 100,
                b: "one hundred"
            }
        }).should.deep.equal({});

        baz.getState().should.deep.equal({}); // TODO

    });



});
