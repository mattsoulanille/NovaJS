import { PartialState, RecursivePartial } from "../engine/Stateful";
import { GameState } from "../engine/GameState";
import { ShipState } from "../engine/ShipState";
import { PlanetState } from "../engine/PlanetState";


// Typescript doesn't let me write RecursiveDefinite, the opposite to RecursivePartial.
// This function should really return RecursiveDefinite<O>.
function recursiveDefaultProxy<O extends object>(obj: O): O {
    return new Proxy(obj, {
        get: function(target, property, receiver) {
            let item: any;
            if (target.hasOwnProperty(property)) {
                item = Reflect.get(target, property, receiver);
                if (!(item instanceof Object)) {
                    return item;
                }
            }
            else {
                item = {};
                (target as any)[property] = item;
            }
            return recursiveDefaultProxy(item);
        }
    });
}



function filterObjectProps<O>(
    source: { [index: string]: O },
    dest: { [index: string]: O },
    allowed: Set<string>) {

    for (let [key, value] of Object.entries(source)) {
        if (allowed.has(key)) {
            dest[key] = value;
        }
    }
}

function filterUUIDs(state: PartialState<GameState>, allowedUUIDs: Set<string>): PartialState<GameState> {

    const output: PartialState<GameState> = {};
    const proxied = recursiveDefaultProxy(output) as GameState;

    if (state.systems) {
        for (let [systemUUID, system] of Object.entries(state.systems)) {
            if (system) {
                if (system.ships) {
                    filterObjectProps(
                        system.ships,
                        proxied.systems[systemUUID].ships as {
                            [index: string]: PartialState<ShipState>
                        },
                        allowedUUIDs
                    );
                }
                if (system.planets) {
                    filterObjectProps(
                        system.planets,
                        proxied.systems[systemUUID].planets as {
                            [index: string]: PartialState<PlanetState>
                        },
                        allowedUUIDs
                    );
                }
            }
        }
    }

    return output;
}

export { filterUUIDs }
