import { GettableData } from "./Gettable";
import { NovaDataInterface } from "./NovaDataInterface";
import { NovaIDs } from "./NovaIDs";


export type PreloadData = {
    [K in keyof NovaDataInterface]?: {
        [index: string]: GettableData<NovaDataInterface[K]>
    }
}

interface GameDataInterface {
    readonly data: NovaDataInterface;
    readonly ids: Promise<NovaIDs>;
    readonly preloadData?: Promise<PreloadData>;
}

export { GameDataInterface };
