import { EcsEvent } from 'nova_ecs/events';


export const SoundEvent = new EcsEvent<{ id: string, loop?: boolean }>('WeaponFire');
