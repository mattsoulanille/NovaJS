import * as path from "path";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { NovaDataInterface, NovaDataType } from "novadatainterface/NovaDataInterface";
import { NovaIDs } from "novadatainterface/NovaIDs";
import { BaseData } from "novadatainterface/BaseData";
import { PictImageData } from "novadatainterface/PictImage";
import { SpriteSheetImageData, SpriteSheetFramesData, SpriteSheetData } from "novadatainterface/SpriteSheetData";
import { ExplosionData } from "novadatainterface/ExplosionData";
import { StatusBarData } from "novadatainterface/StatusBarData";
import { TargetCornersData } from "novadatainterface/TargetCornersData";
import { SystemData } from "novadatainterface/SystemData";
import { PlanetData } from "novadatainterface/PlanetData";
import { PictData } from "novadatainterface/PictData";
import { WeaponData } from "novadatainterface/WeaponData";
import { OutfitData } from "novadatainterface/OutiftData";
import { ShipData } from "novadatainterface/ShipData";
import { Gettable } from "novadatainterface/Gettable";
import { dataPath, idsPath } from "../common/GameDataPaths";



/**
 * Retrieves game data from the server
 */


class GameData implements GameDataInterface {
    public readonly data: NovaDataInterface;
    public readonly ids: Promise<NovaIDs>;

    constructor() {
        // There should be a better way to do this. I'm repeating myself here.
        this.data = {
            Ship: this.addGettable<ShipData>(NovaDataType.Ship),
            Outfit: this.addGettable<OutfitData>(NovaDataType.Outfit),
            Weapon: this.addGettable<WeaponData>(NovaDataType.Weapon),
            Pict: this.addGettable<PictData>(NovaDataType.Pict),
            PictImage: this.addPictGettable<PictImageData>(NovaDataType.PictImage),
            Planet: this.addGettable<PlanetData>(NovaDataType.Planet),
            System: this.addGettable<SystemData>(NovaDataType.System),
            TargetCorners: this.addGettable<TargetCornersData>(NovaDataType.TargetCorners),
            SpriteSheet: this.addGettable<SpriteSheetData>(NovaDataType.SpriteSheet),
            SpriteSheetImage: this.addPictGettable<SpriteSheetImageData>(NovaDataType.SpriteSheetImage),
            SpriteSheetFrames: this.addGettable<SpriteSheetFramesData>(NovaDataType.SpriteSheetFrames),
            StatusBar: this.addGettable<StatusBarData>(NovaDataType.StatusBar),
            Explosion: this.addGettable<ExplosionData>(NovaDataType.Explosion)
        };

        this.ids = this.getIds();

    }

    private async getUrl(url: string): Promise<Buffer> {
        return await new Promise(function(fulfill, reject) {
            var loader = new PIXI.loaders.Loader();
            loader.add(url, url)
                .load(function(_loader: any, resource: { [x: string]: { data: any; error: Error }; }) {
                    if (resource[url].error) {
                        reject(resource[url].error);
                    }
                    else {
                        fulfill(resource[url].data);
                    }
                });
        });

    }

    private getDataPrefix(dataType: NovaDataType): string {
        return path.join(dataPath, dataType);
    }

    private addGettable<T extends BaseData | SpriteSheetFramesData>(dataType: NovaDataType): Gettable<T> {
        var dataPrefix = this.getDataPrefix(dataType);
        return new Gettable<T>(async (id: string): Promise<T> => {
            var buffer = await this.getUrl(path.join(dataPrefix, id));
            return JSON.parse(buffer.toString('utf8'));
        });
    }

    private addPictGettable<T extends PictImageData | SpriteSheetImageData>(dataType: NovaDataType): Gettable<T> {
        var dataPrefix = this.getDataPrefix(dataType);
        return new Gettable<T>(async (id: string): Promise<T> => {
            return <T>(await this.getUrl(path.join(dataPrefix, id) + ".png"));
        });
    }

    async textureFromPict(id: string): Promise<PIXI.Texture> {
        const pictPath = path.join(dataPath, "PictImage", id + ".png");
        if (!PIXI.utils.TextureCache[pictPath]) {
            await this.getUrl(pictPath);
        }
        return PIXI.Texture.from(pictPath);
    }


    async spriteFromPict(id: string) {
        // TODO: Use this.data
        var texture = await this.textureFromPict(id);
        return new PIXI.Sprite(texture);
    }

    private async getIds(): Promise<NovaIDs> {
        // Working with PIXI is weird
        return ((await this.getUrl(idsPath + ".json")) as unknown) as NovaIDs;
        //return JSON.parse(idsBuffer.toString('utf8'));
    }
}

export { GameData }
