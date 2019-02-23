import * as express from "express";
import * as http from "http";
import * as socket from "socket.io";
import { NovaParse } from "novaparse";
import * as fs from "fs";
import * as path from "path";
import { GameDataAggregator } from "./server/parsing/GameDataAggregator";
import { GameDataServer } from "./server/GameDataServer";
//import * as RootPath from "app-root-path"; // Doesn't work with lerna

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
const gameDataServer = new GameDataServer(gameData, app);




// This has to be __dirname + "/static" or else sourcemaps don't work!
app.use("/static", express.static(__dirname + "/static"));
app.use("/", function(_req: express.Request, res: express.Response) {
    res.sendFile(__dirname + "/index.html");
});

httpServer.listen(port, function() {
    console.log("listening at port " + port);
});

/*
io.onconnection(function(socket: socket.Socket) {
    socket.on("pingTest", (data) => { console.log(data) });
});
*/
