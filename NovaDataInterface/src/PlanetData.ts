
import { SpaceObjectData, DefaultSpaceObjectData } from "./SpaceObjectData";
import { DamageType } from "./WeaponData";

interface PlanetData extends SpaceObjectData {
    landingPict: string,
    landingDesc: string,
    position: [number, number]
}

const DefaultPlanetData = {
    ...DefaultSpaceObjectData,
    vulnerableTo: <Array<DamageType>>["planetBuster"]
}

export { PlanetData, DefaultPlanetData }
