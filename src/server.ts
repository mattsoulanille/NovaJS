import * as express from "express";
import * as http from "http";
import * as socket from "socket.io";
import { NovaParse } from "novaparse";
import * as fs from "fs";
import * as path from "path";
import { GameDataAggregator } from "./server/parsing/GameDataAggregator";

const settings = JSON.parse(fs.readFileSync("./settings/server.json", "utf8"));

const app = express();
const httpServer = new http.Server(app);
const io = socket(httpServer);

const port: number = settings.port;
const novaDataPath: string = path.join(__dirname, settings["relative data path"]);




const novaFileData = new NovaParse(novaDataPath, false);
const gameData = new GameDataAggregator([novaFileData])



app.use("/static", express.static(__dirname + "/static"));

app.use("/", function(_req: express.Request, res: express.Response) {
    res.sendFile(__dirname + "/index.html");
});

httpServer.listen(port, function() {
    console.log("listening at port " + port);
});
