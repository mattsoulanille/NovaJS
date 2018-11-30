import { BaseData, DefaultBaseData } from "./BaseData";



interface SystemData extends BaseData {
    position: [number, number],
    links: Array<string>
}

const DefaultSystemData: SystemData = {
    ...DefaultBaseData,
    position: [0, 0],
    links: []
}

export { SystemData, DefaultSystemData }
