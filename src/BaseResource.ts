interface BaseResource {
    name: string;
    id: string;
    prefix: string;
}


const DefaultBaseResource: BaseResource = {
    name: "default",
    id: "default",
    prefix: "default"
}

export { BaseResource, DefaultBaseResource };
