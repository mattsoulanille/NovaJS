import * as express from "express";
import { Express } from "express";
import * as path from 'path';
import { idsPath, dataPath, settingsPrefix } from "../common/GameDataPaths";
import { GameDataInterface } from "../../../nova_data_interface/GameDataInterface";
import { NovaDataType } from "../../../nova_data_interface/NovaDataInterface";


/**
 * Serves GameData to the client
 * Maybe consider https://github.com/RioloGiuseppe/byte-serializer in the future?
 */
export function setupRoutes(gameData: GameDataInterface, app: Express, htmlPath: string, bundlePath: string, bundleMapPath: string, settingsPath: string) {
    return new GameDataServer(gameData, app, htmlPath, bundlePath, bundleMapPath, settingsPath);
}

// This is a helper class used by `setupRoutes`
class GameDataServer {
    constructor(
        private readonly gameData: GameDataInterface,
        private readonly app: Express,
        private readonly htmlPath: string,
        private readonly bundlePath: string,
        private readonly bundleMapPath: string,
        private readonly settingsPath: string) {
        this.setupRoutes();
    }

    private setupRoutes() {
        // The order in which these routes are set up matters.
        // Earlier routes take precedence over later ones.
        // NOTE: This can not be converted to RPCs because PIXI.js
        // expects assets to be loaded from URLs.

        this.app.get(path.join(dataPath, ":name/:item.png"), this.requestFulfiller.bind(this));
        this.app.get(path.join(dataPath, ":name/:item.json"), this.requestFulfiller.bind(this));
        this.app.get(path.join(dataPath, ":name/:item.mp3"), this.requestFulfiller.bind(this));
        this.app.get(path.join(dataPath, ":name/:item"), this.requestFulfiller.bind(this));
        this.app.get(idsPath + ".json", this.idRequestFulfiller.bind(this));

        this.app.use('/preloadData.json', async (_req, res) => {
            res.send(this.gameData.preloadData ? await this.gameData.preloadData : {});
        });

        this.app.use(settingsPrefix,
            express.static(this.settingsPath));

        //        // This has to be here or else sourcemaps don't work!
        //        const staticPath = path.join(this.appRoot, "build", "static");
        //        this.app.use("/static", express.static(staticPath));
        this.app.use("/settings/controls.json", (_req: express.Request, res: express.Response) => {
            res.sendFile(this.settingsPath);
        });

        this.app.use("/browser_bundle.js", (_req: express.Request, res: express.Response) => {
            res.sendFile(this.bundlePath);
        });

        this.app.use("/browser_bundle.js.map", (_req: express.Request, res: express.Response) => {
            res.sendFile(this.bundleMapPath);
        });

        this.app.use("/", (_req: express.Request, res: express.Response) => {
            res.sendFile(this.htmlPath);
        });
    }

    private async requestFulfiller(req: express.Request, res: express.Response): Promise<void> {
        const name: string = req.params.name;
        const item: string = req.params.item;

        // TODO: Replace with protobufs
        var dataGettable = this.gameData.data[name as NovaDataType];

        if (dataGettable) {
            let data = await dataGettable.get(item);
            if (data instanceof ArrayBuffer) {
                data = Buffer.from(data);
            }
            res.send(data);
        }
        else {
            res.send("Unknown data type " + name);
        }
    }

    private async idRequestFulfiller(_req: express.Request, res: express.Response): Promise<void> {
        res.send(await this.gameData.ids);
    }
}
