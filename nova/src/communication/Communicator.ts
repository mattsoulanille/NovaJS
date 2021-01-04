import { Message } from "../ecs/plugins/multiplayer_plugin";

export interface Communicator {
    sendMessage(message: Message, destination?: string): void;
    getMessages(): Message[];
}
