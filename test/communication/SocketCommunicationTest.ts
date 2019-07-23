import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import "mocha";
import * as io_server_precursor from "socket.io";
import * as io from "socket.io-client";

import { SocketChannelServer } from "../../src/server/SocketChannelServer";
import { SocketChannelClient } from "../../src/client/SocketChannelClient";
import { fail } from "assert";

before(function() {
    chai.should();
    chai.use(chaiAsPromised);

});

var io_server = io_server_precursor.listen(3001);

// Used to wait for socketio messages
// that we don't need to ack in production
// but we would like to verify that they eventually
// arrive
function sleep(ms: number): Promise<void> {
    return new Promise((fulfill) => {
        setTimeout(fulfill, ms);
    });
}

// https://stackoverflow.com/questions/15509231/unit-testing-node-js-and-websockets-socket-io
describe("Socket Communication Channel", function() {

    const clients: SocketIOClient.Socket[] = [];

    const serverChannel = new SocketChannelServer({ io: io_server });

    afterEach((done) => {
        for (let socket of clients) {
            if (socket.connected) {
                socket.disconnect();
            }
        }
        clients.length = 0; // clear the list of clients
        //io_server.close();
        done();
    });

    after(() => {
        io_server.close(); // is this necessary?
    })

    function connectClient(): Promise<SocketIOClient.Socket> {
        return new Promise((fulfill) => {
            let socket = io.connect("http://localhost:3001", {
                reconnectionDelay: 0,
                forceNew: true,
                reconnectionDelayMax: 0,
                transports: ["websocket"]
            });
            clients.push(socket);
            socket.on("connect", () => {
                fulfill(socket);
            });
        });
    }

    it("basic socket.io communication should work (if this fails, the tester is broken)", async () => {

        const serverReceive = new Promise((fulfill) => {
            io_server.on("connection", (serverSocket) => {
                serverSocket.should.not.be.null;
                serverSocket.once("helloWorld", (message: any) => {
                    message.should.equal("And hello to you, server");
                    fulfill();
                });
            });
        });

        let socket = await connectClient();

        socket.once("helloWorld", (message: any) => {
            // Check that the message matches
            message.should.equal("Hello client");
            socket.emit("helloWorld", "And hello to you, server");
        });

        // once connected, emit Hello World
        io_server.emit("helloWorld", "Hello client");
        await serverReceive;
    });


    it("Clients and the server should know who's connected", async function() {
        let client1 = new SocketChannelClient({ socket: await connectClient() });
        let client2 = new SocketChannelClient({ socket: await connectClient() });
        let client3 = new SocketChannelClient({ socket: await connectClient() });
        await client1.readyPromise;
        await client2.readyPromise;
        await client3.readyPromise;
        if (client1.uuid === undefined || client2.uuid === undefined || client3.uuid === undefined) {
            fail("uuid was undefined for a client");
        }
        else {
            // .have.keys also fails if it has keys we don't mention.
            serverChannel.peers.should.have.keys(client1.uuid, client2.uuid, client3.uuid);
            await sleep(50); // Wait for the server to notify the clients of new peers
            client1.peers.should.have.keys(serverChannel.uuid, client2.uuid, client3.uuid);
            client2.peers.should.have.keys(client1.uuid, serverChannel.uuid, client3.uuid);
            client3.peers.should.have.keys(client1.uuid, client2.uuid, serverChannel.uuid);

            client2.disconnect();
            await sleep(50); // Wait for the disconnect message to arrive.
            serverChannel.peers.should.have.keys(client1.uuid, client3.uuid);
            client1.peers.should.have.keys(serverChannel.uuid, client3.uuid);
            client3.peers.should.have.keys(client1.uuid, serverChannel.uuid);
        }
    });
});
