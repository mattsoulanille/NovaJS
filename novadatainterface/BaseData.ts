export interface BaseData {
    name: string;
    id: string;
    prefix: string;
}

export function getDefaultBaseData(): BaseData {
    return {
        name: "default",
        id: "default",
        prefix: "default",
    }
}
