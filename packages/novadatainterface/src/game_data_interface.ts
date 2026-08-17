import { ControlBitNamespaces } from "./control_bit_namespaces.js";
import { GettableData } from "./gettable.js";
import { NovaDataInterface } from "./nova_data_interface.js";
import { NovaIDs } from "./nova_ids.js";


export type PreloadData = {
    [K in keyof NovaDataInterface]?: {
        [index: string]: GettableData<NovaDataInterface[K]>
    }
}

interface GameDataInterface {
    readonly data: NovaDataInterface;
    readonly ids: Promise<NovaIDs>;
    readonly preloadData?: Promise<PreloadData>;
    /**
     * How control-bit references were namespaced per plug-in when the data
     * was parsed (see control_bit_namespaces.ts). Optional: a data source
     * that has no plug-in concept (mocks, the filesystem objects) leaves it
     * out, and consumers treat that as "no plug-ins, stock numbering".
     */
    readonly controlBitNamespaces?: Promise<ControlBitNamespaces>;
}

export { GameDataInterface };
