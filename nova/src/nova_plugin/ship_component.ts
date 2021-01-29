import { Component } from 'nova_ecs/component';
import * as t from 'io-ts';
import { applyObjectDelta, getObjectDelta } from 'novajs/nova_ecs/plugins/delta';

const ShipType = {
    id: t.string
};

export const ShipComponent = new Component({
    name: 'Ship',
    type: t.type(ShipType),
    deltaType: t.partial(ShipType),
    getDelta: getObjectDelta,
    applyDelta: applyObjectDelta
});
