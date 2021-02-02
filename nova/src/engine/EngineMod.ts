import { StateTreeDeclaration } from "./StateTree";
import { StateTreeMod } from "./StateTreeMod";

export interface EngineMod {
    stateTreeDeclarations?: Array<StateTreeDeclaration<any>>;
    stateTreeMods?: Array<StateTreeMod>;
} 
