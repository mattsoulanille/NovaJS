import { NovaDataType } from "novadatainterface/NovaDataInterface";
import { EngineMod } from "./EngineMod";
import { StateTreeDeclaration } from "./StateTree";

export const systemTree: StateTreeDeclaration<NovaDataType.System> = {
    name: 'System',
    dataType: NovaDataType.System,
    mods: new Set(),
}

export const systemMod: EngineMod = {
    stateTreeDeclarations: [systemTree]
}
