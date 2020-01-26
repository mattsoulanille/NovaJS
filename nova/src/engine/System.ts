import { GameDataInterface } from "../../../novadatainterface/GameDataInterface";
import { BuildingMap } from "./BuildingMap";
import { Planet } from "./Planet";
import { PlanetState } from "./PlanetState";
import { Ship } from "./Ship";
import { ShipState } from "./ShipState";
import { RecursivePartial, Stateful, StateIndexer } from "./Stateful";
import { getStateFromGetters, setStateFromSetters } from "./StateTraverser";
import { Steppable } from "./Steppable";
import { SystemState } from "./SystemState";
import UUID from "uuid/v4";
import { isRight, isLeft } from "fp-ts/lib/Either";
import { SystemState as SystemStateProto } from "novajs/nova/src/proto/system_state_pb";


class System implements Stateful<SystemState>, Steppable {
    readonly ships: BuildingMap<Ship, ShipState>;
    readonly planets: BuildingMap<Planet, PlanetState>;
    private gameData: GameDataInterface;
    //    readonly uuid: string;

    constructor({ gameData, state }: { gameData: GameDataInterface, state: SystemState }) {
        //        this.uuid = state.uuid;
        this.gameData = gameData;

        this.ships = new BuildingMap<Ship, ShipState>(
            Ship.makeFactory(this.gameData),
            Ship.fullState
        );

        this.planets = new BuildingMap<Planet, PlanetState>(
            Planet.makeFactory(this.gameData),
            Planet.fullState
        );

        this.setState(state);
    }

    step(milliseconds: number): void {
        this.ships.forEach((ship) => ship.step(milliseconds));
    }

    getProto() {
        const proto = new SystemStateProto();
        const shipsMap = proto.getShipsMap();
        for (const [id, ship] of this.ships) {
            shipsMap.set(id, ship.getProto());
        }

        const planetsMap = proto.getPlanetsMap();
        for (const [id, planet] of this.planets) {
            planetsMap.set(id, planet.getProto());
        }
        return proto;
    }

    addRandomShip() {
        const uuid = UUID();
        const idNumber = Math.floor(Math.random() * 50) + 128;
        const idString = `nova:${idNumber}`;
        const x = (Math.random() - 0.5) * 500;
        const y = (Math.random() - 0.5) * 500;
        const shipState: ShipState = {
            accelerating: 0,
            acceleration: 0,
            id: idString,
            maxVelocity: 0,
            movementType: "inertial",
            position: { x, y },
            rotation: Math.random() * 2 * Math.PI,
            turnBack: false,
            turning: 0,
            turnRate: 0,
            velocity: { x: 0, y: 0 }
        }

        this.setState({
            ships: {
                [uuid]: shipState
            }
        });
        return uuid;
    }

    getState(toGet: StateIndexer<SystemState> = {}): RecursivePartial<SystemState> {

        return getStateFromGetters<SystemState>(toGet, {
            planets: (toGet) => this.planets.getState(toGet),
            ships: (ships) => this.ships.getState(ships),
            //            uuid: () => this.uuid
        });
    }

    setState(state: Partial<SystemState>): StateIndexer<SystemState> {

        return setStateFromSetters<SystemState>(state, {
            planets: (planetStates) => this.planets.setState(planetStates),
            ships: (shipStates) => this.ships.setState(shipStates)
        });
    }

    getFullState(): SystemState {
        const proto = this.getProto();
        var state = this.getState({});
        var decoded = SystemState.decode(state);
        if (isLeft(decoded)) {
            throw decoded.left;
        }
        else {
            return decoded.right;
        }
    }

    static async fromID(id: string, gameData: GameDataInterface, makeUUID: () => string = UUID): Promise<SystemState> {

        const planets: { [index: string]: PlanetState } = {};
        const data = await gameData.data.System.get(id);

        // Make sure the UUIDs match up with the
        // server if you call this on the client!
        for (let planetID of data.planets) {
            planets[makeUUID()] = await Planet.fromID(planetID, gameData);
        }

        return {
            ships: {},
            planets: planets,
        }
    }

    static makeFactory(gameData: GameDataInterface): (s: SystemState) => System {
        return function(state: SystemState) {
            return new System({ gameData, state });
        }
    }


    static fullState(maybeState: RecursivePartial<SystemState>): SystemState | undefined {
        let decoded = SystemState.decode(maybeState)
        if (isRight(decoded)) {
            return decoded.right;
        }
        else {
            return undefined;
        }
    }



}

export { System }
