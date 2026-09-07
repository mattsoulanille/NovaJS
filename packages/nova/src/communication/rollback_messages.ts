import { Communicator } from "nova_ecs/plugins/multiplayer_plugin";
import { Subscription } from "rxjs";
import { warnThrottled } from "../common/log_throttle.js";
import { InputRecord, PROTOCOL_VERSION, RollbackProtocolMessage, unwrapRollbackMessage, wrapRollbackMessage } from "./rollback_protocol.js";
import { liveWireFingerprint } from "./wire_schemas.js";

/**
 * The bridge host's side of the rollback protocol transport: which
 * room messages it accepts (server-originated only) and how a join's
 * catch-up is requested. The message shapes and codecs themselves
 * live in rollback_protocol.ts.
 */

/** The relay this peer publishes to, if it is in a room with one. */
export function relayServer(communicator: Communicator | undefined): string | undefined {
    return communicator?.uuid
        ? [...communicator.servers.value][0] : undefined;
}

/** What the host does with each relayed rollback message. */
export interface RollbackMessageHandlers {
    inputs(record: InputRecord): void;
    tickSync(tick: number): void;
    inputLog(records: InputRecord[]): void;
    desync(tick: number, hashes: [string, string][], canonical?: string): void;
    desyncDumpRequest(): void;
}

/**
 * Receives relayed rollback-protocol messages from the room and
 * dispatches them to the handlers.
 */
export function subscribeRollbackMessages(
    communicator: Communicator, handlers: RollbackMessageHandlers): Subscription {
    return communicator.messages.subscribe(({ source, message }) => {
        // Trust model item 4 (rollback_protocol.ts): every legitimate
        // rollback message a peer receives is server-originated — the relay is the single
        // fan-out, and it stamps each record's peerId with the
        // socket it came from. Anything from another source is a
        // forgery (a tickSync to derail pacing, a desync naming us,
        // a record wearing our own peerId/seq to move our applied
        // inputs, an inputLog steering our ship as "us") and is
        // dropped. The server also no longer relays client-chosen
        // destinations (communicator_server.ts), so this is belt
        // and braces.
        if (!communicator.servers.value.has(source)) {
            warnThrottled(`bridge-source:${source}`, () =>
                `Ignoring rollback message from non-server peer ${source}`);
            return;
        }
        const rollbackMessage = unwrapRollbackMessage(message);
        if (!rollbackMessage) {
            return;
        }
        switch (rollbackMessage.kind) {
            case 'inputs':
                handlers.inputs(rollbackMessage.record);
                break;
            case 'tickSync':
                handlers.tickSync(rollbackMessage.tick);
                break;
            case 'inputLog':
                handlers.inputLog(rollbackMessage.records);
                break;
            case 'desync':
                handlers.desync(rollbackMessage.tick,
                    rollbackMessage.hashes, rollbackMessage.canonical);
                break;
            case 'desyncDumpRequest':
                // The server wants this peer's state history as a
                // reference (e.g. its own archive was outvoted).
                handlers.desyncDumpRequest();
                break;
        }
    });
}

export type CatchUpMessage = Extract<RollbackProtocolMessage, { kind: 'catchUp' }>;

/**
 * Asks the relay for a catch-up (the input log, plus a baseline when
 * it has one), retrying until it answers or `timeoutMs` passes.
 * `onCatchUp` runs synchronously on the reply, before the returned
 * promise settles, so the caller's bookkeeping happens ahead of any
 * microtask that could observe the reply. A `joinRefused` (the relay's
 * wire schema differs) ends the attempt at once, with the reason
 * logged: retrying would be refused again.
 */
export function requestCatchUp(
    communicator: Communicator,
    { timeoutMs, fresh }: { timeoutMs: number, fresh: boolean },
    onCatchUp: (catchUp: CatchUpMessage) => void,
): Promise<CatchUpMessage | undefined> {
    return new Promise<CatchUpMessage | undefined>(resolve => {
        const subscription = communicator.messages.subscribe(({ source, message }) => {
            // Only the relay answers a join; a catchUp from anyone
            // else would hand us a fabricated world to reconstruct.
            if (!communicator.servers.value.has(source)) {
                return;
            }
            const rollbackMessage = unwrapRollbackMessage(message);
            if (rollbackMessage?.kind === 'catchUp') {
                clearInterval(retry);
                clearTimeout(timeout);
                subscription.unsubscribe();
                onCatchUp(rollbackMessage);
                resolve(rollbackMessage);
            } else if (rollbackMessage?.kind === 'joinRefused') {
                clearInterval(retry);
                clearTimeout(timeout);
                subscription.unsubscribe();
                console.error(`The relay refused the join: ${rollbackMessage.reason}`);
                resolve(undefined);
            }
        });
        const request = () => {
            const server = [...communicator.servers.value][0];
            if (server) {
                // Resyncs ask for a baseline captured now: the log
                // tail over a fresh baseline is just the transit
                // window, so recovery costs ~200ms instead of the
                // 1-2s rebuild of an up-to-30s-old baseline's tail.
                const schema = liveWireFingerprint();
                communicator.sendMessage(wrapRollbackMessage({
                    kind: 'joinRequest',
                    protocol: PROTOCOL_VERSION,
                    ...(fresh ? { fresh } : {}),
                    ...(schema !== undefined ? { schema } : {}),
                }), server);
            }
        };
        // The relay may not exist yet when the first peer joins.
        // Space the retries out: every request costs the server a
        // full catch-up reply (baseline + log, megabytes), and
        // stacking those drowns exactly the slow links that need
        // the retry.
        const retry = setInterval(request, 3000);
        const timeout = setTimeout(() => {
            clearInterval(retry);
            subscription.unsubscribe();
            resolve(undefined);
        }, timeoutMs);
        request();
    });
}
