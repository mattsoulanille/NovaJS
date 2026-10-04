import 'jasmine';
import * as multiplayerTypes from './multiplayer_plugin.js';

describe('multiplayer_plugin module', () => {
    it('exports only the multiplayer types, not the legacy delta-sync plugin', () => {
        // The legacy `multiplayer()` plugin applied state / remove / delta
        // messages from any peer with its ownership checks commented out
        // (#317). Nothing loads it any more — rollback rooms replaced it —
        // so it was deleted; this pins the module to the types the game
        // imports, so no world (outer or simulation, #166) can load it.
        expect(Object.keys(multiplayerTypes).sort()).toEqual([
            'CommunicatorResource',
            'MultiplayerData',
            'MultiplayerDataType',
            'Peers',
        ]);
    });
});
