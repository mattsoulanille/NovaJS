import * as t from 'io-ts';
import { Component } from "nova_ecs/component";


export const Target = t.type({
    target: t.union([t.string, t.undefined]),
});

export type Target = t.TypeOf<typeof Target>;

export const TargetComponent = new Component<Target>('TargetComponent');


