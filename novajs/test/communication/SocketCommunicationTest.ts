import { fail } from "assert";
import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import "mocha";
import * as io_server_precursor from "socket.io";
import * as io from "socket.io-client";
import { Subject } from "rxjs";
import { first } from "rxjs/operators";
import { SocketChannelClient } from "../../src/communication/SocketChannelClient";
import { SocketChannelServer } from "../../src/communication/SocketChannelServer";


before(function() {
    chai.should();
    chai.use(chaiAsPromised);

});

var io_server = io_server_precursor.listen(3001);


function waitForEvent<T>(handler: Subject<T>, timeout = 1000): Promise<T> {

    return new Promise((fulfill, reject) => {
        const subscription = handler
            .pipe(first())
            .subscribe(success);

        const failTimeout = setTimeout(() => {
            subscription.unsubscribe();
            reject(new Error("More than " + timeout + " milliseconds spent"));
        }, timeout);

        function success(v: T) {
            clearTimeout(failTimeout);
            fulfill(v);
        }
    });
}

// https://stackoverflow.com/questions/15509231/unit-testing-node-js-and-websockets-socket-io
describe("Socket Communication Channel", function() {

    const SocketIOclients: SocketIOClient.Socket[] = [];

    const serverChannel = new SocketChannelServer({ io: io_server, admins: new Set(["bob", "frank"]) });
    const clientChannels: { [index: string]: SocketChannelClient } = {};

    afterEach(async () => {
        for (let clientUUID in clientChannels) {
            await disconnectClient(clientUUID);
        }

        for (let socket of SocketIOclients) {
            if (socket.connected) {
                socket.disconnect();
            }
        }
        SocketIOclients.length = 0; // clear the list of clients
        //io_server.close();
    });

    after(() => {
        io_server.close(); // is this necessary?
    })

    function connectSocketIOClient(): Promise<SocketIOClient.Socket> {
        return new Promise((fulfill) => {
            let socket = io.connect("http://localhost:3001", {
                reconnectionDelay: 0,
                forceNew: true,
                reconnectionDelayMax: 0,
                transports: ["websocket"]
            });
            SocketIOclients.push(socket);
            socket.on("connect", () => {
                fulfill(socket);
            });
        });
    }


    // Builds and connects a client
    // Guarantees that the client and all peers know about eachother
    async function connectClient(): Promise<SocketChannelClient> {
        const promises: Promise<string>[] = [];
        for (let peerUUID in clientChannels) {
            let peer = clientChannels[peerUUID];
            promises.push(waitForEvent(peer.onPeerConnect));
        }
        promises.push(waitForEvent(serverChannel.onPeerConnect));
        const client = new SocketChannelClient({ socket: await connectSocketIOClient() });

        let results = await Promise.all(promises);
        await client.readyPromise;
        for (let uuid of results) {
            uuid.should.equal(client.uuid);
        }

        if (client.uuid !== undefined) {
            clientChannels[client.uuid] = client;
        }
        else {
            fail("Client uuid was undefined");
        }

        return client;
    }

    async function disconnectClient(uuid: string): Promise<void> {
        let client = clientChannels[uuid];
        if (client !== undefined) {
            const promises: Promise<string>[] = [];
            for (let peerUUID in clientChannels) {
                if (peerUUID !== uuid) {
                    let peer = clientChannels[peerUUID];
                    promises.push(waitForEvent(peer.onPeerDisconnect));
                }
            }
            promises.push(waitForEvent(serverChannel.onPeerDisconnect));

            client.disconnect();
            let results = await Promise.all(promises);
            for (let uuid of results) {
                uuid.should.equal(client.uuid);
            }
            delete clientChannels[uuid];
        }
        else {
            fail("Tried to disconnect nonexistent client " + uuid);
        }
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

        let socket = await connectSocketIOClient();

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

        let client1 = await connectClient();
        let client2 = await connectClient();
        let client3 = await connectClient();

        if (client1.uuid === undefined || client2.uuid === undefined || client3.uuid === undefined) {
            fail("uuid was undefined for a client");
        }
        else {
            // .have.keys also fails if it has keys we don't mention.
            serverChannel.peers.should.have.keys(client1.uuid, client2.uuid, client3.uuid);

            client1.peers.should.have.keys(serverChannel.uuid, client2.uuid, client3.uuid);
            client2.peers.should.have.keys(client1.uuid, serverChannel.uuid, client3.uuid);
            client3.peers.should.have.keys(client1.uuid, client2.uuid, serverChannel.uuid);

            await disconnectClient(client2.uuid);

            serverChannel.peers.should.have.keys(client1.uuid, client3.uuid);
            client1.peers.should.have.keys(serverChannel.uuid, client3.uuid);
            client3.peers.should.have.keys(client1.uuid, serverChannel.uuid);
        }
    });

    it("serverChannel should be cleared of peers between tests", function() {
        serverChannel.peers.should.be.empty;
    });

    it("Should allow messages to be sent between clients", async function() {
        let client1 = await connectClient();
        let client2 = await connectClient();
        let client3 = await connectClient();


        var client3Promise = waitForEvent(client3.onMessage, 100);
        var message1 = "Hello from client1 " + Math.random();
        var message1Promise = waitForEvent(client2.onMessage);
        if (client2.uuid !== undefined) {
            client1.send(client2.uuid, message1);

            (await message1Promise).should.deep.equal({
                source: client1.uuid,
                message: message1
            });
        }
        else {
            fail("client2 uuid undefined");
        }


        let caughtException = false;
        try {
            await client3Promise;
        }
        catch (e) {
            caughtException = true;
        }
        caughtException.should.equal(true, "client3 received message sent from client1 to client2");

    });

    it("Should allow messages to be sent to and from the server", async function() {
        let client1 = await connectClient();
        let client2 = await connectClient();
        let client3 = await connectClient();

        var client3Promise = waitForEvent(client3.onMessage, 100);
        var toServer = "Hello from client1 " + Math.random();
        var toServerPromise = waitForEvent(serverChannel.onMessage);
        client1.send(serverChannel.uuid, toServer);

        (await toServerPromise).should.deep.equal({
            source: client1.uuid,
            message: toServer
        });

        var fromServer = "Hello from the server " + Math.random();
        var fromServerPromise = waitForEvent(client2.onMessage);
        if (client2.uuid !== undefined) {
            serverChannel.send(client2.uuid, fromServer);

            (await fromServerPromise).should.deep.equal({
                source: serverChannel.uuid,
                message: fromServer
            });
        }
        else {
            fail("client2 uuid undefined");
        }


        let caughtException = false;
        try {
            await client3Promise;
        }
        catch (e) {
            caughtException = true;
        }
        caughtException.should.equal(true, "client3 received message it should not have received");

    })

    it("Should allow broadcasts from a client", async function() {
        let client1 = await connectClient();
        let client2 = await connectClient();
        let client3 = await connectClient();

        let client2ReceiveClient1 = waitForEvent(client2.onMessage);
        let client3ReceiveClient1 = waitForEvent(client3.onMessage);
        let serverReceiveClient1 = waitForEvent(serverChannel.onMessage);

        let client1Message = "Broadcast from client1 " + Math.random();
        client1.broadcast(client1Message);

        let expectedMessage = {
            source: client1.uuid,
            message: client1Message
        };

        (await client2ReceiveClient1).should.deep.equal(expectedMessage);
        (await client3ReceiveClient1).should.deep.equal(expectedMessage);
        (await serverReceiveClient1).should.deep.equal(expectedMessage);
    });

    it("Should allow broadcasts from the server", async function() {
        let client1 = await connectClient();
        let client2 = await connectClient();
        let client3 = await connectClient();

        let client1ReceiveServer = waitForEvent(client1.onMessage);
        let client2ReceiveServer = waitForEvent(client2.onMessage);
        let client3ReceiveServer = waitForEvent(client3.onMessage);


        let serverMessage = "Broadcast from server " + Math.random();
        serverChannel.broadcast(serverMessage);

        let expectedMessage = {
            source: serverChannel.uuid,
            message: serverMessage
        };;

        (await client1ReceiveServer).should.deep.equal(expectedMessage);
        (await client2ReceiveServer).should.deep.equal(expectedMessage);
        (await client3ReceiveServer).should.deep.equal(expectedMessage);

    });

    it("Should forward a set of admins", async function() {
        let client1 = await connectClient();
        let admins = new Set([serverChannel.uuid, "bob", "frank"]);
        client1.admins.should.deep.equal(admins);
        serverChannel.admins.should.deep.equal(admins);
    })
});
