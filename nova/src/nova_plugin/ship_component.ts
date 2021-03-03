import { Component } from 'nova_ecs/component';
import * as t from 'io-ts';
import { applyObjectDelta, getObjectDelta } from 'nova_ecs/plugins/delta';
import { ProvideAsync } from 'nova_ecs/provider';
import { ShipData } from "novadatainterface/ShipData";
import { GameDataResource } from './game_data_resource';

const ShipType = {
    id: t.string // Not a UUID. A nova id.
};

export const ShipComponent = new Component({
    name: 'Ship',
    type: t.type(ShipType),
    deltaType: t.partial(ShipType),
    getDelta: getObjectDelta,
    applyDelta: applyObjectDelta
});


export const ShipDataComponent = new Component<ShipData>({ name: 'ShipData' });

export const ShipDataProvider = ProvideAsync({
    provided: ShipDataComponent,
    args: [GameDataResource, ShipComponent] as const,
    factory: async (gameData, ship) => {
        return await gameData.data.Ship.get(ship.id);
    }
});
