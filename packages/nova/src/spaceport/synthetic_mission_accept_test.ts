import 'jasmine';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { getSyntheticGameData } from '../communication/simulation_test_fixture.js';
import { CargoComponent, makeShip } from '../nova_plugin/ship/index.js';
import { acceptOffer } from '../nova_plugin/missions/index.js';
import { ControlBitsComponent } from '../nova_plugin/ncb/index.js';
import {
    CreditsComponent, GameDateComponent, MissionsComponent,
} from '../nova_plugin/player/index.js';
import { MissionSession } from './mission_session.js';
import { rollOffers } from './mission_offers.js';
import { MissionUniverse } from './mission_universe.js';

/**
 * A mission taken off the mission computer, end to end on the synthetic
 * data set: the default pilot docks at Port Amberline, the board rolls
 * the scenario's jobs, and accepting the courier run makes it active,
 * loads its cargo and runs its OnAccept set string — the b100 the
 * scenario gives it — through the same MissionSession working-copy and
 * commit the spaceport uses.
 */
describe('accepting a mission-computer job on the synthetic data set', () => {
    async function docked() {
        const gameData = await getSyntheticGameData();
        const universe = MissionUniverse.shared(gameData);
        await universe.load();
        const start = await gameData.data.PlayerStart.get(SYNTHETIC.playerStart);
        const entity = makeShip(await gameData.data.Ship.get(start.ship));
        entity.components.set(GameDateComponent, { ...start.date });
        entity.components.set(CreditsComponent, { credits: start.credits });
        entity.components.set(ControlBitsComponent, new Set());
        entity.components.set(MissionsComponent, new Map());
        entity.components.set(CargoComponent, new Map());
        const session = await MissionSession.create(
            entity, gameData, universe, SYNTHETIC.planets.port);
        return { entity, universe, session };
    }

    it('offers the courier run and the bounty from the mission computer, '
        + 'and the survey from the bar', async () => {
            const { session, universe } = await docked();
            const board = rollOffers(session, universe, 0);
            expect(board.map(offer => offer.data.id))
                .toEqual([SYNTHETIC.missions.courier, SYNTHETIC.missions.bounty]);
            const bar = rollOffers(session, universe, 1);
            expect(bar.map(offer => offer.data.id))
                .toEqual([SYNTHETIC.missions.gateSurvey]);
            // The courier run resolved its stellars against the scenario.
            const courier = board[0];
            expect(courier.travelPlanet).toEqual(SYNTHETIC.planets.moon);
            expect(courier.returnPlanet).toEqual(SYNTHETIC.planets.port);
            expect(courier.cargoType).toEqual(0);
            expect(courier.cargoQty).toEqual(10);
            expect(courier.acceptable).toBeTrue();
        });

    it('makes the accepted job active, loads its cargo and sets its bit '
        + 'on commit', async () => {
            const { entity, session, universe } = await docked();
            const [courier] = rollOffers(session, universe, 0);
            const result = acceptOffer(session.machinery, courier, session.outfits);
            expect(result.accepted).toBeTrue();

            // In the working copy, not yet on the entity...
            expect(session.state.missions.has(SYNTHETIC.missions.courier)).toBeTrue();
            expect(session.state.bits.has(SYNTHETIC.bits.courierAccepted)).toBeTrue();
            expect(entity.components.get(MissionsComponent)!.size).toBe(0);

            // ...until the visit commits.
            session.commit();
            const active = entity.components.get(MissionsComponent)!
                .get(SYNTHETIC.missions.courier);
            expect(active).toBeDefined();
            expect(active!.cargoLoaded).toBeTrue();
            expect(active!.travelPlanet).toEqual(SYNTHETIC.planets.moon);
            expect(entity.components.get(ControlBitsComponent)!
                .has(SYNTHETIC.bits.courierAccepted)).toBeTrue();
            // Ten tons of the standard cargo the job carries.
            const cargo = [...entity.components.get(CargoComponent)!.values()];
            expect(cargo.reduce((a, b) => a + b, 0)).toEqual(10);
            // Nothing is paid at accept.
            expect(entity.components.get(CreditsComponent)!.credits).toEqual(25000);
        });

    it('stops offering a job whose AvailBits its own OnAccept falsified',
        async () => {
            const { session, universe } = await docked();
            const [courier] = rollOffers(session, universe, 0);
            acceptOffer(session.machinery, courier, session.outfits);
            // `!b100` in the courier run's AvailBits, now that b100 is set.
            expect(rollOffers(session, universe, 0).map(offer => offer.data.id))
                .toEqual([SYNTHETIC.missions.bounty]);
        });
});
