import { GameData } from "../GameData";

interface IDGraphic<T> {
    new({ gameData, id }: { gameData: GameData, id: string }): T;
}

export { IDGraphic }
