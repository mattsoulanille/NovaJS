import * as path from "path";
import { ExplosionData } from "novadatainterface/ExplosionData";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { Gettable } from "novadatainterface/Gettable";
import { NovaDataInterface, NovaIDNotFoundError } from "novadatainterface/NovaDataInterface";
import { getDefaultNovaIDs, NovaIDs } from "novadatainterface/NovaIDs";
import { OutfitData } from "novadatainterface/OutiftData";
import { PictData } from "novadatainterface/PictData";
import { PictImageData } from "novadatainterface/PictImage";
import { PlanetData } from "novadatainterface/PlanetData";
import { ShipData } from "novadatainterface/ShipData";
import { SpriteSheetData, SpriteSheetFramesData, SpriteSheetImageData } from "novadatainterface/SpriteSheetData";
import { StatusBarData } from "novadatainterface/StatusBarData";
import { SystemData } from "novadatainterface/SystemData";
import { TargetCornersData } from "novadatainterface/TargetCornersData";
import { WeaponData } from "novadatainterface/WeaponData";
import { IDSpaceHandler } from "./src/IDSpaceHandler";
import { ExplosionParse } from "./src/parsers/ExplosionParse";
import { OutfitParse } from "./src/parsers/OutfitParse";
import { PictImageMulti, PictImageMultiParse } from "./src/parsers/PictParse";
import { PlanetParse } from "./src/parsers/PlanetParse";
import { resourceIDNotFoundStrict, resourceIDNotFoundWarn } from "./src/parsers/ResourceIDNotFound";
import { ShipParseClosure, ShipPictMap, WeaponOutfitMap } from "./src/parsers/ShipParse";
import { SpriteSheetMulti, SpriteSheetMultiParse } from "./src/parsers/SpriteSheetMultiParse";
import { StatusBarParse } from "./src/parsers/StatusBarParse";
import { SystemParse } from "./src/parsers/SystemParse";
import { TargetCornersParse } from "./src/parsers/TargetCornersParse";
import { WeaponParse } from "./src/parsers/WeaponParse";
import { BoomResource } from "./src/resource_parsers/BoomResource";
import { BaseResource } from "./src/resource_parsers/NovaResourceBase";
import { OutfResource } from "./src/resource_parsers/OutfResource";
import { PictResource } from "./src/resource_parsers/PictResource";
import { NovaResources, NovaResourceType, ResList } from "./src/resource_parsers/ResourceHolderBase";
import { RledResource } from "./src/resource_parsers/RledResource";
import { ShipResource } from "./src/resource_parsers/ShipResource";
import { SpobResource } from "./src/resource_parsers/SpobResource";
import { SystResource } from "./src/resource_parsers/SystResource";
import { WeapResource } from "./src/resource_parsers/WeapResource";
import { Defaults } from "novadatainterface/Defaults";


type ParseFunction<T extends BaseResource, O> = (resource: T, errorFunc: (message: string) => void) => Promise<O>;

export class NovaParse implements GameDataInterface {
    private pictImageGettable: Gettable<PictImageData>;
    private pictGettable: Gettable<PictData>;
    private pictMultiGettable: Gettable<PictImageMulti>;
    private spriteSheetDataGettable: Gettable<SpriteSheetData>;
    private spriteSheetFramesGettable: Gettable<SpriteSheetFramesData>;
    private spriteSheetImageGettable: Gettable<SpriteSheetImageData>;
    private spriteSheetMultiGettable: Gettable<SpriteSheetMulti>;

    private shipParser: (s: ShipResource, m: (message: string) => void) => Promise<ShipData>;

    private shipPICTMap: ShipPictMap;
    private weaponOutfitMap: WeaponOutfitMap;
    resourceNotFoundFunction: (message: string) => void;
    public data: NovaDataInterface;
    path: string
    private idSpaceHandler: IDSpaceHandler;

    public readonly ids: Promise<NovaIDs>;
    public readonly idSpace: Promise<NovaResources | Error>;

    constructor(dataPath: string, strict: boolean = true,
        subPaths:
            { novaFiles: string, novaPlugins: string } =
            { novaFiles: "Nova\ Files", novaPlugins: "Plug-ins" }) {

        // Strict will throw an error if any resource is not found.
        // Otherwise, it will try to substitute default resources whenever possible (success may vary).
        if (strict) {
            this.resourceNotFoundFunction = resourceIDNotFoundStrict;
        }
        else {
            this.resourceNotFoundFunction = resourceIDNotFoundWarn;
        }

        this.path = path.join(dataPath);
        this.idSpaceHandler = new IDSpaceHandler(dataPath, subPaths);
        this.idSpace = this.idSpaceHandler.getIDSpace().catch((e: Error) => {
            // Suppress all promise rejections. These are instead thrown when specific resources are requested
            //console.log("Got an error");
            return e;
        });


        this.idSpace.catch((_e: Error) => { });

        this.shipPICTMap = this.makeShipPictMap();
        this.weaponOutfitMap = this.makeWeaponOutfitMap();
        this.shipParser = ShipParseClosure(this.shipPICTMap, this.weaponOutfitMap, this.idSpace);


        // Holds spriteSheetMulti which gets split up
        this.spriteSheetMultiGettable = this.makeGettable<RledResource, SpriteSheetMulti>(NovaResourceType.rlëD, SpriteSheetMultiParse);
        // Since everything about a spriteSheet is parsed at once, it needs to be split up here
        this.spriteSheetDataGettable = new Gettable(this.getSpriteSheetData.bind(this));
        this.spriteSheetImageGettable = new Gettable(this.getSpriteSheetImage.bind(this));
        this.spriteSheetFramesGettable = new Gettable(this.getSpriteSheetFrames.bind(this));



        // Similar for pict
        this.pictMultiGettable = this.makeGettable<PictResource, PictImageMulti>(NovaResourceType.PICT, PictImageMultiParse);
        this.pictGettable = new Gettable(this.getPictData.bind(this));
        this.pictImageGettable = new Gettable(this.getPictImage.bind(this));


        this.ids = this.buildIDs();
        this.data = this.buildData();

    }

    private buildIDsForResource(resourceList: ResList<BaseResource>): Array<string> {

        return Object.keys(resourceList);
    }

    private async buildIDs(): Promise<NovaIDs> {
        var idSpace = await this.idSpace;
        if (idSpace instanceof Error) {
            return getDefaultNovaIDs();
        }

        return {
            Ship: this.buildIDsForResource(idSpace.shïp),
            Outfit: this.buildIDsForResource(idSpace.oütf),
            Weapon: this.buildIDsForResource(idSpace.wëap),
            Pict: this.buildIDsForResource(idSpace.PICT),
            PictImage: this.buildIDsForResource(idSpace.PICT),
            Cicn: this.buildIDsForResource(idSpace.cicn),
            CicnImage: this.buildIDsForResource(idSpace.cicn),
            Planet: this.buildIDsForResource(idSpace.spöb),
            System: this.buildIDsForResource(idSpace.sÿst),
            TargetCorners: [], // TODO: parse these
            SpriteSheet: this.buildIDsForResource(idSpace.rlëD),
            SpriteSheetImage: this.buildIDsForResource(idSpace.rlëD),
            SpriteSheetFrames: this.buildIDsForResource(idSpace.rlëD),
            StatusBar: this.buildIDsForResource(idSpace.ïntf),
            Explosion: this.buildIDsForResource(idSpace.bööm)
        }
    }

    // Assigns all the gettables to this.data
    private buildData(): NovaDataInterface {
        // This should really use NovaDataType.Ship etc but that isn't allowed when constructing like this.
        var data: NovaDataInterface = {
            Ship: this.makeGettable<ShipResource, ShipData>(NovaResourceType.shïp, this.shipParser),
            Outfit: this.makeGettable<OutfResource, OutfitData>(NovaResourceType.oütf, OutfitParse),
            Weapon: this.makeGettable<WeapResource, WeaponData>(NovaResourceType.wëap, WeaponParse),
            Pict: this.pictGettable,
            PictImage: this.pictImageGettable,
            Cicn: new Gettable(async () => Defaults.Cicn), // TODO
            CicnImage: new Gettable(async () => Defaults.CicnImage), // TODO
            Planet: this.makeGettable<SpobResource, PlanetData>(NovaResourceType.spöb, PlanetParse),
            System: this.makeGettable<SystResource, SystemData>(NovaResourceType.sÿst, SystemParse),
            TargetCorners: this.makeGettable<BaseResource, TargetCornersData>(NovaResourceType.cicn, TargetCornersParse),
            SpriteSheet: this.spriteSheetDataGettable,
            SpriteSheetImage: this.spriteSheetImageGettable,
            SpriteSheetFrames: this.spriteSheetFramesGettable,
            StatusBar: this.makeGettable<BaseResource, StatusBarData>(NovaResourceType.ïntf, StatusBarParse),
            Explosion: this.makeGettable<BoomResource, ExplosionData>(NovaResourceType.bööm, ExplosionParse)
        }

        return data;
    }

    private makeGettable<T extends BaseResource, O>(resourceType: NovaResourceType, parseFunction: ParseFunction<T, O>): Gettable<O> {
        return new Gettable(async (id: string) => {
            var idSpace = await this.idSpace; // May be an error
            if (idSpace instanceof Error) {
                throw idSpace;
            }

            var resource = <T>idSpace[resourceType][id];

            // Shouldn't this just call resourceNotFoundFunction???
            if (typeof resource === "undefined") {
                throw new NovaIDNotFoundError("NovaParse could not find " + resourceType + " of ID " + id + ".");
            }

            return await parseFunction(resource, this.resourceNotFoundFunction);
        });
    }

    // shïps whose corresponding PICT does not exist
    // use the PICT of the first shïp that had the same baseImage ID
    private async makeShipPictMap(): ShipPictMap {
        var idSpace = await this.idSpace;
        if (idSpace instanceof Error) {
            return {};
        }

        // Maps shïp ids to their baseImage ids
        var shipPICTMap: { [index: string]: string } = {};

        // maps baseImage ids to pict ids
        var baseImagePICTMap: { [index: string]: string } = {};

        // Populate baseImagePICTMap
        for (let shipGlobalID in idSpace.shïp) {
            var ship = idSpace.shïp[shipGlobalID];
            var pict = ship.idSpace.PICT[ship.pictID];

            if (!pict) {
                continue; // Ship has no corresponding pict, so don't set anything.
            }

            var shan = ship.idSpace.shän[ship.id];
            if (!shan) {
                this.resourceNotFoundFunction("shïp id " + ship.globalID + " missing shan");
                continue; // If it's not found, there's no baseImage to map from
            }
            var baseImageLocalID = shan.images.baseImage.ID;
            var baseImageGlobalID = shan.idSpace.rlëD[baseImageLocalID].globalID;

            // Don't overwrite if it already exists. The first ship with the
            // baseImage determines the PICT
            if (!baseImagePICTMap[baseImageGlobalID]) {
                // The base image corresponds to this pict.
                baseImagePICTMap[baseImageGlobalID] = pict.globalID;
            }
        }

        // Populate shipPICTMap
        for (let shipGlobalID in idSpace.shïp) {
            var ship = idSpace.shïp[shipGlobalID];
            var pict = ship.idSpace.PICT[ship.pictID];

            if (pict) {
                // Then there is a pict for this ship.
                // Set it in the map.
                shipPICTMap[shipGlobalID] = pict.globalID;
            }
            else {
                // No pict found for this ship, so look up the first
                // ship's baseImage in the baseImagePICTMap
                var shan = ship.idSpace.shän[ship.id];
                var baseImageLocalID = shan.images.baseImage.ID;
                var baseImageGlobalID = shan.idSpace.rlëD[baseImageLocalID].globalID;
                shipPICTMap[shipGlobalID] = baseImagePICTMap[baseImageGlobalID];
            }
        }
        return shipPICTMap;
    }

    private async makeWeaponOutfitMap(): WeaponOutfitMap {
        var idSpace = await this.idSpace;
        if (idSpace instanceof Error) {
            return {};
        }

        // Maps a weapon to the first outfit that provides it.
        var weaponOutfitMap: { [index: string]: string } = {};

        for (let outfitID in idSpace.oütf) {

            var outfit = await this.data.Outfit.get(outfitID);
            for (let weaponID in outfit.weapons) {
                if (!(weaponOutfitMap[weaponID])) {
                    weaponOutfitMap[weaponID] = outfitID;
                }
            }
        }
        return weaponOutfitMap;
    }

    private async getSpriteSheetData(id: string): Promise<SpriteSheetData> {
        var multi: SpriteSheetMulti = await this.spriteSheetMultiGettable.get(id);
        return multi.spriteSheet
    }
    private async getSpriteSheetImage(id: string): Promise<SpriteSheetImageData> {
        var multi: SpriteSheetMulti = await this.spriteSheetMultiGettable.get(id);
        return multi.spriteSheetImage;
    }
    private async getSpriteSheetFrames(id: string): Promise<SpriteSheetFramesData> {
        var multi: SpriteSheetMulti = await this.spriteSheetMultiGettable.get(id);
        return multi.spriteSheetFrames;
    }

    private async getPictData(id: string): Promise<PictData> {
        var multi: PictImageMulti = await this.pictMultiGettable.get(id);
        return multi.pict;
    }
    private async getPictImage(id: string): Promise<PictImageData> {
        var multi: PictImageMulti = await this.pictMultiGettable.get(id);
        return multi.image;
    }
}
