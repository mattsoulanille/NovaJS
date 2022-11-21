import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';
import { map } from 'nova_ecs/datatypes/map';
import { DefaultMap } from 'nova_ecs/utils';

const WeaponState = t.intersection([t.type({
    count: t.number,
    firing: t.boolean,
}), t.partial({
    target: t.string,
})]);
export type WeaponState = t.TypeOf<typeof WeaponState>;


function makeWeaponState() {
    return {
        count: 0,
        firing: false,
    };
}

export function makeWeaponsState(entries: Array<[string, WeaponState]> = []) {
    return new DefaultMap<string, WeaponState>(makeWeaponState, entries);
}

export const WeaponsState = map(t.string /* weapon id */, WeaponState,
                                makeWeaponsState);
export type WeaponsState = t.TypeOf<typeof WeaponsState>;
export const WeaponsStateComponent = new Component<WeaponsState>('WeaponsStateComponent');
