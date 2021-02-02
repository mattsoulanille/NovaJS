import { NovaDataInterface } from "./NovaDataInterface";
import { NovaIDs } from "./NovaIDs";

interface GameDataInterface {
    readonly data: NovaDataInterface;
    readonly ids: Promise<NovaIDs>;
}

export { GameDataInterface };
