import { Resource } from "nova_ecs/resource";
import * as PIXI from "pixi.js";

export const Space = new Resource<PIXI.Container>('SpaceContainer');
