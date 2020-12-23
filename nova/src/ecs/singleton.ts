import { Component } from "./component";
import * as t from 'io-ts';

export const Singleton = new Component({
    name: 'singleton',
    type: t.undefined,
    getDelta: () => undefined,
    applyDelta: () => undefined,
});
