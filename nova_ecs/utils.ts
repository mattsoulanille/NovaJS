
import { UnknownComponent } from "./component";
import { Sortable } from "./system";

export interface WithComponents {
    components: ReadonlyMap<UnknownComponent, unknown>;
}

export class DuplicateNameError extends Error {}

export class GraphCycleError extends Error {}

export function topologicalSortList(list: Sortable[]): Sortable[] {
    // Construct a graph with no edges.
    const graph = new Map<Sortable, Set<Sortable>>(
        list.map(val => [val, new Set()]));

    // Create a map to look up edges by reference or by name.
    const entries = new Map<Sortable | string, Sortable>(
        [...[...graph.keys()].map(key => [key, key] as const)]);

    // Add all edges to the graph. Store directed edges from node A to B on node B.
    // Include the sortable itself and its name as mapping to the sortable
    for (const [sortable, incomingEdges] of graph) {
        // Add incoming edges to sortables that this sortable runs before.
        for (const before of sortable.before) {
            const beforeSortable = entries.get(before);
            if (beforeSortable) {
                const incomingBeforeEdges = graph.get(beforeSortable);
                // Ignore if the referenced node is not present in the graph.
                // This is fine because if it's not in the graph, then we can't
                // accidentally violate one of its order requirements.
                incomingBeforeEdges?.add(sortable)
            }
        }

        // Add incoming edges to this sortable from the sortables that it runs after.
        for (const after of sortable.after) {
            const afterSortable = entries.get(after);
            if (afterSortable) {
                incomingEdges.add(afterSortable);
            }
        }
    }

    return topologicalSort(graph);
}

/**
 * Topologically sort a directed graph stored as a map from nodes to incoming edges.
 */
export function topologicalSort<T>(graph: Map<T, Set<T>>): T[] {
    if (graph.size == 0){
        return [];
    }
    const domain = new Set<T>(graph.keys());
    const nonleafs = new Set<T>();
    const placed = new Set<T>();
    const remaining = new Set<T>();
    const result:T[] = [];
    for (let [k,v] of graph.entries()){
        if (setDifference(setIntersection(v,domain),placed).size == 0){
            result.push(k);
            placed.add(k);
        }else{
            remaining.add(k);
        }
        for (let n of v){
            if (domain.has(n)){
                nonleafs.add(n)
            }
        }
    }
    if (result.length == 0){
        const cyclicPart = trimToCyclic(graph);
        throw new GraphCycleError("Graph has no roots (contains cycles)\n"+graphListString(cyclicPart));
    }
    if (remaining.size == 0){
        return result;
    }
    //find start set for depth-first-search 
    const leafs = new Set<T>();
    for (let n of remaining){
        if (!nonleafs.has(n)){
            leafs.add(n);
        }
    }
    if (leafs.size == 0){
        const cyclicPart = trimToCyclic(graph);
        throw new GraphCycleError("Graph has no antiroots (contains cycles)\n"+graphListString(cyclicPart));
    }
    function dfs(c:Set<T>,ancestors:Set<T>){
        for (let n of c) {
            if (domain.has(n)){
                if (ancestors.has(n)){
                    const cyclicPart = trimToCyclic(graph);
                    throw new GraphCycleError("Graph contains cycle\n"+graphListString(cyclicPart));
                }
                ancestors.add(n);
                const next = graph.get(n);
                if (next) {
                    dfs(setDifference(next,placed),ancestors);
                }
                ancestors.delete(n);
                result.push(n);
                placed.add(n);
            }
        }
    }
    dfs(leafs,new Set<T>());
    return result;
}

function graphListString<T>(graph:Map<T, Set<T>>):string{
    /* produces descriptive text of the style:
        ┌─c1
        │ b1
        │ a1
       ┌└>root
       │
       └──a2
    */
    const listing:T[] = [];
    const indices = new Map<T,number>();
    const seen = new Set<T>();
    for (let k of graph.keys()){
        if (seen.has(k)){
            continue;
        }
        do {
            seen.add(k);
            indices.set(k,listing.length);
            listing.push(k);
            k = setDifference(graph.get(k)??new Set<T>(),seen).keys().next().value;
        } while (k)
    }

    //"│├└┌┼╂┃┠┏┗┞┟↳↱→←"
    //"│├└┌┼"
    const cols:string[][] = [];
    for (let l of listing){
        const n = graph.get(l);
        const li = indices.get(l);
        if (n && (li !== undefined) && n.size > Number(Boolean(listing[li+1] && n.has(listing[li+1])))){
            const col:string[] = [];
            let minI = li;
            let maxI = li;
            for (let other of n){
                const i = indices.get(other);
                if (i !== undefined){
                    minI = Math.min(i,minI);
                    maxI = Math.max(i,maxI);
                }
            }
            for (let i = 0; i < listing.length; i++){
                const a = "  ┌┌│├└└  "[(Number(i >= minI) + Number(i > minI) + Number(i >= maxI) + Number(i > maxI))*2+Number(n.has(listing[i]) && i != li+1)]
                const b = " ><x"[Number(n.has(listing[i]) && i != li+1)+2*Number(i==li)]
                col.push(a+b);
            }
            cols.push(col);
        }
    }
    let res = "";
    for (let i = 0; i < listing.length; i++){
        let line = "";
        const l = listing[i];
        const n = graph.get(l);
        if (!(n && n.has(listing[i+1]))){
            line = "\x1b[4m";
        }
        for (let j = 0; j < cols.length; j++){
            line += cols[j][i];
        }
        res += "\n"+line + l + "\x1b[m";
    }
    return res;
}

function trimToCyclic<T>(graph: Map<T, Set<T>>): Map<T, Set<T>>{
    const trimmed = new Map<T,Set<T>>();
    const reverse = new Map<T,Set<T>>();
    const domain = new Set<T>(graph.keys());
    
    for (let [k,v] of graph.entries()){
        trimmed.set(k,setIntersection(v,domain));
        for (let n of v){
            if (domain.has(n)){
                if (!reverse.has(n)){
                    reverse.set(n,new Set<T>);
                }
                reverse.get(n)?.add(k);
            }
        }
    }

    const ends = setDifference(domain,new Set<T>(reverse.keys()));
    for (let [k,v] of trimmed.entries()){
        if (v.size == 0){
            ends.add(k);
        }
    }

    while (ends.size > 0){
        let changed = new Set<T>();
        for (let e of ends){
            domain.delete(e);
            const a = reverse.get(e) ?? new Set<T>();
            const b = trimmed.get(e) ?? new Set<T>();
            changed = setUnion(changed,setUnion(a,b));
            reverse.delete(e);
            trimmed.delete(e);
        }
        ends.clear();
        for (let n of changed){
            const a = trimmed.get(n);
            if (a){
                const r = setIntersection(a,domain);
                trimmed.set(n,r)
                if (r.size == 0){
                    ends.add(n)
                }
            }
            const b = reverse.get(n);
            if (b){
                const r = setIntersection(b,domain);
                reverse.set(n,r)
                if (r.size == 0){
                    ends.add(n)
                }
            }
        }
        
    }
    
    return trimmed;
}


// Returns true if a is a subset of b
export function subset(a: ReadonlySet<unknown>, b: ReadonlySet<unknown>) {
    if (a === b) {
        return true;
    }

    if (a.size > b.size) {
        return false;
    }

    for (const element of a) {
        if (!b.has(element)) {
            return false;
        }
    }
    return true;
}



export function setEqual(a: ReadonlySet<unknown>, b: ReadonlySet<unknown>) {
    return a === b || a.size === b.size && subset(a, b) && subset(b, a);
}

export function filterSet<T>(a: ReadonlySet<T>, f: (x: T) => boolean): Set<T> {
    return new Set([...a].filter(f));
}

export function setUnion<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): Set<T> {
    return new Set<T>([...a,...b]);
}

// All elements of a that are not in b
export function setDifference<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): Set<T> {
    return filterSet(a, function(x) {
        return !b.has(x);
    });
}

// All elements of a that are also in b
export function setIntersection<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): Set<T> {
    return filterSet(a, function(x) {
        return b.has(x);
    });
}

export class DefaultMap<K, V> extends Map<K, V> {
    constructor(private factory: (key: K) => V, entries: Iterable<readonly [K, V]> = []) {
        super(entries);
    }

    override get(key: K): V {
        if (!super.has(key)) {
            super.set(key, this.factory(key));
        }
        return super.get(key)!;
    }
}

export function isPromise(p: unknown): p is Promise<unknown> {
    return typeof p !== 'undefined'
        && typeof (p as any).then === 'function';
}
