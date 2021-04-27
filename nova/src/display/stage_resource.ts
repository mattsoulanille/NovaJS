import { Resource } from "nova_ecs/resource";
import * as PIXI from "pixi.js";

export const Stage = new Resource<PIXI.Container>('Stage');
