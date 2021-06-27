import { EcsEvent } from 'nova_ecs/events';

export const ResizeEvent = new EcsEvent<{ x: number, y: number }>('Resize');
