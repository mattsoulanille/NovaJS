interface BaseData {
    name: string;
    id: string;
    prefix: string;
}


const DefaultBaseData: BaseData = {
    name: "default",
    id: "default",
    prefix: "default"
}

export { BaseData, DefaultBaseData };
