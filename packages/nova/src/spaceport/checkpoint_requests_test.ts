import 'jasmine';
import { Subscription } from 'rxjs';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import { makeShip } from '../nova_plugin/make_ship.js';
import {
    abortMission, startMissionById,
} from '../nova_plugin/mission_logic.js';
import { CreditsComponent, MissionsComponent } from '../nova_plugin/player_state_plugin.js';
import {
    CheckpointRequest, checkpointRequests, describeFlightChanges,
    describeOutfitChanges, missionEventLabel, truncateLabel,
} from './checkpoint_requests.js';
import { MissionSession } from './mission_session.js';
import { MissionUniverse } from './mission_universe.js';
import { displayName } from '../nova_plugin/display_name.js';

describe('checkpoint labels', () => {
    it('names mission events, and skips progress notices', () => {
        const label = (type: string) => missionEventLabel(
            { type: type as never, missionName: 'Delivery to Sirius' });
        expect(label('accepted')).toBe('Accepted: Delivery to Sirius');
        expect(label('completed')).toBe('Completed: Delivery to Sirius');
        expect(label('failed')).toBe('Failed: Delivery to Sirius');
        expect(label('aborted')).toBe('Aborted: Delivery to Sirius');
        expect(label('autoAborted')).toBe('Auto-aborted: Delivery to Sirius');
        expect(label('cargoLoaded')).toBeUndefined();
        expect(label('cargoDropped')).toBeUndefined();
        expect(label('shipDone')).toBeUndefined();
    });

    it('describes net outfit purchases and sales', () => {
        const names = new Map([
            ['nova:1', 'Battery Pack'], ['nova:2', 'Blaster'],
            ['nova:3', 'Fuel Tank'],
        ]);
        const nameOf = (id: string) => names.get(id);
        expect(describeOutfitChanges(
            [['nova:1', 1], ['nova:2', 2]],
            [['nova:1', 4], ['nova:2', 1], ['nova:3', 1]], nameOf))
            .toBe('Bought Battery Pack ×3, Fuel Tank ×1; Sold Blaster ×1');
        expect(describeOutfitChanges([['nova:1', 1]], [['nova:1', 1]], nameOf))
            .toBeUndefined();
        expect(describeOutfitChanges([], [], nameOf)).toBeUndefined();
        // Unknown names fall back to the id.
        expect(describeOutfitChanges([], [['plug:9', 1]], nameOf))
            .toBe('Bought plug:9 ×1');
    });

    it('truncates long labels with an ellipsis', () => {
        expect(truncateLabel('short')).toBe('short');
        const long = 'x'.repeat(200);
        expect(truncateLabel(long).length).toBe(72);
        expect(truncateLabel(long).endsWith('…')).toBeTrue();
    });

    it('describes in-flight captures and mission set changes', () => {
        const names = {
            shipName: (id: string) => id === 'nova:200' ? 'Pirate Valkyrie' : undefined,
            missionName: (id: string) => ({ 'm:1': 'Rescue', 'm:2': 'Escort' } as
                Record<string, string>)[id],
        };
        expect(describeFlightChanges(undefined,
            { ship: 'nova:200', missions: [] }, names)).toEqual([]);
        expect(describeFlightChanges(
            { ship: 'nova:100', missions: [['m:1', {}]] },
            { ship: 'nova:200', missions: [['m:2', {}]] }, names))
            .toEqual([
                { label: 'Captured Pirate Valkyrie', kind: 'capture' },
                { label: 'Accepted: Escort', kind: 'mission' },
                { label: 'Mission over: Rescue', kind: 'mission' },
            ]);
        expect(describeFlightChanges(
            { ship: 'nova:100', missions: [['m:1', {}]] },
            { ship: 'nova:100', missions: [['m:1', {}]] }, names)).toEqual([]);
    });
});

describe('MissionSession checkpoint announcements (real Nova data)', () => {
    let received: CheckpointRequest[];
    let subscription: Subscription;
    beforeEach(() => {
        received = [];
        subscription = checkpointRequests.subscribe(r => received.push(r));
    });
    afterEach(() => subscription.unsubscribe());

    async function dockedPilot(planetId: string,
        options?: { announceCheckpoints?: boolean }) {
        const gameData = await getIntegrationGameData();
        const universe = MissionUniverse.shared(gameData);
        await universe.load();
        const start = await gameData.data.PlayerStart.get('nova:128');
        const shipData = await gameData.data.Ship.get(start.ship);
        const entity = makeShip(shipData);
        entity.components.set(CreditsComponent, { credits: 100000 });
        const session = await MissionSession.create(
            entity, gameData, universe, planetId, options);
        return { gameData, universe, entity, session };
    }

    /** A stock mission that a scripted start can resolve from Earth. */
    async function startableMission(universe: MissionUniverse,
        session: MissionSession): Promise<string> {
        for (const { id } of universe.missions) {
            startMissionById(session.machinery, id, session.outfits);
            if (session.state.missions.has(id)) {
                return id;
            }
        }
        throw new Error('No startable stock mission');
    }

    it('announces accept and abort with the committed entity, once each',
        async () => {
            const { universe, entity, session } = await dockedPilot('nova:128');
            const id = await startableMission(universe, session);
            const name = displayName(universe.getMission(id)!.name);

            session.commit();
            expect(received.length).toBe(1);
            expect(received[0].label).toBe(`Accepted: ${name}`);
            expect(received[0].kind).toBe('mission');
            expect(received[0].entity).toBe(entity);
            expect(received[0].stellar).toBe('nova:128');
            // The entity already holds the accepted mission when the
            // request goes out (announced after the write).
            expect(entity.components.get(MissionsComponent)!.has(id)).toBeTrue();

            // A second commit re-returns the same events but announces
            // nothing new.
            session.commit();
            expect(received.length).toBe(1);

            abortMission(session.machinery, id, session.outfits);
            session.commit();
            expect(received.length).toBe(2);
            expect(received[1].label).toBe(`Aborted: ${name}`);
        });

    it('leaves the stellar out for a placeholder planet id', async () => {
        const { universe, session } = await dockedPilot('<outfitter>');
        await startableMission(universe, session);
        session.commit();
        expect(received.length).toBe(1);
        expect(received[0].stellar).toBeUndefined();
    });

    it('announces nothing when the session opts out (detached copies)',
        async () => {
            const { universe, session } = await dockedPilot('nova:128',
                { announceCheckpoints: false });
            await startableMission(universe, session);
            session.commit();
            expect(received).toEqual([]);
        });
});
