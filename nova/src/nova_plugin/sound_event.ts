import { EcsEvent } from 'nova_ecs/events';


export const SoundEvent = new EcsEvent<string /* id */>('WeaponFire');
