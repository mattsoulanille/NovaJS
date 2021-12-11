import { Texture } from "@pixi/core";
import { FrameInfo } from "novadatainterface/SpriteSheetData";

export function texturesFromFrames(frames: { [index: string]: FrameInfo }) {
    const allTextures: Texture[] = [];
    const frameNames = Object.keys(frames);
    for (let frameIndex = 0; frameIndex < frameNames.length; frameIndex++) {
        let frameName = frameNames[frameIndex];
        // PIXI itself requests the texture image from the server.
        allTextures[frameIndex] = Texture.from(frameName);
    }
    return allTextures;
}
