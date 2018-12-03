import { NovaIDNotFoundError } from "novadatainterface/NovaDataInterface";


function resourceIDNotFoundStrict(message: string): never {
    debugger;
    throw new NovaIDNotFoundError(message);
}

function resourceIDNotFoundWarn(message: string): void {
    console.warn(message);
}


export { resourceIDNotFoundStrict, resourceIDNotFoundWarn }
