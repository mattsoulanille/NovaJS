import { shipTree } from "./ShipMod";
import { StateTreeDeclaration } from "./StateTree";
import { systemTree } from "./SystemMod";

export const STATE_TREE_DECLARATIONS: StateTreeDeclaration[] = [
    systemTree,
    shipTree
];
