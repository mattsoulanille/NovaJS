import { Application } from "@pixi/app";
import { Resource } from "nova_ecs/resource";


export const PixiAppResource = new Resource<Application>('PixiAppResource');
