import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import {
    activeSystemId, arrive, beginTeardown, beginTransit, canEnterGame,
    canExitToTitle, claimSystem, ClientState, ClientStateSlot, closeRollback,
    closeTitleDialog, describeState, dock, dockAtGate, dockedShip,
    DockedShip, enterFailed, enterGame, gateLaunched, IllegalTransitionError,
    isDockedForExit, isInGame, land, landAtGate, launched, launchingEntity,
    liveSystem, LiveSystem, openRollback, openTitleDialog, originTornDown,
    releaseClaim, requestGateLaunch, requestLaunch, returnToGate, strand,
    swapDockedShip, tornDown, TransitPlan,
} from './client_state.js';

/**
 * The client state machine (client/client_state.ts): every state's
 * invariants, the transitions that are refused, and a scripted run
 * through a whole session.
 */
describe('client state machine', () => {
    /** A live system stub: only the id matters to the pure machine. */
    const system = (systemId: string): LiveSystem =>
        ({ systemId } as unknown as LiveSystem);
    const ship = (planetId = 'nova:128'): DockedShip =>
        ({ uuid: 'player', entity: new Entity(), planetId });
    const plan = (from: string | undefined, to: string,
        kind: TransitPlan['kind'] = 'hyper'): TransitPlan =>
        ({ kind, from, to, uuid: 'player', entity: new Entity() });
    const title: ClientState = { kind: 'title' };
    const expectIllegal = (transition: () => ClientState | void,
        name: string) => {
        expect(transition).toThrowMatching(e =>
            e instanceof IllegalTransitionError && e.transition === name);
    };

    describe('title side', () => {
        it('a dialog takes the menu out of play, and only one at a time', () => {
            const open = openTitleDialog(title, 'about');
            expect(open).toEqual({ kind: 'title', dialog: 'about' });
            expect(canEnterGame(open)).toBeFalse();
            expectIllegal(() => openTitleDialog(open, 'setPrefs'),
                'openTitleDialog');
            expect(closeTitleDialog(open)).toEqual(title);
            expectIllegal(() => closeTitleDialog(title), 'closeTitleDialog');
        });

        it('the rollback panel opens from the Open Pilot dialog and closes '
            + 'back into it', () => {
            const openPilot = openTitleDialog(title, 'openPilot');
            const rollback = openRollback(openPilot, 'pilot-1');
            expect(rollback).toEqual({ kind: 'rollback', pilotId: 'pilot-1' });
            expect(isInGame(rollback)).toBeFalse();
            expect(closeRollback(rollback)).toEqual(openPilot);
            expectIllegal(() => openRollback(title, 'pilot-1'), 'openRollback');
            expectIllegal(() => openRollback(
                openTitleDialog(title, 'newPilot'), 'pilot-1'), 'openRollback');
        });

        it('the game is entered from the title, dialog or not, and from '
            + 'nowhere else', () => {
            expect(enterGame(title)).toEqual({ kind: 'entering' });
            expect(enterGame(openTitleDialog(title, 'newPilot')))
                .toEqual({ kind: 'entering' });
            const inSpace = arrive(claimSystem(beginTransit(enterGame(title),
                plan(undefined, 'A', 'startup')), { systemId: 'A' }),
                system('A'));
            expectIllegal(() => enterGame(inSpace), 'enterGame');
            expectIllegal(() => enterGame({ kind: 'entering' }), 'enterGame');
        });

        it('a failed entry goes back to the title', () => {
            expect(enterFailed({ kind: 'entering' })).toEqual(title);
            const transit = beginTransit(enterGame(title),
                plan(undefined, 'A', 'startup'));
            expect(enterFailed(transit)).toEqual(title);
            expectIllegal(() => enterFailed(title), 'enterFailed');
        });
    });

    describe('transit invariants', () => {
        const inSpaceA = arrive(claimSystem(beginTransit(enterGame(title),
            plan(undefined, 'A', 'startup')), { systemId: 'A' }), system('A'));

        it('the startup transit has no origin; a jump carries the origin '
            + 'system until it is torn down', () => {
            const startup = beginTransit(enterGame(title),
                plan(undefined, 'A', 'startup'));
            expect(startup.kind).toBe('transit');
            expect(liveSystem(startup)).toBeUndefined();
            expect(activeSystemId(startup)).toBeUndefined();

            const jump = beginTransit(inSpaceA, plan('A', 'B'));
            expect(liveSystem(jump)?.systemId).toBe('A');
            expect(activeSystemId(jump)).toBe('A');
            const between = originTornDown(jump);
            expect(liveSystem(between)).toBeUndefined();
            expect(activeSystemId(between)).toBeUndefined();
            expectIllegal(() => originTornDown(between), 'originTornDown');
        });

        it('a claim needs the origin gone, names the destination, and is '
            + 'held once', () => {
            const jump = beginTransit(inSpaceA, plan('A', 'B'));
            expectIllegal(() => claimSystem(jump, { systemId: 'B' }),
                'claimSystem');
            const between = originTornDown(jump);
            expectIllegal(() => claimSystem(between, { systemId: 'C' }),
                'claimSystem');
            const claimed = claimSystem(between, { systemId: 'B' });
            // The claim is what `activeSystemId` used to mean before a
            // world existed: a name with no world behind it, but honest.
            expect(activeSystemId(claimed)).toBe('B');
            expect(liveSystem(claimed)).toBeUndefined();
            expectIllegal(() => claimSystem(claimed, { systemId: 'B' }),
                'claimSystem');
            expect(releaseClaim(claimed)).toEqual(between);
            expectIllegal(() => releaseClaim(between), 'releaseClaim');
        });

        it('a world is published only over its own claim', () => {
            const between = originTornDown(beginTransit(inSpaceA, plan('A', 'B')));
            expectIllegal(() => arrive(between, system('B')), 'arrive');
            const claimed = claimSystem(between, { systemId: 'B' });
            expectIllegal(() => arrive(claimed, system('C')), 'arrive');
            expectIllegal(() => arrive(
                beginTransit(inSpaceA, plan('A', 'B')), system('B')), 'arrive');
            const arrived = arrive(claimed, system('B'));
            expect(arrived).toEqual({ kind: 'inSpace', system: system('B') });
            expect(activeSystemId(arrived)).toBe('B');
        });

        it('a new transit cannot start over a held claim, but can retry '
            + 'once the claim is released (the recovery re-entry)', () => {
            const claimed = claimSystem(originTornDown(
                beginTransit(inSpaceA, plan('A', 'B'))), { systemId: 'B' });
            expectIllegal(() => beginTransit(claimed, plan('A', 'A', 'reenter')),
                'beginTransit');
            const retry = beginTransit(releaseClaim(claimed),
                plan('A', 'A', 'reenter'));
            expect(retry.kind).toBe('transit');
            expect(liveSystem(retry)).toBeUndefined();
            const home = arrive(claimSystem(retry, { systemId: 'A' }),
                system('A'));
            expect(home.kind).toBe('inSpace');
        });

        it('a gate transit that fails while the origin is up goes back to '
            + 'the gate, armed to lift off; once the origin is gone it '
            + 'cannot', () => {
            const departing = beginTransit(inSpaceA, plan('A', 'B', 'gate'));
            const entity = new Entity();
            const gate = ship('gate');
            const back = returnToGate(departing, gate, entity);
            expect(back).toEqual({
                kind: 'gateMap', system: system('A'), ship: gate,
                launching: entity,
            });
            expect(launchingEntity(back)).toBe(entity);
            expectIllegal(() => returnToGate(originTornDown(departing),
                ship('gate'), entity), 'returnToGate');
            // A wormhole aborts out of flight: the sim transited the ship
            // and the client never docked it.
            expect(returnToGate(inSpaceA, ship('worm'), entity).kind)
                .toBe('gateMap');
        });

        it('stranding is only ever from a transit holding nothing', () => {
            const departing = beginTransit(inSpaceA, plan('A', 'B'));
            expectIllegal(() => strand(departing, 'x'), 'strand');
            const between = originTornDown(departing);
            expectIllegal(() => strand(claimSystem(between, { systemId: 'B' }),
                'x'), 'strand');
            const lost = strand(between, 'the origin system is unknown');
            expect(lost).toEqual({
                kind: 'stranded', reason: 'the origin system is unknown',
            });
            expect(canExitToTitle(lost)).toBeTrue();
            expect(beginTransit(lost, plan(undefined, 'A', 'reenter')).kind)
                .toBe('transit');
        });

        it('leaving from a dock drops the docked handles with the system', () => {
            const docked = dock(land(inSpaceA, ship()));
            const jump = beginTransit(docked, plan('A', 'B', 'gate'));
            expect(dockedShip(jump)).toBeUndefined();
            expect(liveSystem(jump)?.systemId).toBe('A');
        });
    });

    describe('docking', () => {
        const inSpaceA = arrive(claimSystem(beginTransit(enterGame(title),
            plan(undefined, 'A', 'startup')), { systemId: 'A' }), system('A'));

        it('a spaceport landing: land -> dock -> requestLaunch -> launched, '
            + 'each only from the step before', () => {
            const landing = land(inSpaceA, ship());
            expect(landing.kind).toBe('landing');
            expect(dockedShip(landing)?.planetId).toBe('nova:128');
            expectIllegal(() => land(landing, ship()), 'land');
            expectIllegal(() => dock(inSpaceA), 'dock');
            const landed = dock(landing);
            expect(landed.kind).toBe('landed');
            expectIllegal(() => launched(landed), 'launched');
            expectIllegal(() => requestLaunch(inSpaceA, new Entity()),
                'requestLaunch');
            const hull = new Entity();
            const departing = requestLaunch(landed, hull);
            expect(launchingEntity(departing)).toBe(hull);
            expect(launched(departing)).toEqual(inSpaceA);
        });

        it('a hypergate dock mirrors it: landAtGate -> dockAtGate -> '
            + 'requestGateLaunch -> gateLaunched', () => {
            const landing = landAtGate(inSpaceA, ship('gate'));
            expect(landing.kind).toBe('gateLanding');
            expectIllegal(() => dockAtGate(inSpaceA), 'dockAtGate');
            expectIllegal(() => dock(landing), 'dock');
            const gateMap = dockAtGate(landing);
            expect(gateMap.kind).toBe('gateMap');
            expectIllegal(() => gateLaunched(gateMap), 'gateLaunched');
            const hull = new Entity();
            expect(gateLaunched(requestGateLaunch(gateMap, hull)))
                .toEqual(inSpaceA);
            // The map may re-arm the launch (the destination turned out
            // to be nowhere) without leaving the gate map.
            expect(requestGateLaunch(requestGateLaunch(gateMap, hull), hull)
                .kind).toBe('gateMap');
        });

        it('a shipyard purchase repoints the docked handle in place, so an '
            + 'open venue holding it sees the new hull', () => {
            const handle = ship();
            const landed = dock(land(inSpaceA, handle));
            const bought = new Entity();
            swapDockedShip(landed, bought);
            expect(handle.entity).toBe(bought);
            expect(dockedShip(landed)?.entity).toBe(bought);
            expectIllegal(() => swapDockedShip(inSpaceA, bought),
                'swapDockedShip');
        });
    });

    describe('exit to title', () => {
        const inSpaceA = arrive(claimSystem(beginTransit(enterGame(title),
            plan(undefined, 'A', 'startup')), { systemId: 'A' }), system('A'));

        it('is refused while docked, allowed the moment the player hits '
            + 'Depart, and refused from the title and during the startup '
            + 'entry', () => {
            const landed = dock(land(inSpaceA, ship()));
            expect(isDockedForExit(landed)).toBeTrue();
            expect(canExitToTitle(landed)).toBeFalse();
            expect(canExitToTitle(requestLaunch(landed, new Entity())))
                .toBeTrue();
            const gateMap = dockAtGate(landAtGate(inSpaceA, ship('gate')));
            expect(canExitToTitle(gateMap)).toBeFalse();
            expect(canExitToTitle(requestGateLaunch(gateMap, new Entity())))
                .toBeTrue();
            expect(canExitToTitle(inSpaceA)).toBeTrue();
            expect(canExitToTitle(land(inSpaceA, ship()))).toBeTrue();
            expect(canExitToTitle(beginTransit(inSpaceA, plan('A', 'B'))))
                .toBeTrue();
            expect(canExitToTitle(title)).toBeFalse();
            expect(canExitToTitle({ kind: 'entering' })).toBeFalse();
            expect(canExitToTitle({ kind: 'tearingDown' })).toBeFalse();
        });

        it('tears down from any in-game state, once, and ends at the title',
            () => {
                for (const from of [
                    inSpaceA, land(inSpaceA, ship()), dock(land(inSpaceA, ship())),
                    beginTransit(inSpaceA, plan('A', 'B')),
                    originTornDown(beginTransit(inSpaceA, plan('A', 'B'))),
                    { kind: 'entering' } as ClientState,
                    { kind: 'stranded', reason: 'x' } as ClientState,
                ]) {
                    expect(beginTeardown(from)).toEqual({ kind: 'tearingDown' });
                }
                expectIllegal(() => beginTeardown(title), 'beginTeardown');
                expectIllegal(() => beginTeardown({ kind: 'tearingDown' }),
                    'beginTeardown');
                expect(tornDown({ kind: 'tearingDown' })).toEqual(title);
                expectIllegal(() => tornDown(inSpaceA), 'tornDown');
            });
    });

    describe('the state slot', () => {
        it('a refused transition leaves the state exactly as it was', () => {
            const slot = new ClientStateSlot();
            expect(() => slot.apply(dock)).toThrowError(IllegalTransitionError);
            expect(slot.state).toEqual(title);
        });

        it('publishes every change to its listeners, previous state '
            + 'included', () => {
            const slot = new ClientStateSlot();
            const seen: string[] = [];
            const unsubscribe = slot.subscribe((next, previous) => {
                seen.push(`${describeState(previous)} -> ${describeState(next)}`);
            });
            slot.apply(enterGame);
            slot.apply(s => openTitleDialog(enterFailed(s), 'about'));
            unsubscribe();
            slot.apply(closeTitleDialog);
            expect(seen).toEqual([
                'title -> entering',
                'entering -> title(about)',
            ]);
        });
    });

    it('describes each state by kind and where it points', () => {
        const inSpaceA = arrive(claimSystem(beginTransit(enterGame(title),
            plan(undefined, 'A', 'startup')), { systemId: 'A' }), system('A'));
        expect(describeState(inSpaceA)).toBe('inSpace(A)');
        expect(describeState(dock(land(inSpaceA, ship('p')))))
            .toBe('landed(A @ p)');
        expect(describeState(requestLaunch(dock(land(inSpaceA, ship('p'))),
            new Entity()))).toBe('landed(A @ p, launching)');
        const jump = beginTransit(inSpaceA, plan('A', 'B'));
        expect(describeState(jump)).toBe('transit(hyper A -> B, origin up)');
        expect(describeState(claimSystem(originTornDown(jump),
            { systemId: 'B' }))).toBe('transit(hyper A -> B, claimed)');
        expect(describeState({ kind: 'rollback', pilotId: 'p1' }))
            .toBe('rollback(p1)');
    });

    describe('a scripted session', () => {
        it('title -> space -> land -> launch -> jump -> title', () => {
            const slot = new ClientStateSlot();
            const kinds: string[] = [];
            slot.subscribe(next => { kinds.push(next.kind); });

            // Enter Ship: the startup transit into A.
            slot.apply(enterGame);
            slot.apply(s => beginTransit(s, plan(undefined, 'A', 'startup')));
            slot.apply(s => claimSystem(s, { systemId: 'A' }));
            slot.apply(s => arrive(s, system('A')));
            expect(liveSystem(slot.state)?.systemId).toBe('A');

            // Land, shop, depart.
            slot.apply(s => land(s, ship('port')));
            slot.apply(dock);
            expect(canExitToTitle(slot.state)).toBeFalse();
            const hull = new Entity();
            slot.apply(s => requestLaunch(s, hull));
            expect(launchingEntity(slot.state)).toBe(hull);
            slot.apply(launched);
            expect(slot.state).toEqual({ kind: 'inSpace', system: system('A') });

            // Jump A -> B: the origin stays up until torn down, the
            // destination is claimed before its world exists.
            slot.apply(s => beginTransit(s, plan('A', 'B')));
            expect(liveSystem(slot.state)?.systemId).toBe('A');
            slot.apply(originTornDown);
            slot.apply(s => claimSystem(s, { systemId: 'B' }));
            expect(activeSystemId(slot.state)).toBe('B');
            expect(liveSystem(slot.state)).toBeUndefined();
            slot.apply(s => arrive(s, system('B')));
            expect(liveSystem(slot.state)?.systemId).toBe('B');

            // Escape: teardown, title.
            expect(canExitToTitle(slot.state)).toBeTrue();
            slot.apply(beginTeardown);
            slot.apply(tornDown);
            expect(slot.state).toEqual(title);
            expect(kinds).toEqual([
                'entering', 'transit', 'transit', 'inSpace',
                'landing', 'landed', 'landed', 'inSpace',
                'transit', 'transit', 'transit', 'inSpace',
                'tearingDown', 'title',
            ]);
        });

        it('an exit on the white screen: the claim is released, nothing '
            + 'is torn down twice, the title comes back', () => {
            const slot = new ClientStateSlot();
            slot.apply(enterGame);
            slot.apply(s => beginTransit(s, plan(undefined, 'A', 'startup')));
            slot.apply(s => claimSystem(s, { systemId: 'A' }));
            slot.apply(s => arrive(s, system('A')));
            slot.apply(s => beginTransit(s, plan('A', 'B')));
            slot.apply(originTornDown);
            slot.apply(s => claimSystem(s, { systemId: 'B' }));
            // The session ends: the transition's failure cleanup releases
            // its claim, and the teardown finds no live system.
            slot.apply(releaseClaim);
            expect(liveSystem(slot.state)).toBeUndefined();
            expect(activeSystemId(slot.state)).toBeUndefined();
            slot.apply(beginTeardown);
            slot.apply(tornDown);
            expect(canEnterGame(slot.state)).toBeTrue();
        });

        it('a failed jump re-enters the origin: the same transit machinery, '
            + 'with the ship where it left', () => {
            const slot = new ClientStateSlot();
            slot.apply(enterGame);
            slot.apply(s => beginTransit(s, plan(undefined, 'A', 'startup')));
            slot.apply(s => claimSystem(s, { systemId: 'A' }));
            slot.apply(s => arrive(s, system('A')));
            slot.apply(s => beginTransit(s, plan('A', 'B')));
            slot.apply(originTornDown);
            slot.apply(s => claimSystem(s, { systemId: 'B' }));
            slot.apply(releaseClaim); // The destination world build rejected.
            slot.apply(s => beginTransit(s, plan('A', 'A', 'reenter')));
            slot.apply(s => claimSystem(s, { systemId: 'A' }));
            slot.apply(s => arrive(s, system('A')));
            expect(describeState(slot.state)).toBe('inSpace(A)');
        });
    });
});
