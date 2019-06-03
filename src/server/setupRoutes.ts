import * as express from "express";
import { Express } from "express";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { NovaDataType } from "novadatainterface/NovaDataInterface";
import * as path from 'path';
import { idsPath, dataPath } from "../common/GameDataPaths";

/**
 * Serves GameData to the client
 * Maybe consider https://github.com/RioloGiuseppe/byte-serializer in the future?
 */


function setupRoutes(gameData: GameDataInterface, app: Express) {
    return new GameDataServer(gameData, app);
}

class GameDataServer {
    private gameData: GameDataInterface;
    private app: Express;

    constructor(gameData: GameDataInterface, app: Express) {
        this.gameData = gameData;
        this.app = app;
        this.setupRoutes();
    }

    private setupRoutes() {
        this.app.get(path.join(dataPath, ":name/:item.png"), this.requestFulfiller.bind(this));
        this.app.get(path.join(dataPath, ":name/:item.json"), this.requestFulfiller.bind(this));
        this.app.get(path.join(dataPath, ":name/:item"), this.requestFulfiller.bind(this));
        this.app.get(idsPath + ".json", this.idRequestFulfiller.bind(this));
    }

    private async requestFulfiller(req: express.Request, res: express.Response): Promise<void> {
        var name: NovaDataType = req.params.name;
        var item: string = req.params.item;

        var dataGettable = this.gameData.data[name];

        if (dataGettable) {
            var data = await dataGettable.get(item);
            res.send(data);
        }
        else {
            res.send("Unknown data type " + name);
        }
    }

    private async idRequestFulfiller(_req: express.Request, res: express.Response): Promise<void> {
        res.send(await this.gameData.ids);
    }

    // http://artsy.github.io/blog/2018/11/21/conditional-types-in-typescript/
    //	private async test<T extends NovaDataType>(dataType: NovaDataType,
}


export { setupRoutes };
