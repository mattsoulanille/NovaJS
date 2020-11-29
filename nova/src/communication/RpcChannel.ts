import { RPCImpl } from "protobufjs";
import { EngineService } from "novajs/nova/src/proto/protobufjs_bundle";

export interface RpcChannel {
    call: RPCImpl
}

//new EngineService().update


enum RpcMethods {

}
