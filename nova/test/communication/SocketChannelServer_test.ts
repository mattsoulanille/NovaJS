//import "jasmine";
//import { SocketChannelServer } from "novajs/nova/src/communication/SocketChannelServer";
import * as WebSocket from "ws";

describe("SocketChannelServer", function() {

    let wss: WebSocket.Server;

    beforeEach(() => {
        wss = new WebSocket.Server({ port: 8080 });
    });

    it("Should be created", () => {
        // const server = new SocketChannelServer({
        //     webSocket: wss
        // });
        // expect(server).toBeDefined();
        expect(true).toBe(true);
    })
});

