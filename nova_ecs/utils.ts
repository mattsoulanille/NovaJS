
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

function graphDiagramString<T>(graph:Map<T, Set<T>>,width=80,iters=256,dt=0.1,drag=0.5,link=0.25,repell=10,settle=1): string{
    /* produces descriptive text of the style
       1	c1
       2	root
       3	b1
       4	a1
       5	a2
       
       3>>>>>>>4                                                                      
       ^       v                                                                      
       ^       v                                                                      
       ^       v                                                                      
       ^       v                                                                      
       ^      v    <<<<<<5                                                            
       ^ >>>>>2<<<<                                                                   
       1>                      
     */
    type pt = {x:number,y:number};
    const positions:Map<T,pt> = new Map<T,pt>();
    const labels = new Map<T,number>();
    let li = 1;
    for (let [k,v] of graph.entries()){
        if (!labels.has(k)){
            labels.set(k,li++);
            positions.set(k,{x:li%width,y:li/width+Math.sin(li)})
        }
        for (let n of v){
            if (!labels.has(n)){
                labels.set(n,li++);
                positions.set(n,{x:li%width,y:li/width+Math.sin(li)})
            }
        }
    }

    let key = "";
    for (let [t,id] of labels.entries()){
        key += id+"\t"+t + "\n"; 
    }
    
    const vels:Map<T,pt> = new Map<T,pt>();
    
    function dist2(a:pt,b:pt):number{return (a.x-b.x)**2+(a.y-b.y)**2;}
    function add(a:pt,b:pt):pt{return {x:a.x+b.x,y:a.y+b.y};}
    function sub(a:pt,b:pt):pt{return {x:a.x-b.x,y:a.y-b.y};}
    function mul(s:number,a:pt):pt{return {x:a.x*s,y:a.y*s};}
    function lerp(t:number,a:pt,b:pt):pt{return {x:a.x*(1-t)+b.x*t,y:a.y*(1-t)+b.y*t};}

    const forces:Map<T,pt> = new Map<T,pt>();

    function push(p:T,f:pt){
        const f0 = forces.get(p)??{x:0,y:0};
        forces.set(p,add(f0,f));
    }
    
    function step(dt:number,drag:number,repell:number,link:number,settle:number):number{
        let pe = 0;
        forces.clear();
        for (let [k,p] of positions.entries()){
            push(k,{x:0,y:-p.y*settle});
            const l = graph.get(k);
            if (l){
                for (let n of l){
                    const p2 = positions.get(n);
                    if (p2){
                        const f = mul(-link,sub(p,p2));
                        push(k,f);
                        push(n,mul(-1,f));
                        pe += dist2(p,p2)*link;
                    }
                }
            }
            for (let [k2,p2] of positions.entries()){
                if (k != k2){
                    const d2 = dist2(p,p2);
                    const f = mul(repell,sub(p,p2));
                    push(k,mul(1/(d2+0.001),f))
                    push(k2,mul(-1/(d2+0.001),f))
                    pe += dist2(p,p2)**0.5*repell;
                }
            }
        }
        for (let [k,p] of positions.entries()){
            const f = forces.get(k)??{x:0,y:0};
            const v = vels.get(k)??{x:0,y:0};
            const np = add(p,mul(dt,add(mul(dt,f),mul(drag,v))));
            positions.set(k,{x:Math.min(width-1,Math.max(1,np.x)),y:np.y});
        }
        return pe;
    }
    for(let i = 0; i < iters; i++){
        step(dt,drag,repell,link,settle);
    }
    let minY = 1e300;
    let maxY = -1e300;
    for (let [k,p] of positions.entries()){
        minY = Math.min(p.y,minY);
        maxY = Math.max(p.y,maxY);
    }
    
    
    const diagram:String[][] = [];
    for (let i = minY; i < maxY+2; i++){
        const row = [];
        for (let j = 0; j < width; j++){
            row.push(" ");
        }
        diagram.push(row);
    }
    /*
    const screen:number[][] = [];
    for (let r of diagram){
        for (let i = 0; i < 4; i++){
            const row = [];
            for (let v of r){
                for (let j = 0; j < 2; j++){
                    row.push(0);
                }
            }
            screen.push(row);
        }
    }

    function drawLine(a:pt,b:pt){
        let localA = {x:a.x*2,y:(a.y-minY)*4};
        let localB = {x:b.x*2,y:(b.y-minY)*4};
        let p = localA;
        let dx = localB.x-localA.x;
        let dy = localB.y-localA.y;
        let step;
        if (dx == 0 && dy == 0){
            step = 1;
        }else{
            if (dx == 0){
                step = Math.abs(1/dy);
            }else{
                if (dy == 0){
                    step = Math.abs(1/dx);
                }else{
                    step = Math.min(Math.abs(1/dx),Math.abs(1/dy));
                }
            }
        }
        for (let t=0;t < 1; t += step){
            const iy = Math.floor(p.y);
            const ix = Math.floor(p.x);
            if ( 0 <= iy && iy < screen.length && 0 <= ix && ix < screen[iy].length){
                screen[iy][ix] += 1;
            }
            p.x += dx*step;
            p.y += dy*step;
        }
    }
    
    
    function plotArrow(a:pt,b:pt){
        drawLine(a,b);
        const half = lerp(0.5,a,b);
        const r90 = {x:a.y-b.y,y:b.x-a.x};
        drawLine(half,lerp(0.5,a,add(half,mul(0.2,r90))));
        drawLine(half,lerp(0.5,a,add(half,mul(-0.2,r90))));
    }
    

    for (let [k,v] of graph.entries()){
        const p1 = positions.get(k);
        if (p1){
            for (let n of v){
                const p2 = positions.get(n);
                if (p2){
                    plotArrow(p1,p2);
                }
            }
        }
    }
    //convert to braille
    function bpix(x:number,y:number):string{
        //order: ⠁⠂⠄⠈⠐⠠⡀⢀
        let px:number = 0;
        for (let [ox,oy,v] of [[0,0,1],[0,1,2],[0,2,4],[1,0,8],[1,1,16],[1,2,32],[0,3,64],[1,3,128]]){
            if (screen[y*4+oy][x*2+ox]>0){
                px += v;
            }
        }
        return String.fromCharCode(0x2800|px);
    }

    for (let y = 0; y < diagram.length; y++){
        for (let x = 0; x < width; x++){
            diagram[y][x] = bpix(x,y);
        }
    }
    */
    const screen:number[][] = [];
    for (let r of diagram){
        const row = [];
        for (let v of r){
            row.push(0);
        }
        screen.push(row);
    }
    //<^>v
    function plotArrow(a:pt,b:pt){
        let p = {x:a.x,y:a.y-minY};
        let dx = b.x-a.x;
        let dy = b.y-a.y;
        let dir;
        let step;
        if (dx == 0 && dy == 0){
            step = 1;
            dir = 0;
        }else{
            if (Math.abs(dx)>Math.abs(dy)){
                step = Math.abs(1/dx);
                dir = dx>0?4:1 
            }else{
                step = Math.abs(1/dy);
                dir = dy>0?8:2
            }
        }
        for (let t=0;t < 1; t += step){
            const iy = Math.floor(p.y);
            const ix = Math.floor(p.x);
            if ( 0 <= iy && iy < screen.length && 0 <= ix && ix < screen[iy].length){
                screen[iy][ix] |= dir;
            }
            p.x += dx*step;
            p.y += dy*step;
        }
    }
    
    
    for (let [k,v] of graph.entries()){
        const p1 = positions.get(k);
        if (p1){
            for (let n of v){
                const p2 = positions.get(n);
                if (p2){
                    plotArrow(p1,p2);
                }
            }
        }
    }
    //<^>v
    for (let y = 0; y < diagram.length; y++){
        for (let x = 0; x < width; x++){
            diagram[y][x] = " <^+>x+xv+xx+xxx"[screen[y][x]];
        }
    }
    
    for (let [k,id] of labels.entries()){
        const p = positions.get(k);
        if (p){
            let ix = Math.floor(p.x);
            const iy = Math.floor(p.y-minY);
            for (let c of ""+id){
                if (ix < width){
                    diagram[iy][ix] = c;
                }
                ix += 1;
            }
        }
    }

    let res = key+"\n";
    for (let r of diagram){
        for (let c of r){
            res += c;
        }
        res += "\n";
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
