/**
 * Input/frame sync for novaref recordings.
 *
 * The remote helper stamps every input event it posts with the old Mac's
 * host clock (mach_absolute_time, in seconds). ffmpeg's avfoundation input
 * timestamps captured frames on the same clock and logs the first one as
 * "start: <seconds>"; the mp4 keeps the capture's variable frame timing
 * (pts relative to that first frame). So an event's time in the recording
 * is host - start, and its frame index is the last frame whose pts is not
 * after that time (the frame on screen when the event was posted).
 */
import { spawnSync } from "node:child_process";

/** The avfoundation input's start time from an ffmpeg -loglevel info log. */
export function parseFfmpegStart(log) {
    const m = /Input #0, avfoundation[\s\S]*?start:\s*([0-9]+(?:\.[0-9]+)?)/.exec(String(log));
    return m ? Number(m[1]) : null;
}

/**
 * Index of the last frame whose pts <= t (binary search over ascending
 * pts), -1 when t is before the first frame. Frames past the end map to
 * the last index; `exact` says whether t lies within the recording.
 */
export function frameAt(pts, t) {
    let lo = 0, hi = pts.length - 1, ans = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (pts[mid] <= t + 1e-9) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
}

/**
 * Maps stamped events ({host, ...}) onto a recording that started at host
 * time `startHost` with per-frame pts `pts` (seconds). Adds video_t (s) and
 * frame (index into the decoded frames, as ffmpeg/analysis tools count
 * them); frame is null when the event falls outside the recording.
 */
export function syncEvents(events, startHost, pts) {
    const end = pts.length ? pts[pts.length - 1] + 0.1 : 0;
    return events.map((e) => {
        const videoT = +(e.host - startHost).toFixed(4);
        const inside = videoT >= 0 && videoT <= end;
        return { ...e, video_t: videoT, frame: inside ? frameAt(pts, videoT) : null };
    });
}

/** True if a scenario step presses `e` (Enter Ship) as a bare key token. */
export function stepEntersShip(step) {
    if (typeof step?.keys !== "string") return false;
    return step.keys.split(/\s+/).some((t) => /^e(@\d+)?(\*\d+)?$/i.test(t));
}

/** Per-frame presentation times (s) of a local video, via ffprobe. */
export function probeFramePts(file, ffprobe = "ffprobe") {
    const r = spawnSync(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "frame=pts_time",
        "-of", "csv=p=0", file], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) return null;
    return r.stdout.split("\n").map((l) => parseFloat(l)).filter((v) => Number.isFinite(v));
}
