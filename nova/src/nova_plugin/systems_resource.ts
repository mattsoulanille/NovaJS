import { Resource } from "nova_ecs/resource";
import { World } from "nova_ecs/world";

export const SystemsResource = new Resource<Map<string, World>>('SystemsResource');
