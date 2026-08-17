import { GameDataInterface } from 'novadatainterface/game_data_interface';
import { Gettable } from 'novadatainterface/gettable';
import { NovaDataInterface } from 'novadatainterface/nova_data_interface';
import { NovaIDs } from 'novadatainterface/nova_ids';
import * as PIXI from 'pixi.js';
import * as sound from '@pixi/sound';
import { DisplayAssetData } from './display_asset_data.js';
import { SimulationGameData } from './simulation_game_data.js';

/**
 * Browser facade that preserves the existing mixed GameData API while delegating
 * worker-safe structured data and display asset loading to separate layers.
 */
export class GameData implements GameDataInterface {
    readonly simulation = new SimulationGameData();
    readonly display_assets = new DisplayAssetData();

    public readonly data: NovaDataInterface & {
        Sound: Gettable<sound.Sound>,
    };
    public readonly ids: Promise<NovaIDs>;
    readonly preloadData = this.simulation.preloadData;
    readonly controlBitNamespaces = this.simulation.controlBitNamespaces;
    public loaded = this.simulation.loaded;

    constructor() {
        this.data = {
            ...this.simulation.data,
            ...this.display_assets.data,
        };
        this.ids = this.simulation.ids;
    }

    getSettings(file: string): Promise<unknown> {
        return this.simulation.getSettings(file);
    }

    textureFromPict(id: string): PIXI.Texture {
        return this.display_assets.textureFromPict(id);
    }

    spriteFromPict(id: string) {
        return this.display_assets.spriteFromPict(id);
    }

    textureFromPictAsync(id: string, priority?: number) {
        return this.display_assets.textureFromPictAsync(id, priority);
    }

    spriteFromPictAsync(id: string, priority?: number) {
        return this.display_assets.spriteFromPictAsync(id, priority);
    }

    textureFromCicn(id: string): Promise<PIXI.Texture> {
        return this.display_assets.textureFromCicn(id);
    }
}
