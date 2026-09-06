/**
 * Rate-limited warnings for hostile-input drop paths.
 *
 * Every message a peer can send is validated before it is acted on,
 * and every rejection is worth a log line — but a peer that can make
 * the server log a line per message can flood the log (and the event
 * loop) at wire speed, which turns "we dropped your garbage" into a
 * denial of service of its own. So each drop path warns at most once
 * per interval per key, and counts the rest.
 */
const lastWarned = new Map<string, { at: number, suppressed: number }>();

const DEFAULT_INTERVAL_MS = 1000;

/**
 * Logs `message()` under `key` unless the same key warned within the
 * last `intervalMs`; suppressed warnings are counted and reported with
 * the next one that gets through. `now` is injectable for tests.
 */
export function warnThrottled(key: string, message: () => string,
    { intervalMs = DEFAULT_INTERVAL_MS, now = Date.now() }: {
        intervalMs?: number, now?: number,
    } = {}): boolean {
    const entry = lastWarned.get(key);
    if (entry && now - entry.at < intervalMs) {
        entry.suppressed++;
        return false;
    }
    const suppressed = entry?.suppressed ?? 0;
    lastWarned.set(key, { at: now, suppressed: 0 });
    console.warn(message()
        + (suppressed > 0 ? ` (${suppressed} similar suppressed)` : ''));
    return true;
}

/** Forgets all throttle state (for tests). */
export function resetWarnThrottle() {
    lastWarned.clear();
}
