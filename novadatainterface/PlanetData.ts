
import { SpaceObjectData, DefaultSpaceObjectData } from "./SpaceObjectData";
import { DamageType } from "./WeaponData";

interface PlanetData extends SpaceObjectData {
    landingPict: string,
    landingDesc: string,
    position: [number, number]
}

const DefaultPlanetData: PlanetData = {
    ...DefaultSpaceObjectData,
    vulnerableTo: <Array<DamageType>>["planetBuster"],
    landingPict: "default",
    landingDesc: "default",
    position: [0, 0]
}

export { PlanetData, DefaultPlanetData }
