import * as fs from "fs";
import * as path from "path";
import { GameDataInterface } from "novajs/novadatainterface/GameDataInterface";
import { NovaDataInterface, NovaDataType } from "novajs/novadatainterface/NovaDataInterface";
import { NovaIDs } from "novajs/novadatainterface/NovaIDs";
import { ShipData } from "novajs/novadatainterface/ShipData";
import { OutfitData } from "novajs/novadatainterface/OutiftData";
import { WeaponData } from "novajs/novadatainterface/WeaponData";
import { ExplosionData } from "novajs/novadatainterface/ExplosionData";
import { Gettable } from "novajs/novadatainterface/Gettable";
import { BaseData } from "novajs/novadatainterface/BaseData";
import { PictImageData } from "novajs/novadatainterface/PictImage";
import { SpriteSheetFramesData, SpriteSheetData, SpriteSheetImageData } from "novajs/novadatainterface/SpriteSheetData";
import { PictData } from "novajs/novadatainterface/PictData";
import { PlanetData } from "novajs/novadatainterface/PlanetData";
import { SystemData } from "novajs/novadatainterface/SystemData";
import { TargetCornersData } from "novajs/novadatainterface/TargetCornersData";
import { StatusBarData } from "novajs/novadatainterface/StatusBarData";


type PathInfo = {
    path: string,
    extension: string
};

const Paths = {
    Ship: { path: "Ship", extension: "json" } as PathInfo,
    Outfit: { path: "Outfit", extension: "json" } as PathInfo,
    Weapon: { path: "Weapon", extension: "json" } as PathInfo,
    Pict: { path: "Pict", extension: "json" } as PathInfo,
    PictImage: { path: "Pict", extension: "png" } as PathInfo,
    Planet: { path: "Planet", extension: "json" } as PathInfo,
    System: { path: "System", extension: "json" } as PathInfo,
    TargetCorners: { path: "TargetCorners", extension: "json" } as PathInfo,
    SpriteSheet: { path: "SpriteSheet", extension: "json" } as PathInfo,
    SpriteSheetImage: { path: "SpriteSheetImage", extension: "png" } as PathInfo,
    SpriteSheetFrames: { path: "SpriteSheetFrames", extension: "json" } as PathInfo,
    StatusBar: { path: "StatusBar", extension: "json" } as PathInfo,
    Explosion: { path: "Explosion", extension: "json" } as PathInfo
};



class FilesystemData implements GameDataInterface {
    public ids: Promise<NovaIDs>;
    public data: NovaDataInterface;


    constructor(private rootPath: string) {
        this.data = {
            Ship: this.getFunction<ShipData>(Paths.Ship),
            Outfit: this.getFunction<OutfitData>(Paths.Outfit),
            Weapon: this.getFunction<WeaponData>(Paths.Weapon),
            Pict: this.getFunction<PictData>(Paths.Pict),
            PictImage: this.getFunction<PictImageData>(Paths.PictImage),
            Planet: this.getFunction<PlanetData>(Paths.Planet),
            System: this.getFunction<SystemData>(Paths.System),
            TargetCorners: this.getFunction<TargetCornersData>(Paths.TargetCorners),
            SpriteSheet: this.getFunction<SpriteSheetData>(Paths.SpriteSheet),
            SpriteSheetImage: this.getFunction<SpriteSheetImageData>(Paths.SpriteSheetImage),
            SpriteSheetFrames: this.getFunction<SpriteSheetFramesData>(Paths.SpriteSheetFrames),
            StatusBar: this.getFunction<StatusBarData>(Paths.StatusBar),
            Explosion: this.getFunction<ExplosionData>(Paths.Explosion)
        }
        this.ids = this.buildIDs();
    }

    getFunction<T extends BaseData | PictImageData | SpriteSheetFramesData>(p: PathInfo): Gettable<T> {
        // Returns a gettable that loads the resource from a file
        return new Gettable<T>((id: string) => {
            return new Promise<T>((fulfill, reject) => {
                fs.readFile(path.join(this.rootPath, p.path, id + "." + p.extension),
                    function(err, contents) {
                        if (err) {
                            reject(err);
                        }
                        else {
                            if (p.extension == "json") {
                                fulfill(JSON.parse(contents.toString('utf8')) as T)
                            }
                            else if (p.extension == "png") {
                                fulfill(contents as T);
                            }
                            else {
                                reject("Unsupported");
                            }
                        }
                    });
            });
        });
    }

    async buildIDs(): Promise<NovaIDs> {

        return {
            Ship: await this.buildIDsForPath(Paths.Ship),
            Outfit: await this.buildIDsForPath(Paths.Outfit),
            Weapon: await this.buildIDsForPath(Paths.Weapon),
            Pict: await this.buildIDsForPath(Paths.Pict),
            PictImage: await this.buildIDsForPath(Paths.PictImage),
            Planet: await this.buildIDsForPath(Paths.Planet),
            System: await this.buildIDsForPath(Paths.System),
            TargetCorners: await this.buildIDsForPath(Paths.TargetCorners),
            SpriteSheet: await this.buildIDsForPath(Paths.SpriteSheet),
            SpriteSheetImage: await this.buildIDsForPath(Paths.SpriteSheetImage),
            SpriteSheetFrames: await this.buildIDsForPath(Paths.SpriteSheetFrames),
            StatusBar: await this.buildIDsForPath(Paths.StatusBar),
            Explosion: await this.buildIDsForPath(Paths.Explosion),
        }
    }


    buildIDsForPath(p: PathInfo): Promise<string[]> {
        return new Promise((fulfill, reject) => {
            fs.readdir(path.join(this.rootPath, p.path), function(error, files) {
                if (error) {
                    if (error.code === "ENOENT") {
                        fulfill([]); // If the directory doesn't exist, then there are no IDs
                    }
                    else {
                        reject(error);
                    }
                }
                else {
                    fulfill(files.filter(function(name) {
                        return name.slice(name.length - (p.extension.length + 1), name.length) === ("." + p.extension);
                    }).map(function(name) {
                        return name.slice(0, name.length - (p.extension.length + 1));
                    }));
                }
            });
        });
    }
};

export { FilesystemData };
