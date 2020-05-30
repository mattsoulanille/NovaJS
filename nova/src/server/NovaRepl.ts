import repl from "repl";
import { GameLoop } from "../GameLoop";
import { GameDataInterface } from "novajs/novadatainterface/GameDataInterface";
import { CommunicatorServer } from "../communication/CommunicatorServer";



export class NovaRepl {
    private repl: repl.REPLServer;
    private prompt = "nova> ";

    constructor(private gameLoop: GameLoop,
        private gameData: GameDataInterface,
        private communicator: CommunicatorServer) {

        this.repl = repl.start("nova> ");

        this.repl.context.systems = async () => {
            const systems =
                this.gameLoop.state.families.systems;

            let systemsWithShips =
                (await Promise.all([...systems].map(async ([systemId, system]) => {
                    const ships = (await Promise.all(
                        [...system.families.spaceObjects]
                            .map(async ([_, spaceObject]) => {
                                const proto = spaceObject.protobuf;
                                const id = proto.shipState?.id
                                if (id) {
                                    const ship = await this.gameData.data.Ship.get(id);
                                    return ship.name;
                                }
                                return null;
                            })))
                        .filter((maybeName): maybeName is string => maybeName !== null)
                        .reduce((ships: Map<string, number>,
                            ship: string) => {
                            if (!ships.has(ship)) {
                                ships.set(ship, 1);
                            } else {
                                ships.set(ship, ships.get(ship)! + 1);
                            }
                            return ships;
                        }, new Map());

                    return {
                        id: systemId,
                        ships: ships,
                        system
                    };
                }))).filter(({ ships }) => {
                    return ships.size > 0;
                });


            for (const { id, ships, system } of systemsWithShips) {
                console.log(`${id}:`);
                const keySet = system.families.spaceObjects.keySet?.keys;
                console.log(`  spaceObjects keySet: ${keySet}`);
                for (const [name, count] of ships) {
                    console.log(`\t ${name}: ${count}`);
                }
            }
        }

        this.repl.context.clients = () => {
            //for (const
            //communicator.clients
        }
    }
}
