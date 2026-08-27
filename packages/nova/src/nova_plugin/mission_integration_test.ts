import 'jasmine';
import { MissionData } from 'novadatainterface/mission_data';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import { MissionSession, advanceEntityDate, processEntityLanding } from '../spaceport/mission_session.js';
import { MissionUniverse } from '../spaceport/mission_universe.js';
import { dayNumber, daysPerJump } from './calendar.js';
import { CargoComponent } from './cargo_plugin.js';
import { makeShip } from './make_ship.js';
import {
    acceptOffer,
    LOCATION_BAR,
    LOCATION_SHIP,
    LOCATION_MAIN_SPACEPORT,
    LOCATION_MISSION_COMPUTER,
    makeMissionOffer,
    matchesStellarRef,
    MissionOffer,
    missionMatchesLocation,
    stellarVisible,
} from './mission_logic.js';
import { offerSubstitutions, rollOffers } from '../spaceport/mission_offers.js';
import { expandMissionText } from './mission_text.js';
import { buildMissionShipSpawns } from './mission_ship_spawn.js';
import { GOAL_DESTROY, goalSupported } from './mission_ship_state.js';
import { shipGoalOfferable } from './mission_ship_logic.js';
import { ControlBitsComponent } from './ncb_plugin.js';
import { CombatRatingComponent } from './reputation_plugin.js';
import {
    CreditsComponent,
    GameDateComponent,
    MissionsComponent,
    PendingMissionNoticesComponent,
} from './player_state_plugin.js';

/**
 * Drives a real stock-scenario delivery mission — nova:128 "Delivery
 * to Earth" (a mission-computer random-cargo delivery paying 15,000
 * credits at Earth) — through the real data pipeline and the real
 * mission machinery: offer at an inhabited stellar, accept (cargo
 * loaded, OnAccept run), jump-equivalent date advancement, landing at
 * Earth (completion, payment, cargo removal).
 */
describe('missions against real Nova data', () => {
    it('parses the "Delivery to Earth" mission (nova:128)', async () => {
        const gameData = await getIntegrationGameData();
        const misn = await gameData.data.Mission.get('nova:128');
        expect(misn.name).toContain('Delivery to Earth');
        expect(misn.availLoc).toBe(LOCATION_MISSION_COMPUTER);
        expect(misn.availStel).toBe(-1);       // any inhabited stellar
        expect(misn.returnStel).toBe(128);     // Earth
        expect(misn.returnStelId).toBe('nova:128');
        expect(misn.cargoType).toBe(1000);     // random standard type
        expect(misn.cargoQty).toBe(-5);        // 5 tons ± 50%
        expect(misn.payVal).toBe(15000);
        expect(misn.availBits).toBe('!(b511 | b515) & !b350');
        expect(misn.offerText).toContain('Take <CQ> tons of <CT> to <RST>');
    });

    it('exposes mission, cron, and player-start ids', async () => {
        const gameData = await getIntegrationGameData();
        const ids = await gameData.ids;
        // Exact stock counts: tests parse base "Nova Files" only, so
        // these are fixed. (They read far higher with plug-ins loaded,
        // which is exactly the portability problem the fixture avoids.)
        expect(ids.Mission.length).toBe(791);
        expect(ids.Cron.length).toBe(125);
        expect(ids.PlayerStart).toEqual(['nova:128']);
    });

    it('parses the default chär (nova:128) player start', async () => {
        const gameData = await getIntegrationGameData();
        const start = await gameData.data.PlayerStart.get('nova:128');
        expect(start.credits).toBe(25000);
        expect(start.ship).toBe('nova:128'); // Shuttle
        expect(start.date).toEqual({ day: 23, month: 6, year: 1177 });
        expect(start.isDefault).toBe(true);
        expect(start.systems.length).toBeGreaterThan(0);
    });

    it('runs accept -> jump -> land -> complete end to end', async () => {
        const gameData = await getIntegrationGameData();
        const universe = MissionUniverse.shared(gameData);
        await universe.load();

        // A fresh default pilot in a Shuttle.
        const start = await gameData.data.PlayerStart.get('nova:128');
        const shipData = await gameData.data.Ship.get(start.ship);
        const entity = makeShip(shipData);
        entity.components.set(GameDateComponent, { ...start.date });
        entity.components.set(CreditsComponent, { credits: start.credits });
        entity.components.set(ControlBitsComponent, new Set());

        // Docked somewhere inhabited that isn't Earth.
        const dockedAt = universe.stellarCandidates.find(
            s => !s.uninhabited && s.canLand && s.id !== 'nova:128')!;
        expect(dockedAt).toBeDefined();

        const session = await MissionSession.create(
            entity, gameData, universe, dockedAt.id);
        const mission = universe.getMission('nova:128')!;
        const ctx = session.machinery.offerContext();
        expect(missionMatchesLocation(mission,
            LOCATION_MISSION_COMPUTER, ctx)).toBe(true);

        const maybeOffer = makeMissionOffer(mission, ctx);
        expect(maybeOffer === null).toBe(false);
        const offer = maybeOffer!;
        expect(offer.acceptable).toBe(true);
        expect(offer.returnPlanet).toBe('nova:128');
        expect(offer.cargoQty).toBeGreaterThanOrEqual(3);
        expect(offer.cargoQty).toBeLessThanOrEqual(8);

        acceptOffer(session.machinery, offer, session.outfits);
        session.commit();

        const active = entity.components.get(MissionsComponent)!
            .get('nova:128')!;
        expect(active).toBeDefined();
        expect(active.cargoLoaded).toBe(true);
        expect(entity.components.get(CargoComponent)!
            .get('mission:nova:128')).toBe(offer.cargoQty);

        // The jump to Sol: a Shuttle is under 100 tons, so one day.
        const startDay = dayNumber(
            entity.components.get(GameDateComponent)!);
        expect(daysPerJump(shipData.physics.mass)).toBe(1);
        await advanceEntityDate(entity,
            daysPerJump(shipData.physics.mass), universe);
        expect(dayNumber(entity.components.get(GameDateComponent)!))
            .toBe(startDay + 1);

        // Land on Earth: the mission completes and pays. (Landing
        // advances another day.)
        const creditsBefore =
            entity.components.get(CreditsComponent)!.credits;
        const events = await processEntityLanding(
            entity, gameData, universe, 'nova:128');
        const completed = events.find(e => e.type === 'completed');
        expect(completed).toBeDefined();
        expect(completed!.missionId).toBe('nova:128');
        expect(completed!.payment).toBe(15000);
        expect(entity.components.get(CreditsComponent)!.credits)
            .toBe(creditsBefore + 15000);
        expect(entity.components.get(MissionsComponent)!.size).toBe(0);
        expect(entity.components.get(CargoComponent)!
            .has('mission:nova:128')).toBe(false);
        expect(dayNumber(entity.components.get(GameDateComponent)!))
            .toBe(startDay + 2);
    });

    /**
     * The kont-probe mission the reference screenshots show being offered
     * on landing at Kiniké (spaceport/kiniké_kont_probe_mission_offer_in_
     * spaceport*.png) is nova:830 "Launch Exploration Probe". Its AvailLoc
     * is 1 (the BAR), not the main spaceport — so our bar already offers
     * it; the reference documents the original presenting a bar offer as a
     * popup on landing. Pinned so a data change that moves it is caught.
     */
    it('pins the kont-probe reference mission (nova:830) as a bar offer',
        async () => {
            const gameData = await getIntegrationGameData();
            const misn = await gameData.data.Mission.get('nova:830');
            expect(misn.name).toContain('Launch Exploration Probe');
            expect(misn.availLoc).toBe(LOCATION_BAR);
            expect(misn.payVal).toBe(50000);
            expect(misn.returnStelId).toBe('nova:128');
            expect(misn.offerText).toContain('probe launch');
        });

    /**
     * The main-spaceport (AvailLoc 3) offers the spaceport now presents on
     * landing. nova:251 "Head to Sol" (Tutorial 001) is an AvailLoc-3
     * mission available at any Federation stellar (AvailStel 10000) to a
     * fresh pilot (AvailBits !(b9200|b9215), AvailRandom 100), so it rolls
     * at Earth. It must roll for the SPACEPORT location and not for the
     * mission computer; the mission-computer delivery (nova:128) must not
     * roll for the spaceport; and accepting commits the mission.
     */
    it('rolls AvailLoc-3 offers on landing, not on the BBS, and commits '
        + 'an accept', async () => {
        const gameData = await getIntegrationGameData();
        const universe = MissionUniverse.shared(gameData);
        await universe.load();

        const tutorial = await gameData.data.Mission.get('nova:251');
        expect(tutorial.availLoc).toBe(LOCATION_MAIN_SPACEPORT);

        // A fresh default pilot, docked at Earth (a Federation stellar).
        const start = await gameData.data.PlayerStart.get('nova:128');
        const shipData = await gameData.data.Ship.get(start.ship);
        const entity = makeShip(shipData);
        entity.components.set(GameDateComponent, { ...start.date });
        entity.components.set(CreditsComponent, { credits: start.credits });
        entity.components.set(ControlBitsComponent, new Set());

        const session = await MissionSession.create(
            entity, gameData, universe, 'nova:128');

        const spaceportOffers = rollOffers(
            session, universe, LOCATION_MAIN_SPACEPORT);
        const computerOffers = rollOffers(
            session, universe, LOCATION_MISSION_COMPUTER);

        // The tutorial mission rolls at the spaceport, never on the BBS.
        expect(spaceportOffers.some(o => o.data.id === 'nova:251')).toBe(true);
        expect(computerOffers.some(o => o.data.id === 'nova:251')).toBe(false);
        // The mission-computer delivery (nova:128) never rolls at the
        // spaceport — the locations are disjoint.
        expect(spaceportOffers.some(o => o.data.id === 'nova:128'))
            .toBe(false);

        // Accepting a spaceport offer commits the mission to the entity.
        const offer = spaceportOffers.find(o => o.data.id === 'nova:251')!;
        expect(offer.acceptable).toBe(true);
        acceptOffer(session.machinery, offer, session.outfits);
        session.commit();
        expect(entity.components.get(MissionsComponent)!.has('nova:251'))
            .toBe(true);
    });

    /**
     * The completion popup the "_succeed" references show is driven by the
     * completion event's dësc text. The end-to-end delivery (nova:128)
     * completes on landing at Earth; its completion event must carry the
     * completion dësc so the popup (and the notices summary) have content.
     */
    it('surfaces a completion event with dësc text on landing', async () => {
        const gameData = await getIntegrationGameData();
        const universe = MissionUniverse.shared(gameData);
        await universe.load();

        const start = await gameData.data.PlayerStart.get('nova:128');
        const shipData = await gameData.data.Ship.get(start.ship);
        const entity = makeShip(shipData);
        entity.components.set(GameDateComponent, { ...start.date });
        entity.components.set(CreditsComponent, { credits: start.credits });
        entity.components.set(ControlBitsComponent, new Set());

        const dockedAt = universe.stellarCandidates.find(
            s => !s.uninhabited && s.canLand && s.id !== 'nova:128')!;
        const session = await MissionSession.create(
            entity, gameData, universe, dockedAt.id);
        const offer = makeMissionOffer(universe.getMission('nova:128')!,
            session.machinery.offerContext())!;
        acceptOffer(session.machinery, offer, session.outfits);
        session.commit();

        await advanceEntityDate(entity,
            daysPerJump(shipData.physics.mass), universe);
        const events = await processEntityLanding(
            entity, gameData, universe, 'nova:128');
        const completed = events.find(e => e.type === 'completed');
        expect(completed).toBeDefined();
        // The dësc text that the popup renders (the completion frame).
        expect(completed!.text.length).toBeGreaterThan(0);
    });

    /**
     * nova:657 "Defeat Fellow Initiates" (Auroran 005): destroy 4
     * ships from düde nova:240 in sÿst nova:329, offered in the bar
     * on Heraan (nova:360) to a pilot with bits b204 & b511; return
     * to Heraan; OnSuccess sets b205.
     */
    it('offers a real destroy mission and gates completion on the goal',
        async () => {
            const gameData = await getIntegrationGameData();
            const universe = MissionUniverse.shared(gameData);
            await universe.load();

            const start = await gameData.data.PlayerStart.get('nova:128');
            const shipData = await gameData.data.Ship.get(start.ship);
            const entity = makeShip(shipData);
            entity.components.set(GameDateComponent, { ...start.date });
            entity.components.set(CreditsComponent, { credits: 0 });
            entity.components.set(ControlBitsComponent,
                new Set([204, 511]));
            // nova:657 requires AvailRating 150; give the test pilot
            // enough kill points to qualify (reputations gate offers).
            entity.components.set(CombatRatingComponent, { kills: 150 });

            const session = await MissionSession.create(
                entity, gameData, universe, 'nova:360');
            const mission = universe.getMission('nova:657')!;
            const ctx = session.machinery.offerContext();
            expect(missionMatchesLocation(mission, LOCATION_BAR, ctx))
                .toBe(true);

            const offer = makeMissionOffer(mission, ctx)!;
            expect(offer).not.toBeNull();
            expect(offer.shipObjective).toEqual(jasmine.objectContaining({
                goal: GOAL_DESTROY,
                systemId: 'nova:329',
                dudeId: 'nova:240',
                total: 4,
                satisfied: 0,
                complete: false,
            }));

            acceptOffer(session.machinery, offer, session.outfits);
            session.commit();
            const active = entity.components.get(MissionsComponent)!
                .get('nova:657')!;
            expect(active.shipObjective).toBeDefined();

            // Landing back at Heraan with the goal incomplete must
            // NOT complete the mission.
            let events = await processEntityLanding(
                entity, gameData, universe, 'nova:360');
            expect(events.find(e => e.type === 'completed'))
                .toBeUndefined();
            expect(entity.components.get(MissionsComponent)!
                .has('nova:657')).toBe(true);

            // The shared sim reports all four ships destroyed.
            const objective = entity.components.get(MissionsComponent)!
                .get('nova:657')!.shipObjective!;
            objective.satisfied = 4;
            objective.complete = true;
            objective.shipDonePending = true;

            events = await processEntityLanding(
                entity, gameData, universe, 'nova:360');
            const completed = events.find(e => e.type === 'completed');
            expect(completed).toBeDefined();
            expect(entity.components.get(ControlBitsComponent)!.has(205))
                .toBe(true);
            expect(entity.components.get(MissionsComponent)!.size).toBe(0);
        });

    /**
     * Playtest report (Auroran main storyline): "I'm not being offered
     * 'Auroran 11 (665): Cause Havoc for Dani'. I have bit 213 and not
     * 214."
     *
     * Investigated against the reporter's pilot and found NOT to be a
     * bug: every gate passes, and the only thing standing between the
     * player and the offer is AvailRandom 40 — a fresh 40% roll each
     * time the Heraan BAR is entered. The mission's gates, verbatim
     * from the stock mïsn:
     *
     *   AvailStel 360 (Heraan)   AvailLoc 1 (bar, NOT the mission
     *   computer where the Auroran ActionMan patrols come from, and
     *   NOT the main spaceport where off-shoot 734 is offered)
     *   AvailRecord 0 (ignored)  AvailRating 700 (kill points)
     *   AvailRandom 40           AvailBits "b213 & !b214"
     *   AvailShipType 127 (out of every Bible range -> unrestricted)
     *   Require 0                OnSuccess "b214 A792"
     *
     * b213 is set by exactly one thing, nova:664's OnSuccess (Auroran
     * 010), and b214 by 665's own. Pinned here so a regression that
     * silently hides it — a combat-rating comparison, the `b213 &
     * !b214` test-expression tokenizer, the AvailStel plain-id match,
     * or treating the out-of-range AvailShipType 127 as a real ship
     * restriction — fails loudly instead of looking like bad luck.
     */
    it('offers "Cause Havoc for Dani" (nova:665) in the Heraan bar at '
        + 'b213 & !b214, subject only to its 40% AvailRandom roll',
        async () => {
            const gameData = await getIntegrationGameData();
            const universe = MissionUniverse.shared(gameData);
            await universe.load();

            const misn = await gameData.data.Mission.get('nova:665');
            expect(misn.name).toContain('Cause Havoc for Dani');
            expect(misn.availStel).toBe(360);
            expect(misn.availStelId).toBe('nova:360');
            expect(misn.availLoc).toBe(LOCATION_BAR);
            expect(misn.availRecord).toBe(0);
            expect(misn.availRating).toBe(700);
            expect(misn.availRandom).toBe(40);
            expect(misn.availBits).toBe('b213 & !b214');
            expect(misn.availShipType).toBe(127);
            expect(misn.require).toBe('0');
            expect(misn.onSuccess).toBe('b214 A792');
            // Its predecessor is the only source of b213.
            const predecessor = await gameData.data.Mission.get('nova:664');
            expect(predecessor.name).toContain('Find and Destroy Supply Fleet');
            expect(predecessor.availBits).toBe('b212 & !b213');
            expect(predecessor.onSuccess).toBe('b213');
            // The off-shoot the reporter had already run is a separate
            // branch off the same b213 and sets none of b214.
            const offshoot = await gameData.data.Mission.get('nova:734');
            expect(offshoot.availBits).toBe('b213 & !(b220 | b154)');
            expect(offshoot.availLoc).toBe(LOCATION_MAIN_SPACEPORT);
            expect(offshoot.onSuccess).toBe('b154 b155');

            const start = await gameData.data.PlayerStart.get('nova:128');
            const shipData = await gameData.data.Ship.get(start.ship);
            const pilot = async (bits: number[], kills: number) => {
                const entity = makeShip(shipData);
                entity.components.set(GameDateComponent, { ...start.date });
                entity.components.set(CreditsComponent, { credits: 0 });
                entity.components.set(ControlBitsComponent, new Set(bits));
                entity.components.set(CombatRatingComponent, { kills });
                return MissionSession.create(
                    entity, gameData, universe, 'nova:360');
            };

            const mission = universe.getMission('nova:665')!;
            const session = await pilot([213], 700);
            const ctx = session.machinery.offerContext();
            expect(missionMatchesLocation(mission, LOCATION_BAR, ctx))
                .toBe(true);
            expect(makeMissionOffer(mission, ctx)!.acceptable).toBe(true);
            // Bar only: it is not on the mission computer or in the
            // main spaceport dialog, which is where the rest of the
            // Auroran offers at Heraan come from.
            expect(missionMatchesLocation(mission,
                LOCATION_MISSION_COMPUTER, ctx)).toBe(false);
            expect(missionMatchesLocation(mission,
                LOCATION_MAIN_SPACEPORT, ctx)).toBe(false);

            // Each gate, checked one at a time.
            expect(missionMatchesLocation(mission, LOCATION_BAR,
                (await pilot([213], 699)).machinery.offerContext()))
                .toBe(false);                      // AvailRating 700
            expect(missionMatchesLocation(mission, LOCATION_BAR,
                (await pilot([213, 214], 700)).machinery.offerContext()))
                .toBe(false);                      // !b214
            expect(missionMatchesLocation(mission, LOCATION_BAR,
                (await pilot([], 700)).machinery.offerContext()))
                .toBe(false);                      // b213

            // AvailRandom 40: a fresh roll per bar entry, so the offer
            // appears on 40% of visits and never on the other 60% —
            // exactly the reported symptom, and not a bug.
            const random = spyOn(Math, 'random');
            random.and.returnValue(0.39);
            expect(rollOffers(session, universe, LOCATION_BAR)
                .some(o => o.data.id === 'nova:665')).toBe(true);
            random.and.returnValue(0.40);
            expect(rollOffers(session, universe, LOCATION_BAR)
                .some(o => o.data.id === 'nova:665')).toBe(false);
        });

    /**
     * The <SN> wildcard against real data. mïsn nova:140 ("25000 Credit
     * Bounty") is the plain bounty-hunter exemplar: a përs-offered
     * bounty (AvailLoc 2, "offered from a ship") with one special ship
     * (ShipCount 1, ShipGoal 0 "destroy", ShipDude nova:154) whose
     * ShipNameID points at STR# nova:25000 "Auroran Warships". Its
     * QuickBrief reads
     *
     *   "Locate and destroy the <SN> and then collect your bounty at
     *    the Guild offices on the Kane Band."
     *
     * while its OFFER text (correctly, per the Bible's warning) uses no
     * <SN> at all: "Apparently an Auroran ship has been raiding in and
     * around this system.  The bounty for its destruction is 25000
     * Federation credits."
     */
    it('picks a bounty target\'s name at accept and spends it on the '
        + 'briefing and the ships (mïsn nova:140)', async () => {
        const gameData = await getIntegrationGameData();
        const universe = MissionUniverse.shared(gameData);
        await universe.load();

        const mission = await gameData.data.Mission.get('nova:140');
        expect(mission.availLoc).toBe(LOCATION_SHIP);
        expect(mission.shipCount).toBe(1);
        expect(mission.shipGoal).toBe(GOAL_DESTROY);
        // ShipNameID resolves to the STR# list verbatim.
        const nameList = await gameData.data.StringTable.get('nova:25000');
        expect(nameList.name).toBe('Auroran Warships');
        expect(nameList.strings[0]).toBe('Dechanik');
        expect(mission.shipNames).toEqual(nameList.strings);
        expect(mission.quickBrief).toContain('destroy the <SN>');
        // The Bible: <SN> in the initial description is broken because
        // the name isn't picked until accept. The stock mission obeys.
        expect(mission.offerText).not.toContain('<SN>');

        const start = await gameData.data.PlayerStart.get('nova:128');
        const shipData = await gameData.data.Ship.get(start.ship);
        const entity = makeShip(shipData);
        entity.components.set(GameDateComponent, { ...start.date });
        entity.components.set(CreditsComponent, { credits: start.credits });
        entity.components.set(ControlBitsComponent, new Set([0]));

        const session = await MissionSession.create(
            entity, gameData, universe, 'nova:128');
        const ctx = session.machinery.offerContext();
        const offer = makeMissionOffer(mission, ctx)!;

        // Before the accept there is no name: the offer expands <SN> to
        // the generic fallback.
        expect(expandMissionText(mission.quickBrief,
            offerSubstitutions(universe, session.currentDay, offer)))
            .toContain('destroy the unknown ship');

        acceptOffer(session.machinery, offer, session.outfits);
        session.commit();
        const active = entity.components.get(MissionsComponent)!
            .get('nova:140')!;
        expect(nameList.strings).toContain(active.shipName!);

        // The briefing/QuickBrief now names the target...
        const brief = expandMissionText(mission.quickBrief,
            offerSubstitutions(universe, session.currentDay, offer, active));
        expect(brief).toContain(`destroy the ${active.shipName}`);
        expect(brief).not.toContain('<SN>');

        // ...and the ship the player actually meets wears that name.
        const ships = await buildMissionShipSpawns(entity, 'owner',
            active.shipObjective!.systemId!, gameData, universe);
        expect(ships.length).toBe(1);
        expect(ships[0].name).toBe(active.shipName);
    });

    it('fails a mission whose ship goal failed, at the next landing',
        async () => {
            const gameData = await getIntegrationGameData();
            const universe = MissionUniverse.shared(gameData);
            await universe.load();

            const start = await gameData.data.PlayerStart.get('nova:128');
            const shipData = await gameData.data.Ship.get(start.ship);
            const entity = makeShip(shipData);
            entity.components.set(GameDateComponent, { ...start.date });
            entity.components.set(CreditsComponent, { credits: 0 });
            entity.components.set(ControlBitsComponent,
                new Set([204, 511]));

            const session = await MissionSession.create(
                entity, gameData, universe, 'nova:360');
            const offer = makeMissionOffer(universe.getMission('nova:657')!,
                session.machinery.offerContext())!;
            acceptOffer(session.machinery, offer, session.outfits);
            session.commit();

            entity.components.get(MissionsComponent)!
                .get('nova:657')!.shipObjective!.failed = true;
            const events = await processEntityLanding(
                entity, gameData, universe, 'nova:360');
            expect(events.find(e => e.type === 'failed')).toBeDefined();
            expect(entity.components.get(MissionsComponent)!.size).toBe(0);
        });

    /**
     * nova:155 "Take Sample" (Polaris6a) is a BOARD-goal mission
     * (ShipGoal 2), offered in the bar on nova:286 with bit b279.
     * Boarding does not exist, so it must stay suppressed even when
     * every other condition matches.
     */
    it('offers a real board-goal mission now that boarding is real',
        async () => {
        const gameData = await getIntegrationGameData();
        const universe = MissionUniverse.shared(gameData);
        await universe.load();

        const start = await gameData.data.PlayerStart.get('nova:128');
        const shipData = await gameData.data.Ship.get(start.ship);
        const entity = makeShip(shipData);
        entity.components.set(GameDateComponent, { ...start.date });
        entity.components.set(CreditsComponent, { credits: 0 });
        entity.components.set(ControlBitsComponent, new Set([279]));

        const session = await MissionSession.create(
            entity, gameData, universe, 'nova:286');
        const mission = universe.getMission('nova:155')!;
        expect(mission.shipGoal).toBe(2);
        const ctx = session.machinery.offerContext();
        // Everything else about the mission matches this bar...
        expect(mission.availStelId).toBe('nova:286');
        expect(mission.availLoc).toBe(LOCATION_BAR);
        // ...and the board goal no longer keeps it out (Matthew's
        // ruling; mission_ship_state.ts's goalSupported).
        expect(missionMatchesLocation(mission, LOCATION_BAR, ctx))
            .toBe(true);
    });

    /**
     * Matthew's reference case (a): Temmin Shard's Leviathan. Stock mïsn
     * 832, "Recover Stolen Art", whose QuickBrief (dësc 6785) reads
     * "Disable and board the Leviathan in the Arcturus system, pick up
     * the stolen art and then head to <RST> in the <RSY> system."
     *
     * It is a BAR mission (AvailLoc 1), not a boarding-ship offer, so
     * everything it needs is the board goal being offerable and mïsn
     * PickupMode 2 being real. Both halves of its brief are pinned here
     * against the actual game data, so a data or parser change that broke
     * the mission would fail here rather than in play.
     */
    it('offers Temmin Shard\'s Leviathan board mission (mïsn 832)',
        async () => {
            const gameData = await getIntegrationGameData();
            const universe = MissionUniverse.shared(gameData);
            await universe.load();
            const mission = universe.getMission('nova:832')!;

            // The data this mission is built out of.
            expect(mission.name).toContain('Recover Stolen Art');
            expect(mission.shipGoal).toBe(2);        // Board them
            expect(mission.shipCount).toBe(1);
            expect(mission.pickupMode).toBe(2);      // ...on boarding
            expect(mission.dropOffMode).toBe(1);     // ...at ReturnStel
            expect(mission.cargoQty).toBeGreaterThan(0);
            expect(mission.availLoc).toBe(LOCATION_BAR);

            // Both halves of the goal are engine-supported now.
            expect(goalSupported(mission.shipGoal)).toBeTrue();
            expect(shipGoalOfferable(mission)).toBeTrue();

            // And the accepted mission carries the frozen PickupMode-2
            // flag the simulation reads when the player boards the
            // Leviathan (MissionShipTrackSystem).
            const start = await gameData.data.PlayerStart.get('nova:128');
            const shipData = await gameData.data.Ship.get(start.ship);
            const entity = makeShip(shipData);
            entity.components.set(GameDateComponent, { ...start.date });
            entity.components.set(CreditsComponent, { credits: 0 });
            const session = await MissionSession.create(
                entity, gameData, universe, mission.availStelId!);
            const ctx = session.machinery.offerContext();
            const offer = makeMissionOffer(mission, ctx)!;
            expect(offer).not.toBeNull();
            acceptOffer(session.machinery, offer, session.outfits, 0, true);
            const active = session.state.missions.get('nova:832')!;
            expect(active.pickupOnBoard).toBeTrue();
            // Not loaded at accept: PickupMode 2 waits for the boarding.
            expect(active.cargoLoaded).toBeFalse();
            expect(active.shipObjective?.goal).toBe(2);
        });

    it('starts a mission from an outfit-style Sxxx set string', async () => {
        // This is the outfitter hook (item 3): a set string run through
        // the session's mission machinery must be able to Sxxx-start a
        // mission, not just flip control bits.
        const gameData = await getIntegrationGameData();
        const universe = MissionUniverse.shared(gameData);
        await universe.load();

        const start = await gameData.data.PlayerStart.get('nova:128');
        const shipData = await gameData.data.Ship.get(start.ship);
        const entity = makeShip(shipData);
        entity.components.set(GameDateComponent, { ...start.date });
        entity.components.set(CreditsComponent, { credits: 0 });
        entity.components.set(ControlBitsComponent, new Set());

        // Docked somewhere inhabited (nova:128 "Delivery to Earth"
        // resolves a return of Earth from any inhabited stellar).
        const dockedAt = universe.stellarCandidates.find(
            s => !s.uninhabited && s.canLand && s.id !== 'nova:128')!;
        const session = await MissionSession.create(
            entity, gameData, universe, dockedAt.id);

        // "S128" — start mission 128 — as an outfit OnPurchase would.
        session.runMissionSet('S128', 'nova');
        session.commit();

        expect(entity.components.get(MissionsComponent)!.has('nova:128'))
            .toBe(true);
    });

    it('fails an in-flight deadline the moment it passes, on jump',
        async () => {
            // Item 1: advanceEntityDate (with game data) fails an expired
            // mission mid-flight and queues the notice for the next
            // landing rather than waiting for the landing to notice.
            const gameData = await getIntegrationGameData();
            const universe = MissionUniverse.shared(gameData);
            await universe.load();

            const start = await gameData.data.PlayerStart.get('nova:128');
            const shipData = await gameData.data.Ship.get(start.ship);
            const entity = makeShip(shipData);
            entity.components.set(GameDateComponent, { ...start.date });
            entity.components.set(CreditsComponent, { credits: 0 });
            entity.components.set(ControlBitsComponent, new Set());

            const dockedAt = universe.stellarCandidates.find(
                s => !s.uninhabited && s.canLand && s.id !== 'nova:128')!;
            const session = await MissionSession.create(
                entity, gameData, universe, dockedAt.id);
            const offer = makeMissionOffer(universe.getMission('nova:128')!,
                session.machinery.offerContext())!;
            acceptOffer(session.machinery, offer, session.outfits);
            // Give it a 1-day deadline so a single jump overruns it.
            session.state.missions.get('nova:128')!.deadlineDay =
                dayNumber(entity.components.get(GameDateComponent)!);
            session.commit();

            // A jump-length date advance (with game data) passes the
            // deadline: the mission fails now, not at the next landing.
            await advanceEntityDate(entity, 3, universe, gameData);
            expect(entity.components.get(MissionsComponent)!.size).toBe(0);

            // The failure notice surfaces at the next landing.
            const events = await processEntityLanding(
                entity, gameData, universe, dockedAt.id);
            expect(events.find(e => e.type === 'failed')?.missionId)
                .toBe('nova:128');
        });

    /**
     * BUG 1: "Rush Delivery to Nil'ar Nina" was offered on a Federation
     * board. Nova stacks alternate-story copies of a system at one map
     * position under mutually-exclusive sÿst Visibility bits (EVN Bible,
     * "The Visibility field controls how and when to make the system
     * visible or invisible"). The currently-visible Nil'ar Nina is the
     * Polaris one (nova:223, system "Nil'kol" vis "!b88"); a Federation-govt
     * duplicate (nova:453, system vis "b88 | b3009") is hidden for a default
     * pilot. Random / govt-ranged mission destinations must sample only
     * currently-visible stellars, never a hidden duplicate.
     */
    it('samples mission destinations only from visible systems (BUG 1)',
        async () => {
            const gameData = await getIntegrationGameData();
            const universe = MissionUniverse.shared(gameData);
            await universe.load();

            const byId = new Map(
                universe.stellarCandidates.map(s => [s.id, s]));
            const noBits = new Set<number>();

            // Visible Polaris Nil'ar Nina vs the hidden Federation duplicate.
            expect(stellarVisible(byId.get('nova:223')!, noBits)).toBe(true);
            expect(stellarVisible(byId.get('nova:453')!, noBits)).toBe(false);
            // Visible Brass (Glimmer, "!(b6300 | b6302)") vs hidden story
            // duplicates gated on b6300/b6302/b130.
            expect(stellarVisible(byId.get('nova:214')!, noBits)).toBe(true);
            for (const dup of ['nova:503', 'nova:505', 'nova:512']) {
                expect(stellarVisible(byId.get(dup)!, noBits)).toBe(false);
            }

            // The visible Federation (travelStel 10000 -> govt 128) pool
            // includes the real Brass and excludes every hidden duplicate.
            const getGovt = (id: string) => universe.getGovt(id);
            const visibleFederation = universe.stellarCandidates.filter(s =>
                s.canLand && stellarVisible(s, noBits)
                && matchesStellarRef(10000, null, s, 'nova', getGovt));
            const ids = new Set(visibleFederation.map(s => s.id));
            expect(ids.has('nova:214')).toBe(true);
            expect(ids.has('nova:453')).toBe(false);
            expect(ids.has('nova:503')).toBe(false);

            // A real Federation "Delivery to <DST>" (nova:211): every draw of
            // its random destination is a currently-visible Federation
            // stellar, so the offered planet name is never a hidden copy.
            const start = await gameData.data.PlayerStart.get('nova:128');
            const shipData = await gameData.data.Ship.get(start.ship);
            const entity = makeShip(shipData);
            entity.components.set(GameDateComponent, { ...start.date });
            entity.components.set(CreditsComponent, { credits: 0 });
            entity.components.set(ControlBitsComponent, new Set());
            const session = await MissionSession.create(
                entity, gameData, universe, 'nova:128'); // docked at Earth
            const delivery = universe.getMission('nova:211')!;
            expect(delivery.travelStel).toBe(10000);
            for (let i = 0; i < 200; i++) {
                const offer = makeMissionOffer(
                    delivery, session.machinery.offerContext());
                expect(offer).not.toBeNull();
                expect(ids.has(offer!.travelPlanet!)).toBe(true);
            }
        });

    /**
     * BUG 2: a "deliver cargo to Brass" mission would not complete on
     * landing at Brass. Root cause: the random Federation destination froze
     * to a HIDDEN Brass duplicate id (nova:503/505/512) while the player
     * lands on the visible Brass (nova:214). Two fixes converge here: the
     * destination now samples only visible stellars (so it freezes
     * nova:214), and — belt and suspenders — landing on a duplicate stellar
     * with the identical name and coordinates completes the mission anyway
     * (EVN Bible, TravelStel/ReturnStel duplicate rule).
     */
    it('completes a real Federation delivery on landing at Brass (BUG 2)',
        async () => {
            const gameData = await getIntegrationGameData();
            const universe = MissionUniverse.shared(gameData);
            await universe.load();

            const start = await gameData.data.PlayerStart.get('nova:128');
            const shipData = await gameData.data.Ship.get(start.ship);
            const entity = makeShip(shipData);
            entity.components.set(GameDateComponent, { ...start.date });
            entity.components.set(CreditsComponent, { credits: 0 });
            entity.components.set(ControlBitsComponent, new Set());

            const session = await MissionSession.create(
                entity, gameData, universe, 'nova:128');
            const mission = universe.getMission('nova:211')!; // Delivery
            // A concrete offer of the real mission, frozen (as the sampler
            // now would) to the visible Brass in Glimmer.
            const offer: MissionOffer = {
                data: mission,
                travelPlanet: 'nova:214',
                returnPlanet: null, // returnStel -1 => completes at travel
                cargoType: 0, cargoQty: 2,
                acceptable: true,
            };
            acceptOffer(session.machinery, offer, session.outfits);
            session.commit();
            expect(entity.components.get(MissionsComponent)!.has('nova:211'))
                .toBe(true);

            const events = await processEntityLanding(
                entity, gameData, universe, 'nova:214');
            const completed = events.find(e => e.type === 'completed');
            expect(completed?.missionId).toBe('nova:211');
            expect(completed?.payment).toBe(15000);
            expect(entity.components.get(CreditsComponent)!.credits)
                .toBe(15000);
            expect(entity.components.get(MissionsComponent)!.size).toBe(0);
        });

    it('completes a delivery frozen to a hidden Brass duplicate when the ' +
        'player lands at the visible Brass (BUG 2, duplicate rule)',
        async () => {
            const gameData = await getIntegrationGameData();
            const universe = MissionUniverse.shared(gameData);
            await universe.load();
            // nova:214 (visible Brass, Glimmer) and nova:503 (a hidden
            // duplicate Brass) are the same stellar by name + coordinates.
            expect(universe.sameStellar('nova:503', 'nova:214')).toBe(true);

            const start = await gameData.data.PlayerStart.get('nova:128');
            const shipData = await gameData.data.Ship.get(start.ship);
            const entity = makeShip(shipData);
            entity.components.set(GameDateComponent, { ...start.date });
            entity.components.set(CreditsComponent, { credits: 0 });
            entity.components.set(ControlBitsComponent, new Set());

            const session = await MissionSession.create(
                entity, gameData, universe, 'nova:128');
            const mission = universe.getMission('nova:211')!;
            acceptOffer(session.machinery, {
                data: mission,
                travelPlanet: 'nova:503', // frozen to the hidden duplicate
                returnPlanet: null,
                cargoType: 0, cargoQty: 2,
                acceptable: true,
            }, session.outfits);
            session.commit();

            const events = await processEntityLanding(
                entity, gameData, universe, 'nova:214'); // the visible Brass
            expect(events.find(e => e.type === 'completed')?.missionId)
                .toBe('nova:211');
            expect(entity.components.get(MissionsComponent)!.size).toBe(0);
        });

    it('completes BOTH missions bound to Brass on a single landing (BUG 2)',
        async () => {
            const gameData = await getIntegrationGameData();
            const universe = MissionUniverse.shared(gameData);
            await universe.load();

            const start = await gameData.data.PlayerStart.get('nova:128');
            const shipData = await gameData.data.Ship.get(start.ship);
            const entity = makeShip(shipData);
            entity.components.set(GameDateComponent, { ...start.date });
            entity.components.set(CreditsComponent, { credits: 0 });
            entity.components.set(ControlBitsComponent, new Set());

            const session = await MissionSession.create(
                entity, gameData, universe, 'nova:128');
            // Two distinct real "Delivery to <DST>" missions, both bound to
            // the visible Brass (one to the id, one to a hidden duplicate).
            const first = universe.getMission('nova:211')!;
            const second = universe.getMission('nova:418')!;
            acceptOffer(session.machinery, {
                data: first, travelPlanet: 'nova:214', returnPlanet: null,
                cargoType: 0, cargoQty: 2, acceptable: true,
            }, session.outfits);
            acceptOffer(session.machinery, {
                data: second, travelPlanet: 'nova:503', returnPlanet: null,
                cargoType: 0, cargoQty: 2, acceptable: true,
            }, session.outfits);
            session.commit();
            expect(entity.components.get(MissionsComponent)!.size).toBe(2);

            const events = await processEntityLanding(
                entity, gameData, universe, 'nova:214');
            const completed = events
                .filter(e => e.type === 'completed')
                .map(e => e.missionId).sort();
            expect(completed).toEqual(['nova:211', 'nova:418']);
            expect(entity.components.get(MissionsComponent)!.size).toBe(0);
        });

    it('does not double-apply dateAdvance on a second commit (L5)', async () => {
        const gameData = await getIntegrationGameData();
        const universe = MissionUniverse.shared(gameData);
        await universe.load();

        const start = await gameData.data.PlayerStart.get('nova:128');
        const shipData = await gameData.data.Ship.get(start.ship);
        const entity = makeShip(shipData);
        entity.components.set(GameDateComponent, { ...start.date });
        entity.components.set(CreditsComponent, { credits: 0 });
        entity.components.set(ControlBitsComponent, new Set());

        const dockedAt = universe.stellarCandidates.find(
            s => !s.uninhabited && s.canLand && s.id !== 'nova:128')!;
        const session = await MissionSession.create(
            entity, gameData, universe, dockedAt.id);

        const startDay = dayNumber(entity.components.get(GameDateComponent)!);
        // Simulate a DatePostInc effect having accumulated on the session.
        session.state.dateAdvance = 5;

        session.commit();
        expect(dayNumber(entity.components.get(GameDateComponent)!))
            .toBe(startDay + 5);

        // A second commit must be idempotent for the date: the advance was
        // already applied and must not be applied again.
        session.commit();
        expect(dayNumber(entity.components.get(GameDateComponent)!))
            .toBe(startDay + 5);
        expect(session.state.dateAdvance).toBe(0);
    });

    it('refreshes cargo capacity so an outfitter-run cargo mission sees ' +
        'the current hold (L6)', async () => {
            const gameData = await getIntegrationGameData();
            const universe = MissionUniverse.shared(gameData);
            await universe.load();

            const start = await gameData.data.PlayerStart.get('nova:128');
            const shipData = await gameData.data.Ship.get(start.ship);
            const entity = makeShip(shipData);
            entity.components.set(GameDateComponent, { ...start.date });
            entity.components.set(CreditsComponent, { credits: 0 });
            entity.components.set(ControlBitsComponent, new Set());

            const dockedAt = universe.stellarCandidates.find(
                s => !s.uninhabited && s.canLand && s.id !== 'nova:128')!;
            const session = await MissionSession.create(
                entity, gameData, universe, dockedAt.id);

            // A cargo delivery whose quantity is bigger than the session's
            // starting capacity: it can't be accepted now (the frozen offer
            // is unacceptable), but must become acceptable once the outfitter
            // enlarges the hold and pushes the new capacity in (L6).
            const baseFree = session.machinery.offerContext().freeCargoSpace;
            const cargoQty = baseFree + 12;
            const template = universe.getMission('nova:128')!; // Delivery
            // A synthetic pickup-at-start delivery with a fixed, oversized
            // cargo requirement (returns to Earth like the template).
            const withCargo: MissionData = {
                ...template,
                id: 'test:cargo',
                cargoType: 2,
                cargoQty,
                pickupMode: 0,
                flags: {
                    ...template.flags,
                    // Must stay offerable-but-unacceptable, not hidden.
                    notOfferedIfInsufficientCargoSpace: false,
                },
            };

            const before = makeMissionOffer(withCargo,
                session.machinery.offerContext())!;
            expect(before.acceptable).toBe(false);
            expect(before.reason).toContain('cargo space');

            // The outfitter buys a freeCargo outfit and refreshes capacity.
            session.setCargoCapacity(baseFree + 20);
            const after = makeMissionOffer(withCargo,
                session.machinery.offerContext())!;
            expect(after.acceptable).toBe(true);

            // Selling it back shrinks the hold again (stale-in-both-
            // directions: the frozen capacity would have been wrong here too).
            session.setCargoCapacity(baseFree);
            const shrunk = makeMissionOffer(withCargo,
                session.machinery.offerContext())!;
            expect(shrunk.acceptable).toBe(false);

            // Capacity never goes negative.
            session.setCargoCapacity(-5);
            expect(session.machinery.offerContext().freeCargoSpace).toBe(0);
        });
});

/**
 * Notices queued while the player was in FLIGHT (a deadline that expired
 * between jumps, a deferred auto-abort the sim fired) live on the entity
 * in PendingMissionNoticesComponent until the next spaceport screen shows
 * them. processEntityLanding is what hands them over, and it used to
 * DRAIN them — clearing the component — before the work that can throw,
 * with spaceport.ts's show() swallowing the throw. The notice was then
 * gone from the entity and never shown to anybody.
 */
describe('processEntityLanding and the in-flight notice queue', () => {
    const NOTICE = {
        missionId: 'nova:128', missionName: 'Delivery to Earth',
        type: 'failed', text: 'You were too slow.',
    };

    async function pilotWithPendingNotice() {
        const gameData = await getIntegrationGameData();
        const universe = MissionUniverse.shared(gameData);
        await universe.load();
        const start = await gameData.data.PlayerStart.get('nova:128');
        const shipData = await gameData.data.Ship.get(start.ship);
        const entity = makeShip(shipData);
        entity.components.set(GameDateComponent, { ...start.date });
        entity.components.set(CreditsComponent, { credits: start.credits });
        entity.components.set(ControlBitsComponent, new Set());
        entity.components.set(PendingMissionNoticesComponent, [{ ...NOTICE }]);
        return { gameData, universe, entity };
    }

    it('hands a queued notice to the spaceport and clears it', async () => {
        const { gameData, universe, entity } = await pilotWithPendingNotice();
        const events = await processEntityLanding(
            entity, gameData, universe, 'nova:128');
        expect(events.map(e => e.type)).toEqual(['failed']);
        expect(events[0].text).toBe(NOTICE.text);
        expect(entity.components.get(PendingMissionNoticesComponent))
            .toEqual([]);
    });

    it('KEEPS the notice queued when the landing processing throws',
        async () => {
            const { gameData, universe, entity } =
                await pilotWithPendingNotice();
            // MissionSession.create awaits universe.load() outside any
            // catch, so a universe that fails to load is the throw this
            // seam is about. advanceEntityDate, which runs first, catches
            // its own load failure — so the date still moves and the queue
            // is the only thing at risk.
            const broken = Object.create(universe) as MissionUniverse;
            broken.load = () => Promise.reject(new Error('data gone'));

            await expectAsync(processEntityLanding(
                entity, gameData, broken, 'nova:128')).toBeRejected();
            expect(entity.components.get(PendingMissionNoticesComponent))
                .toEqual([NOTICE]);

            // ...and the next (working) landing still shows it.
            const events = await processEntityLanding(
                entity, gameData, universe, 'nova:128');
            expect(events.map(e => e.type)).toEqual(['failed']);
        });
});
