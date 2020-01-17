import * as express from "express";
import { Express } from "express";
import * as path from 'path';
import { idsPath, dataPath, settingsPrefix } from "../common/GameDataPaths";
import { GameDataInterface } from "../../../novadatainterface/GameDataInterface";
import { NovaDataType } from "../../../novadatainterface/NovaDataInterface";

/**
 * Serves GameData to the client
 * Maybe consider https://github.com/RioloGiuseppe/byte-serializer in the future?
 */


function setupRoutes(gameData: GameDataInterface, app: Express, appRoot: string) {
    return new GameDataServer(gameData, app, appRoot);
}

class GameDataServer {

    constructor(
        private readonly gameData: GameDataInterface,
        private readonly app: Express,
        private readonly appRoot: string) {

        this.setupRoutes();
    }

    private setupRoutes() {

        // The order in which these routes are set up matters.
        // Earlier routes take precedence over later ones.

        this.app.get(path.join(dataPath, ":name/:item.png"), this.requestFulfiller.bind(this));
        this.app.get(path.join(dataPath, ":name/:item.json"), this.requestFulfiller.bind(this));
        this.app.get(path.join(dataPath, ":name/:item"), this.requestFulfiller.bind(this));
        this.app.get(idsPath + ".json", this.idRequestFulfiller.bind(this));

        const settingsPath = path.join(this.appRoot, "settings");
        this.app.use(settingsPrefix,
            express.static(settingsPath));

        // This has to be here or else sourcemaps don't work!
        const staticPath = path.join(this.appRoot, "build", "static");
        this.app.use("/static", express.static(staticPath));
        this.app.use("/", (_req: express.Request, res: express.Response) => {
            res.sendFile(path.join(this.appRoot, "build", "index.html"));
        });
    }

    private async requestFulfiller(req: express.Request, res: express.Response): Promise<void> {
        const name: string = req.params.name;
        const item: string = req.params.item;

        // TODO: Replace with protobufs
        var dataGettable = this.gameData.data[name as NovaDataType];

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
