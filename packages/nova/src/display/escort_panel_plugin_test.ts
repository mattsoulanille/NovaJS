import 'jasmine';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { Entity } from 'nova_ecs/entity';
import { World } from 'nova_ecs/world';
import { BayFighterComponent } from '../nova_plugin/escorts/index.js';
import { FormationComponent } from '../nova_plugin/npc/index.js';
import { EscortCommandComponent, EscortCommandState, PlayerShipSelector } from '../nova_plugin/player/index.js';
import { ShipComponent, ShipDataComponent } from '../nova_plugin/ship/index.js';
import { installHeadlessPixi } from '../spaceport/headless_pixi_fixture.js';
import { playerEscortEntries } from './escort_panel_plugin.js';

function ship(escortType: number, leader?: string,
    command?: EscortCommandState): Entity {
    const entity = new Entity();
    entity.components.set(ShipComponent, { id: `test:${escortType}` });
    entity.components.set(ShipDataComponent,
        { ...getDefaultShipData(), escortType, inherentAI: 3 });
    if (leader) {
        entity.components.set(FormationComponent, { leader, slot: 0 });
    }
    if (command) {
        entity.components.set(EscortCommandComponent, command);
    }
    return entity;
}

describe('the escort panel\'s escort list', () => {
    beforeAll(() => installHeadlessPixi());

    it('is the local player\'s DIRECT escorts, by category and order', () => {
        const world = new World();
        const player = ship(2);
        player.components.set(PlayerShipSelector, undefined);
        world.entities.set('player', player);
        world.entities.set('rival', ship(2));
        world.entities.set('warship', ship(2, 'player',
            { command: 'holdPosition' }));
        const fighter = ship(-1, 'player', { command: 'formation' });
        fighter.components.set(BayFighterComponent, { bayWeaponId: 'bay' });
        world.entities.set('fighter', fighter);
        // A wing of the warship: the player never orders it directly.
        world.entities.set('wing', ship(0, 'warship', { command: 'formation' }));
        // Another player's escort.
        world.entities.set('theirs', ship(3, 'rival', { command: 'defend' }));
        // An NPC fleet member in formation on the player has no order.
        world.entities.set('npc', ship(1, 'player'));

        expect(playerEscortEntries(world).sort((a, b) =>
            a.category < b.category ? -1 : 1)).toEqual([
                { category: 'fighter', command: 'formation' },
                { category: 'warship', command: 'holdPosition' },
            ]);
    });

    it('is empty with no player ship', () => {
        const world = new World();
        world.entities.set('warship', ship(2, 'player', { command: 'formation' }));
        expect(playerEscortEntries(world)).toEqual([]);
    });
});
