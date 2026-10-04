import 'jasmine';
import { CommunicatorResource, MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { MockCommunicator } from 'nova_ecs/plugins/mock_communicator';
import { SentHailComponent } from '../nova_plugin/encounters/index.js';
import { ControlledByComponent } from '../nova_plugin/player/index.js';
import { AssistingComponent } from '../nova_plugin/npc/index.js';
import { makeShip } from '../nova_plugin/ship/index.js';
import { completeEntity } from '../nova_plugin/spawn/index.js';
import { wrapRollbackMessage } from './rollback_protocol.js';
import {
    getSyntheticGameData, makeSimulationBridgeHarness,
} from './simulation_test_fixture.js';

/**
 * #332 across the real bridge: ANOTHER peer hails this peer's ship. Their
 * record always reaches us after the tick it is stamped for, so it is
 * applied by a ROLLBACK resimulation — the path on which the bridge drops
 * re-emitted events (simulation_bridge_host's eventsForwardedThrough). The
 * message therefore travels as STATE on the sender's ship (SentHail), which
 * the resimulation recomputes and the next frame carries to the display.
 */
describe('a hail from another peer reaches this peer through rollback (#332)',
    () => {
        it('lands on the sender\'s ship after a late record, and never '
            + 'touches ours', async () => {
                const harness = await makeSimulationBridgeHarness(
                    getSyntheticGameData());
                const { world, client, shipUuid, gameData, shipId } = harness;
                world.entities.get(shipUuid)!.components.set(
                    ControlledByComponent, { peerId: 'server' });

                const sender = makeShip(await gameData.data.Ship.get(shipId));
                sender.components.set(ControlledByComponent,
                    { peerId: 'peer-a' });
                sender.components.set(MultiplayerData, { owner: 'peer-a' });
                await completeEntity(world, sender);
                world.entities.set('peer-a-ship', sender);

                client.step(6);
                client.snapshot();
                const tick = client.status().tick;

                // The relay forwards peer A's hail, stamped three ticks ago.
                const communicator = world.resources
                    .get(CommunicatorResource) as MockCommunicator;
                communicator.messages.next({
                    source: 'server',
                    message: wrapRollbackMessage({
                        kind: 'inputs',
                        record: {
                            peerId: 'peer-a', tick: tick - 3,
                            inputs: [{
                                kind: 'hail', action: {
                                    kind: 'message', target: shipUuid,
                                    message: 'greetings',
                                },
                            }, {
                                // And the old exploit, in the same record.
                                kind: 'hail', action: {
                                    kind: 'requestAssistance', target: shipUuid,
                                },
                            }],
                        },
                    }),
                });
                client.step();
                client.snapshot();

                expect(world.entities.get('peer-a-ship')!.components
                    .get(SentHailComponent)).toEqual(jasmine.objectContaining({
                        to: shipUuid, message: 'greetings', seq: 1,
                    }));
                const mine = world.entities.get(shipUuid)!;
                expect(mine.components.has(SentHailComponent)).toBeFalse();
                expect(mine.components.has(AssistingComponent)).toBeFalse();
            });
    });
