import * as express from "express";
import * as http from "http";
import * as socket from "socket.io";


const app = express();
const httpServer = new http.Server(app);
const io = socket(httpServer);

const port = 8000; // FIX ME

app.use("/static", express.static(__dirname + "/static"));

app.use("/", function(_req: express.Request, res: express.Response) {
    res.sendFile(__dirname + "/index.html");
});

httpServer.listen(port, function() {
    console.log("listening at port " + port);
});
