import { BaseData } from 'nova_data_interface/BaseData';
import { CicnData } from 'nova_data_interface/CicnData';
import { CicnImageData } from 'nova_data_interface/CicnImage';
import { ExplosionData } from 'nova_data_interface/ExplosionData';
import { GameDataInterface, PreloadData } from 'nova_data_interface/GameDataInterface';
import { Gettable } from 'nova_data_interface/Gettable';
import { NovaDataInterface, NovaDataType } from 'nova_data_interface/NovaDataInterface';
import { NovaIDs } from 'nova_data_interface/NovaIDs';
import { OutfitData } from 'nova_data_interface/OutiftData';
import { PictData } from 'nova_data_interface/PictData';
import { PictImageData } from 'nova_data_interface/PictImage';
import { PlanetData } from 'nova_data_interface/PlanetData';
import { ShipData } from 'nova_data_interface/ShipData';
import { SoundFile } from 'nova_data_interface/SoundFile';
import { SpriteSheetData, SpriteSheetFramesData, SpriteSheetImageData } from 'nova_data_interface/SpriteSheetData';
import { StatusBarData } from 'nova_data_interface/StatusBarData';
import { SystemData } from 'nova_data_interface/SystemData';
import { TargetCornersData } from 'nova_data_interface/TargetCornersData';
import { WeaponData } from 'nova_data_interface/WeaponData';
import * as PIXI from 'pixi.js';
import * as sound from '@pixi/sound';
import urlJoin from 'url-join';
import { dataPath, idsPath } from '../../common/GameDataPaths';
import PQueue from 'p-queue';

class WeaponGettable extends Gettable<WeaponData> {
    async get(id: string, priority = 0) {
        if (id in this.data) {
            return await super.get(id);
        }

        const weapon = await super.get(id, priority);
        if (weapon.type === 'ProjectileWeaponData') {
            await Promise.all(weapon.submunitions.map(s => this.get(s.id, priority)));
        }
        return weapon;
    }
}

/**
 * Retrieves game data from the server
 */
export class GameData implements GameDataInterface {
    public readonly data: NovaDataInterface & {
        Sound: Gettable<sound.Sound>,
    };
    public readonly ids: Promise<NovaIDs>;
    readonly preloadData: Promise<PreloadData>;
    public loaded = Promise.resolve();
    private loadQueue = new PQueue({
        autoStart: true,
        concurrency: 16,
    });

    constructor() {
        // There should be a better way to do this. I'm repeating myself here.
        this.data = {
            Ship: this.addGettable<ShipData>(NovaDataType.Ship),
            Outfit: this.addGettable<OutfitData>(NovaDataType.Outfit),
            Weapon: this.addWeaponGettable(),
            Pict: this.addGettable<PictData>(NovaDataType.Pict),
            PictImage: this.addPictGettable<PictImageData>(NovaDataType.PictImage),
            Cicn: this.addGettable<CicnData>(NovaDataType.Cicn),
            CicnImage: this.addPictGettable<CicnImageData>(NovaDataType.CicnImage),
            Planet: this.addGettable<PlanetData>(NovaDataType.Planet),
            System: this.addGettable<SystemData>(NovaDataType.System),
            TargetCorners: this.addGettable<TargetCornersData>(NovaDataType.TargetCorners),
            SpriteSheet: this.addGettable<SpriteSheetData>(NovaDataType.SpriteSheet),
            SpriteSheetImage: this.addPictGettable<SpriteSheetImageData>(NovaDataType.SpriteSheetImage),
            SpriteSheetFrames: this.addGettable<SpriteSheetFramesData>(NovaDataType.SpriteSheetFrames),
            StatusBar: this.addGettable<StatusBarData>(NovaDataType.StatusBar),
            Explosion: this.addGettable<ExplosionData>(NovaDataType.Explosion),
            SoundFile: this.addSoundFileGettable(),
            Sound: this.addSoundGettable(),
        };

        this.preloadData = this.preload();
        this.loaded = this.preloadData.then(() => { });

        this.ids = this.getIds();
    }

    getSettings(file: string): Promise<unknown> {
        return this.getUrl(urlJoin("/settings", file));
    }

    private async preload() {
        const data = await (await fetch('/preloadData.json')).json() as PreloadData;
        for (const [uncastKey, val] of Object.entries(data)) {
            const key = uncastKey as keyof typeof data;
            this.data[key].gotten = val;
        }
        return data;
    }

    private async getUrl(url: string, priority = 0): Promise<Buffer> {
        await this.preloadData;
        const loadPromise = this.loadQueue.add(() =>
            new Promise<Buffer>(function(fulfill, reject) {
                const loader = new PIXI.Loader();
                loader.add(url, url)
                    .load(function(_loader: any, resources: Partial<Record<string, PIXI.ILoaderResource>>) {
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
            }), { priority: -priority });

        this.loaded = (async () => {
            await this.loaded;
            await loadPromise;
        })();
        return loadPromise;
    }

    private getDataPrefix(dataType: NovaDataType): string {
        return urlJoin(dataPath, dataType);
    }

    private addGettable<T extends BaseData | SpriteSheetFramesData>(dataType: NovaDataType): Gettable<T> {
        const dataPrefix = this.getDataPrefix(dataType);
        return new Gettable<T>(async (id: string, priority: number): Promise<T> => {
            return (await this.getUrl(urlJoin(dataPrefix, id + ".json"), priority)) as any;
        });
    }

    private addWeaponGettable(): WeaponGettable {
        const dataPrefix = this.getDataPrefix(NovaDataType.Weapon);
        return new WeaponGettable(async (id: string, priority: number): Promise<WeaponData> => {
            return (await this.getUrl(urlJoin(dataPrefix, id + ".json"), priority)) as any;
        });

    }

    private addPictGettable<T extends PictImageData | SpriteSheetImageData>(dataType: NovaDataType): Gettable<T> {
        var dataPrefix = this.getDataPrefix(dataType);
        return new Gettable<T>(async (id: string, priority: number): Promise<T> => {
            return <T>(await this.getUrl(urlJoin(dataPrefix, id) + ".png", priority)).buffer;
        });
    }

    private addSoundFileGettable() {
        const dataPrefix = this.getDataPrefix(NovaDataType.SoundFile);
        return new Gettable<SoundFile>(async (id: string, priority: number) => {
            //return await (await fetch(urlJoin(dataPrefix, id))).arrayBuffer();
            return (await this.getUrl(urlJoin(dataPrefix, id) + '.mp3', priority));
        });
    }

    private url(id: string): string {
        return urlJoin(dataPath, NovaDataType.PictImage, id + ".png");
    }

    textureFromPict(id: string): PIXI.Texture {
        return PIXI.Texture.from(this.url(id));
    }

    spriteFromPict(id: string) {
        return PIXI.Sprite.from(this.url(id));
    }

    async textureFromPictAsync(id: string, priority?: number) {
        const pictPath = this.url(id);
        await this.data.PictImage.get(id, priority);
        return PIXI.Texture.from(pictPath);
    }

    async spriteFromPictAsync(id: string, priority?: number) {
        // TODO: Use this.data
        var texture = await this.textureFromPictAsync(id, priority);
        return new PIXI.Sprite(texture);
    }

    async textureFromCicn(id: string): Promise<PIXI.Texture> {
        const cicnPath = urlJoin(dataPath, NovaDataType.CicnImage, id + ".png");
        await this.data.CicnImage.get(id);
        return PIXI.Texture.from(cicnPath);
    }

    private addSoundGettable() {
        const dataPrefix = this.getDataPrefix(NovaDataType.SoundFile);
        return new Gettable<sound.Sound>(async (id) => {
            const soundPath = urlJoin(dataPrefix, id) + '.mp3';
            return new Promise((fulfill, reject) => {
                sound.Sound.from({
                    url: soundPath,
                    preload: true,
                    loaded: (err, sound) => {
                        if (err || !sound) {
                            reject(err);
                            return;
                        }
                        fulfill(sound);
                    }
                });
            })
        });
    }

    private async getIds(): Promise<NovaIDs> {
        return ((await this.getUrl(idsPath + ".json")) as unknown) as NovaIDs;
        //return JSON.parse(idsBuffer.toString('utf8'));
    }
}
