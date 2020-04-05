import { SocketMessage, GameMessage } from "novajs/nova/src/proto/nova_service_pb";

export type Callbacks = { [event: string]: ((...args: unknown[]) => unknown)[] };
export type On = (event: string, cb: (...args: any[]) => unknown) => any;
export function trackOn(): [Callbacks, On] {
    let callbacks: Callbacks = {}

    function on(event: string, cb: (...args: unknown[]) => unknown) {

        if (!callbacks[event]) {
            callbacks[event] = [];
        }
        callbacks[event].push(cb);
    }
    return [callbacks, on]
}


export class MessageBuilder {
    private data?: GameMessage;
    private ping?: boolean;
    private pong?: boolean;

    setData(data: GameMessage) {
        this.data = data;
        return this;
    }

    setPing(val: boolean) {
        this.ping = val;
        return this;
    }

    setPong(val: boolean) {
        this.pong = val;
        return this;
    }

    build() {
        const message = new SocketMessage();

        if (this.data) {
            message.setData(this.data);
        }

        if (this.ping) {
            message.setPing(this.ping);
        }

        if (this.pong) {
            message.setPong(this.pong);
        }

        return message;
    }
}
