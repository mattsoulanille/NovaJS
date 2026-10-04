import 'jasmine';
import { PlanetData } from 'novadatainterface/planet_data';
import { SystemData } from 'novadatainterface/system_data';
import { getIntegrationGameData } from '../../communication/simulation_test_fixture.js';
import { novaDataInstalled, requireNovaData } from '../../test_support/nova_data_gate.js';

/**
 * Pins the stellar defence / weapon / domination / destruction fields and
 * the sÿst reinforcement fields (tracker issue #306) on a few stock
 * stellars and systems. They are PARSED ONLY — no gameplay reads them yet
 * (feature request #353) — so this pins the parser's
 * decoding of the real data, not any behaviour.
 */
describe('stellar defence and reinforcement fields against real Nova data',
    () => {
        let planets: Map<string, PlanetData>;
        let systems: Map<string, SystemData>;
        beforeEach(requireNovaData);
        beforeAll(async () => {
            if (!novaDataInstalled()) return; // each spec pends instead
            const gameData = await getIntegrationGameData();
            const ids = await gameData.ids;
            planets = new Map((await Promise.all(
                ids.Planet.map(id => gameData.data.Planet.get(id))))
                .map(p => [p.id, p]));
            systems = new Map((await Promise.all(
                ids.System.map(id => gameData.data.System.get(id))))
                .map(s => [s.id, s]));
        }, 60_000);

        function planet(id: string, name: string): PlanetData {
            const p = planets.get(id)!;
            expect(p.name).toBe(name);
            return p;
        }

        it('decodes Earth: a 600-ship defence fleet in waves of 6, an armed,' +
            ' provoked-only, destroyable world paying 10000 a day', () => {
            const earth = planet('nova:128', 'Earth');
            // DefenseDude 130, DefCount 7006.
            expect(earth.defense).toEqual(
                { dude: 'nova:130', count: 600, waveSize: 6 });
            // Weapon 196; Flags2 0x0200.
            expect(earth.weapon).toEqual(
                { id: 'nova:196', firesOnlyWhenProvoked: true });
            expect(earth.domination).toEqual({
                tribute: 10000, alwaysDominated: false,
                onDominate: 'b6100', onRelease: '',
            });
            expect(earth.destruction).toEqual({
                strength: 3000, startsDestroyed: false, deadGraphic: null,
                animateOnlyWhenDestroyed: false, regenerationDays: 0,
                explosion: 'nova:128', explosionSparks: null,
                onDestroy: 'b6200', onRegen: '',
            });
            expect(earth.deadly).toBeFalse();
            expect(earth.gravity).toBe(0);
        });

        it('decodes the stock DefCounts 2206 and 3406', () => {
            // Port Kane: the common 2206 (120 ships, waves of 6).
            expect(planet('nova:137', 'Port Kane').defense).toEqual(
                { dude: 'nova:130', count: 120, waveSize: 6 });
            // Honor: the only 3406 (240 ships, waves of 6).
            expect(planet('nova:196', 'Honor').defense).toEqual(
                { dude: 'nova:128', count: 240, waveSize: 6 });
        });

        it('fires an always-on weapon from Spacedock II (Flags2 clear)',
            () => {
                expect(planet('nova:133', 'Spacedock II').weapon).toEqual(
                    { id: 'nova:196', firesOnlyWhenProvoked: false });
            });

        it('defaults Resolution\'s Tribute 0 to 1000 x its tech level 1', () => {
            const resolution = planet('nova:445', 'Resolution');
            expect(resolution.domination.tribute).toBe(1000);
            expect(resolution.defense).toBeNull();
        });

        it('leaves a dead hypergate undefended, unarmed and invincible', () => {
            const gate = planet('nova:130', 'HG-Aldebaran');
            expect(gate.defense).toBeNull();
            expect(gate.weapon).toBeNull();
            expect(gate.destruction.strength).toBeNull();
            expect(gate.destruction.explosion).toBeNull();
        });

        it('counts the stock defended, armed and destroyable stellars', () => {
            const all = [...planets.values()];
            expect(all.length).toBe(411);
            expect(all.filter(p => p.defense).length).toBe(289);
            expect(all.filter(p => p.weapon).length).toBe(95);
            expect(all.filter(p => p.destruction.strength !== null).length)
                .toBe(394);
            // No stock stellar is deadly, has gravity, starts destroyed or
            // is always dominated: those are plug-in features.
            expect(all.some(p => p.deadly)).toBeFalse();
            expect(all.some(p => p.gravity !== 0)).toBeFalse();
            expect(all.some(p => p.destruction.startsDestroyed)).toBeFalse();
            expect(all.some(p => p.domination.alwaysDominated)).toBeFalse();
        });

        it('decodes Sol\'s reinforcement fleet (flët 145, 16 s, daily)', () => {
            const sol = systems.get('nova:130')!;
            expect(sol.name).toBe('Sol');
            expect(sol.reinforcements).toEqual(
                { fleet: 'nova:145', delayFrames: 480, regenerationDays: 1 });
        });

        it('has no reinforcements where ReinfFleet is 0 (HJG-1034)', () => {
            const hjg = systems.get('nova:145')!;
            expect(hjg.name).toBe('HJG-1034');
            expect(hjg.reinforcements).toBeNull();
        });
    });
