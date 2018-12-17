import { OutgoingMessage } from "http";
import { NovaDataType } from "./NovaDataInterface";

type NovaIDs = {
    [index in NovaDataType]: Array<string>
}

export { NovaIDs }
