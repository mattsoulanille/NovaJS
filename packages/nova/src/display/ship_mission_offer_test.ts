import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { World } from 'nova_ecs/world';
import { BoardingState } from '../nova_plugin/ship/boarding_component.js';
import { DisabledComponent } from '../nova_plugin/ship/disabled_component.js';
import { GovtComponent } from '../nova_plugin/core/govt_component.js';
import { NpcComponent } from '../nova_plugin/npc/npc_ai_plugin.js';
import { PlayerShipSelector } from '../nova_plugin/player/player_ship_plugin.js';
import { TargetComponent } from '../nova_plugin/ship/target_component.js';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import { showsHailQuote } from '../spaceport/ship_mission_offer.js';
import { boardingDialogPhase } from './boarding_plugin.js';
import { shipOfferGates } from './ship_mission_offer_plugin.js';

/**
 * The display side of a ship-offered mission: which dialog owns the
 * screen when you board a përs, and what the world says about the four
 * encounter conditions a përs hail quote is gated on.
 *
 * Both halves are the pure ones — the PIXI widgets around them are
 * driven by the visual harness, not from here (the same split
 * boarding_dialog_test uses for plunderDialogContent).
 */

const NOTHING_TAKEN = {
    cargoTaken: false, creditsTaken: false, fuelTaken: false,
    ammoTaken: false, crimeApplied: false,
};

function boardingState(overrides: Partial<BoardingState> = {}): BoardingState {
    return {
        target: 'victim', creditsAvailable: 0, ammoAvailable: 0,
        capture: 'none', ...NOTHING_TAKEN, ...overrides,
    };
}

describe('which dialog a boarding shows', () => {
    it('shows nothing without a session', () => {
        expect(boardingDialogPhase(undefined, false)).toEqual('none');
        // Even mid-offer: no session, no dialogs.
        expect(boardingDialogPhase(undefined, true)).toEqual('none');
    });

    it('shows the mission offer INSTEAD OF the plunder dialog', () => {
        // përs Flags 0x0200's whole point, and what the stock text needs:
        // mïsn 134's offer opens "You match velocities with the derelict
        // ship and dock with it..." — it IS the boarding, so nothing
        // comes before it and nothing comes after it.
        expect(boardingDialogPhase(boardingState(), true)).toEqual('offer');
        // Answered: the boarding is over. This is Matthew's nit — the
        // plunder dialog used to slide up behind the mission text.
        expect(boardingDialogPhase(boardingState(), false, true))
            .toEqual('offerOnly');
        expect(boardingDialogPhase(boardingState(), false))
            .toEqual('plunder');
    });

    it('holds even the capture-assignment dialog back', () => {
        // A capture and an offer cannot both own the keyboard.
        expect(boardingDialogPhase(
            boardingState({ capture: 'succeeded' }), true)).toEqual('offer');
        expect(boardingDialogPhase(
            boardingState({ capture: 'succeeded' }), false))
            .toEqual('capture');
    });

    it('suppresses the capture dialog too once an offer was made', () => {
        // Unreachable in practice (no capture attempt can happen while
        // the offer owns the keyboard), but the rule is "the offer is the
        // whole boarding", not "the offer beats the plunder table".
        expect(boardingDialogPhase(
            boardingState({ capture: 'succeeded' }), false, true))
            .toEqual('offerOnly');
    });

    it('falls through to the plunder dialog for an ordinary hulk', () => {
        // The overwhelmingly common case: no përs, no mission, so the
        // offer attempt resolves false, `offerMade` stays false, and
        // nothing changes.
        expect(boardingDialogPhase(boardingState({ capture: 'failed' }),
            false)).toEqual('plunder');
        // ...including the SECOND boarding of a derelict whose offer has
        // been spent: presentShipOffer refuses (ShipOfferSpentComponent),
        // so the hulk it handed the plunder back to is robbable now.
        expect(boardingDialogPhase(boardingState(), false, false))
            .toEqual('plunder');
    });
});

describe('shipOfferGates (what the world says about a përs)', () => {
    /** A world with a player and one other ship. */
    function makeWorld(target: Entity) {
        const world = new World();
        const player = new Entity('player');
        player.components.set(PlayerShipSelector, undefined);
        world.entities.set('player', player);
        world.entities.set('target', target);
        return world;
    }

    it('reads "disabled" off the same component the hulk carries',
        async () => {
            const gameData = await getIntegrationGameData();
            const adrift = new Entity('derelict');
            adrift.components.set(DisabledComponent,
                { repairAt: null, hulk: true });
            expect((await shipOfferGates(makeWorld(adrift), adrift,
                gameData)).disabled).toBeTrue();
            const flying = new Entity('trader');
            expect((await shipOfferGates(makeWorld(flying), flying,
                gameData)).disabled).toBeFalse();
        });

    it('calls a ship attacking the PLAYER attacking, and nothing else',
        async () => {
            const gameData = await getIntegrationGameData();
            const attacker = new Entity('pirate');
            attacker.components.set(TargetComponent, { target: 'player' });
            attacker.components.set(NpcComponent,
                { mode: 'attack', departAt: 1e15 } as never);
            const attacking = await shipOfferGates(makeWorld(attacker),
                attacker, gameData);
            expect(attacking.attackingPlayer).toBeTrue();
            // The grudge gate has no durable state to read and is
            // approximated by the same fact (see the plugin's note).
            expect(attacking.holdsGrudge).toBeTrue();

            // Attacking somebody ELSE is not attacking you.
            const busy = new Entity('pirate');
            busy.components.set(TargetComponent, { target: 'someone else' });
            busy.components.set(NpcComponent,
                { mode: 'attack', departAt: 1e15 } as never);
            expect((await shipOfferGates(makeWorld(busy), busy, gameData))
                .attackingPlayer).toBeFalse();
        });

    it('says a Civvies trader likes a player with no government',
        async () => {
            // gövt 157 (Civvies) flies every Refuel Trader and every
            // Escort Merchant. Their përs all set 0x0008 ("HailQuote only
            // shown when ship likes player"), so if "likes" meant ALLIED
            // — which Civvies is with nobody the player can join — none of
            // those 141 quotes would ever be heard.
            const gameData = await getIntegrationGameData();
            const trader = new Entity('trader');
            trader.components.set(GovtComponent, { id: 'nova:157' });
            const gates = await shipOfferGates(makeWorld(trader), trader,
                gameData);
            expect(gates.likesPlayer).toBeTrue();

            const pers = await gameData.data.Pers.get('nova:225');
            expect(pers.govt).toEqual('nova:157');
            expect(pers.flags.hailOnlyWhenLikesPlayer).toBeTrue();
            expect(showsHailQuote(pers, {
                ...gates, missionAvailable: true, alreadyShown: false,
            })).toBeTrue();
        });

    it('says a xenophobic government does NOT like the player',
        async () => {
            // gövt 141 is the Wild Geese... the point is only that a
            // hostile disposition turns the gate off, whichever govt it
            // comes from; alwaysAttacksPlayer / xenophobic are the two
            // flags shipDisposition reads without any legal record.
            const gameData = await getIntegrationGameData();
            const ids = await gameData.ids;
            let hostileGovt: string | undefined;
            for (const id of [...ids.Govt].sort()) {
                const govt = await gameData.data.Govt.get(id);
                if (govt.flags.xenophobic || govt.flags.alwaysAttacksPlayer) {
                    hostileGovt = id;
                    break;
                }
            }
            expect(hostileGovt).toBeDefined();
            const xeno = new Entity('xenophobe');
            xeno.components.set(GovtComponent, { id: hostileGovt! });
            expect((await shipOfferGates(makeWorld(xeno), xeno, gameData))
                .likesPlayer).toBeFalse();
        });
});
