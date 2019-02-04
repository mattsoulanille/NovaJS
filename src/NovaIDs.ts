import { OutgoingMessage } from "http";
import { NovaDataType } from "./NovaDataInterface";

type NovaIDs = {
    [index in NovaDataType]: Array<string>
}

const DefaultNovaIDs: NovaIDs = {
    Explosion: [],
    Outfit: [],
    Pict: [],
    PictImage: [],
    Planet: [],
    Ship: [],
    SpriteSheet: [],
    SpriteSheetFrames: [],
    SpriteSheetImage: [],
    StatusBar: [],
    System: [],
    TargetCorners: [],
    Weapon: []
}

export { NovaIDs, DefaultNovaIDs }
