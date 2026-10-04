import { produce } from 'immer';
import * as t from 'io-ts';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { Component } from '../component.js';
import { Resource } from '../resource.js';
import { setDifference } from '../utils.js';

/**
 * The multiplayer TYPES the game still uses: the `Communicator`
 * transport interface and its `Peers` view, the world resource that
 * holds a world's communicator, and the `MultiplayerData` ownership
 * component (on every simulation world and on the wire).
 *
 * This module used to export the legacy delta-sync `multiplayer()`
 * plugin, which applied `state` / `remove` / `delta` messages from any
 * peer (its ownership checks commented out). Rollback rooms replaced it:
 * the outer worlds stopped loading it in cf733f17 and the relay path
 * closed in 1005f887, after which only test fixtures, the node spec
 * worker and a benchmark loaded it. It was deleted (#317), which also
 * resolves #166 (pinning that the outer worlds cannot load it): there is
 * no plugin left to load. `multiplayer_plugin_test.ts` pins the export
 * list so it does not quietly return.
 */

export class Peers {
    readonly current: BehaviorSubject<Set<string>>;
    readonly join: Subject<string>;
    readonly leave: Subject<string>;

    constructor(p: BehaviorSubject<Set<string>> | {
        join: Subject<string>;
        leave: Subject<string>;
        initial?: Set<string>;
    }) {
        if (p instanceof BehaviorSubject) {
            this.current = p;
            const join = new Subject<string>();
            this.join = join;
            const leave = new Subject<string>();
            this.leave = leave;
            let lastPeers = new Set([...p.value]);
            p.subscribe(peers => {
                const joined = setDifference(peers, lastPeers);
                const left = setDifference(lastPeers, peers);
                for (const peer of joined) {
                    join.next(peer);
                }
                for (const peer of left) {
                    leave.next(peer);
                }
                lastPeers = new Set([...peers]);
            });
        } else {
            const { join, leave, initial } = p;
            this.current = new BehaviorSubject(initial ?? new Set());
            join.subscribe(peer => {
                this.current.next(produce(this.current.value, peers => {
                    peers.add(peer)
                }));
            });
            leave.subscribe(peer => {
                this.current.next(produce(this.current.value, peers => {
                    peers.delete(peer)
                }));
            });
            this.join = join;
            this.leave = leave;
        }
    }
}

export interface Communicator {
    uuid: string | undefined;
    peers: Peers,
    servers: BehaviorSubject<Set<string>>,
    messages: Observable<{ source: string, message: unknown }>,
    connected: BehaviorSubject<boolean>,
    sendMessage(message: unknown, destination?: string | Set<string>): void;
}

export const MultiplayerData = new Component<{ owner: string }>('MultiplayerData');
export const MultiplayerDataType = t.type({
    owner: t.string,
});

export interface MessageWithSource<M> {
    message: M,
    source: string,
}

export const CommunicatorResource = new Resource<Communicator>('CommunicatorResource');
