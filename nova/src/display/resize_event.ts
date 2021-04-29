import { EcsEvent } from 'nova_ecs/events';

export const ResizeEvent = new EcsEvent<readonly [number, number]>('Resize');
