import { CicnData } from 'novadatainterface/cicn_data';
import { CicnImageData } from 'novadatainterface/cicn_image';
import { ExplosionData } from 'novadatainterface/explosion_data';
import { Gettable } from 'novadatainterface/gettable';
import { NovaDataType, NovaDataInterface } from 'novadatainterface/nova_data_interface';
import { PictData } from 'novadatainterface/pict_data';
import { PictImageData } from 'novadatainterface/pict_image';
import { PpatImageData } from 'novadatainterface/ppat_image';
import { SoundFile } from 'novadatainterface/sound_file';
import { SpriteSheetFramesData, SpriteSheetImageData } from 'novadatainterface/sprite_sheet_data';
import { StatusBarData } from 'novadatainterface/status_bar_data';
import { StringTableData } from 'novadatainterface/string_table_data';
import { DescriptionData } from 'novadatainterface/description_data';
import { InterfaceColorsData } from 'novadatainterface/interface_colors_data';
import { TargetCornersData } from 'novadatainterface/target_corners_data';
import * as PIXI from 'pixi.js';
import * as sound from '@pixi/sound';
import urlJoin from 'url-join';
import { dataPath } from '../../common/game_data_paths.js';

/**
 * `snd ` resources are served as RIFF/WAVE at their original sample rate —
 * see novaparse's sound_file_parse.ts for why they are no longer MP3. The
 * server's data route matches on this extension too (setup_routes.ts).
 */
export const SOUND_EXTENSION = '.wav';

export type DisplayAssetDataResources = Pick<NovaDataInterface,
    'Pict' | 'PictImage' | 'Cicn' | 'CicnImage' | 'PpatImage' |
    'TargetCorners' | 'SpriteSheetImage' | 'SpriteSheetFrames' |
    'StatusBar' | 'Explosion' | 'SoundFile' |
    'StringTable' | 'Description' | 'InterfaceColors'
> & {
    Sound: Gettable<sound.Sound>,
};

export interface DisplayAssetDataInterface {
    readonly data: DisplayAssetDataResources;
    textureFromPict(id: string): PIXI.Texture;
    spriteFromPict(id: string): PIXI.Sprite;
    textureFromPictAsync(id: string, priority?: number): Promise<PIXI.Texture>;
    spriteFromPictAsync(id: string, priority?: number): Promise<PIXI.Sprite>;
    textureFromCicn(id: string): Promise<PIXI.Texture>;
    textureFromPpat(id: string): Promise<PIXI.Texture>;
}

export class DisplayAssetData implements DisplayAssetDataInterface {
    public readonly data: DisplayAssetDataResources;

    constructor() {
        this.data = {
            Pict: this.addStructuredGettable<PictData>(NovaDataType.Pict),
            PictImage: this.addBinaryGettable<PictImageData>(NovaDataType.PictImage, '.png'),
            Cicn: this.addStructuredGettable<CicnData>(NovaDataType.Cicn),
            CicnImage: this.addBinaryGettable<CicnImageData>(NovaDataType.CicnImage, '.png'),
            PpatImage: this.addBinaryGettable<PpatImageData>(NovaDataType.PpatImage, '.png'),
            TargetCorners: this.addStructuredGettable<TargetCornersData>(NovaDataType.TargetCorners),
            SpriteSheetImage: this.addBinaryGettable<SpriteSheetImageData>(NovaDataType.SpriteSheetImage, '.png'),
            SpriteSheetFrames: this.addFramesGettable<SpriteSheetFramesData>(NovaDataType.SpriteSheetFrames),
            StatusBar: this.addStructuredGettable<StatusBarData>(NovaDataType.StatusBar),
            Explosion: this.addStructuredGettable<ExplosionData>(NovaDataType.Explosion),
            SoundFile: this.addBinaryGettable<SoundFile>(NovaDataType.SoundFile, SOUND_EXTENSION),
            StringTable: this.addStructuredGettable<StringTableData>(NovaDataType.StringTable),
            Description: this.addStructuredGettable<DescriptionData>(NovaDataType.Description),
            InterfaceColors: this.addStructuredGettable<InterfaceColorsData>(NovaDataType.InterfaceColors),
            Sound: this.addSoundGettable(),
        };
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
        const texture = await this.textureFromPictAsync(id, priority);
        return new PIXI.Sprite(texture);
    }

    /**
     * Loads a PICT into PIXI's texture cache under the URL spriteFromPict /
     * textureFromPict read, so a later sprite of it is drawn the frame it
     * is made — the landed-UI prefetch (client/landed_ui_prefetch.ts) warms
     * the spaceport's art through this. Resolves once the image is loaded.
     * A failed load is dropped from the cache again, so a later
     * spriteFromPict retries instead of inheriting the failure.
     */
    prefetchPict(id: string): Promise<void> {
        const url = this.url(id);
        const texture = PIXI.Texture.from(url);
        const base = texture.baseTexture;
        if (base.valid) {
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            const loaded = () => {
                base.off('error', failed);
                resolve();
            };
            const failed = (error: unknown) => {
                base.off('loaded', loaded);
                PIXI.Texture.removeFromCache(texture);
                PIXI.BaseTexture.removeFromCache(base);
                reject(new Error(`PICT ${id} failed to load: ${String(error)}`));
            };
            base.once('loaded', loaded);
            base.once('error', failed);
        });
    }

    async textureFromCicn(id: string): Promise<PIXI.Texture> {
        const cicnPath = urlJoin(dataPath, NovaDataType.CicnImage, id + '.png');
        await this.data.CicnImage.get(id);
        return PIXI.Texture.from(cicnPath);
    }

    async textureFromPpat(id: string): Promise<PIXI.Texture> {
        const ppatPath = urlJoin(dataPath, NovaDataType.PpatImage, id + '.png');
        await this.data.PpatImage.get(id);
        return PIXI.Texture.from(ppatPath);
    }

    private async getUrl(url: string, _priority = 0): Promise<unknown> {
        return PIXI.Assets.load(url);
    }

    private getDataPrefix(dataType: NovaDataType): string {
        return urlJoin(dataPath, dataType);
    }

    private addStructuredGettable<T>(dataType: NovaDataType): Gettable<T> {
        const dataPrefix = this.getDataPrefix(dataType);
        return new Gettable<T>(async (id: string, priority: number): Promise<T> => {
            return await this.getUrl(urlJoin(dataPrefix, id + '.json'), priority) as T;
        });
    }

    private addFramesGettable<T>(dataType: NovaDataType): Gettable<T> {
        const dataPrefix = this.getDataPrefix(dataType);
        const imagePrefix = this.getDataPrefix(NovaDataType.SpriteSheetImage);
        return new Gettable<T>(async (id: string, priority: number): Promise<T> => {
            // The sheet's JSON names its image (meta.image, which resolves
            // to this same URL), and PIXI's spritesheet parser only asks
            // for the image once the JSON is in: two round trips in a
            // row. Asking for the image alongside the JSON lets the
            // parser's request join this one in PIXI's loader cache
            // (keyed by the absolute URL), so a sheet costs one round
            // trip (#369). A failure here is the parser's to report.
            this.getUrl(urlJoin(imagePrefix, id) + '.png', priority)
                .catch(() => undefined);
            return (await this.getUrl(urlJoin(dataPrefix, id + '.json'), priority) as { data: unknown }).data as T;
        });
    }

    private addBinaryGettable<T>(dataType: NovaDataType, extension: string): Gettable<T> {
        const dataPrefix = this.getDataPrefix(dataType);
        return new Gettable<T>(async (id: string, priority: number): Promise<T> => {
            return ((await this.getUrl(urlJoin(dataPrefix, id) + extension, priority)) as { buffer: ArrayBuffer }).buffer as T;
        });
    }

    private addSoundGettable() {
        const dataPrefix = this.getDataPrefix(NovaDataType.SoundFile);
        return new Gettable<sound.Sound>(async (id) => {
            const soundPath = urlJoin(dataPrefix, id) + SOUND_EXTENSION;
            return new Promise((fulfill, reject) => {
                sound.Sound.from({
                    url: soundPath,
                    preload: true,
                    loaded: (err, loadedSound) => {
                        if (err || !loadedSound) {
                            reject(err);
                            return;
                        }
                        fulfill(loadedSound);
                    }
                });
            });
        });
    }

    private url(id: string): string {
        return urlJoin(dataPath, NovaDataType.PictImage, id + '.png');
    }
}
