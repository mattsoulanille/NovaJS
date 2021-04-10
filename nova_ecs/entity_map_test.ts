import produce from "immer";
import "jasmine";
import { Component } from "./component";
import { ComponentMap } from "./component_map";
import { EntityBuilder } from "./entity";
import { EntityMap, EntityMapWrapped } from './entity_map';

const BarComponent = new Component<{ y: string }>('bar');

describe('entity map', () => {
    it('keeps subscriptions between drafts', () => {
        const wrapped = new EntityMapWrapped();
        const setEvents: [string, string?][] = [];
        wrapped.events.set.subscribe(([uuid, entity]) => {
            setEvents.push([uuid, entity.components.get(BarComponent)?.y]);
        });
        wrapped.set('entity', new EntityBuilder()
            .addComponent(BarComponent, { y: 'hello' })
            .build());

        const wrapped2 = produce(wrapped, draft => {
            draft.set('entity', new EntityBuilder()
                .addComponent(BarComponent, { y: 'bye' }));
        });

        expect(wrapped.get('entity')?.components.get(BarComponent)?.y)
            .toEqual('hello');
        expect(wrapped2.get('entity')?.components.get(BarComponent)?.y)
            .toEqual('bye');

        expect(setEvents).toEqual([
            ['entity', 'hello'],
            ['entity', 'bye']
        ]);
    });
});

