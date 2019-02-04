import * as express from "express";
import * as http from "http";
import * as socket from "socket.io";
import { NovaParse } from "novaparse";
import * as fs from "fs";
import * as path from "path";
import { GameDataAggregator } from "./server/parsing/GameDataAggregator";
//import * as RootPath from "app-root-path";

const appRoot: string = path.join(__dirname, "../");

const settings = JSON.parse(fs.readFileSync("./settings/server.json", "utf8"));

const app = express();
const httpServer = new http.Server(app);
const io = socket(httpServer);

const port: number = settings.port;
const novaDataPath: string = path.join(appRoot, settings["relative data path"]);
//const novaDataPath: string = path.join(__dirname, "Nova\ Data");



const novaFileData = new NovaParse(novaDataPath, false);
const gameData = new GameDataAggregator([novaFileData]);

gameData.data.Ship.get("nova:128").then(function(s) {
    console.log(s);
});


app.use("/static", express.static(appRoot + "/static"));

app.use("/", function(_req: express.Request, res: express.Response) {
    res.sendFile(__dirname + "/index.html");
});

httpServer.listen(port, function() {
    console.log("listening at port " + port);
});
