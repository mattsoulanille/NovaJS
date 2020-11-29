import { DisplayMod } from "./display/DisplayMod";
import { EngineMod } from "./engine/EngineMod";

export interface Mod {
    engineMod?: EngineMod,
    displayMod?: DisplayMod,
}
