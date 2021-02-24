import { BaseData } from 'novadatainterface/BaseData';
import { ExplosionData } from 'novadatainterface/ExplosionData';
import { GameDataInterface } from 'novadatainterface/GameDataInterface';
import { Gettable } from 'novadatainterface/Gettable';
import { NovaDataInterface, NovaDataType } from 'novadatainterface/NovaDataInterface';
import { NovaIDs } from 'novadatainterface/NovaIDs';
import { OutfitData } from 'novadatainterface/OutiftData';
import { PictData } from 'novadatainterface/PictData';
import { PictImageData } from 'novadatainterface/PictImage';
import { PlanetData } from 'novadatainterface/PlanetData';
import { ShipData } from 'novadatainterface/ShipData';
import { SpriteSheetData, SpriteSheetFramesData, SpriteSheetImageData } from 'novadatainterface/SpriteSheetData';
import { StatusBarData } from 'novadatainterface/StatusBarData';
import { SystemData } from 'novadatainterface/SystemData';
import { TargetCornersData } from 'novadatainterface/TargetCornersData';
import { WeaponData } from 'novadatainterface/WeaponData';
import * as PIXI from 'pixi.js';
import urlJoin from 'url-join';
import { dataPath, idsPath } from '../../common/GameDataPaths';


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

    getSettings(file: string): Promise<unknown> {
        return this.getUrl(urlJoin("/settings", file));
    }

    private async getUrl(url: string): Promise<Buffer> {
        return await new Promise(function(fulfill, reject) {
            //var loader = new PIXI.loaders.Loader();
            var loader = new PIXI.Loader();
            loader.add(url, url)
                .load(function(_loader: any, resources: Partial<Record<string, PIXI.LoaderResource>>) {
                    const resource = resources[url];
                    if (resource == undefined) {
                        reject(`Resource ${url} not present on loaded url`)
                        return;
                    }
                    if (resource.error) {
                        reject(resource.error);
                    }
                    else {
                        fulfill(resource.data);
                    }
                });
        });

    }

    private getDataPrefix(dataType: NovaDataType): string {
        return urlJoin(dataPath, dataType);
    }

    private addGettable<T extends BaseData | SpriteSheetFramesData>(dataType: NovaDataType): Gettable<T> {
        var dataPrefix = this.getDataPrefix(dataType);
        return new Gettable<T>(async (id: string): Promise<T> => {
            return (await this.getUrl(urlJoin(dataPrefix, id + ".json"))) as any;
        });
    }

    private addPictGettable<T extends PictImageData | SpriteSheetImageData>(dataType: NovaDataType): Gettable<T> {
        var dataPrefix = this.getDataPrefix(dataType);
        return new Gettable<T>(async (id: string): Promise<T> => {
            return <T>(await this.getUrl(urlJoin(dataPrefix, id) + ".png"));
        });
    }

    async textureFromPict(id: string): Promise<PIXI.Texture> {
        const pictPath = urlJoin(dataPath, NovaDataType.PictImage, id + ".png");
        // if (!PIXI.utils.TextureCache[pictPath]) {
        //     await this.getUrl(pictPath);
        // }

        await this.data.PictImage.get(id);
        return PIXI.Texture.from(pictPath);
    }


    async spriteFromPict(id: string) {
        // TODO: Use this.data
        var texture = await this.textureFromPict(id);
        return new PIXI.Sprite(texture);
    }

    private async getIds(): Promise<NovaIDs> {
        return ((await this.getUrl(idsPath + ".json")) as unknown) as NovaIDs;
        //return JSON.parse(idsBuffer.toString('utf8'));
    }
}

export { GameData };
