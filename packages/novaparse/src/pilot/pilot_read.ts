/**
 * Disk access for pilot files (node only): reads a file's data fork and,
 * for a Mac pilot, its resource fork. Split from pilot_parse.ts so the
 * parser itself stays browser-safe (no fs).
 */
import { readResourceFork, ResourceMap } from "resource_fork";
import { PilotData } from "./pilot_data.js";
import { isPltPilot, parsePilotResources, parsePltPilot } from "./pilot_parse.js";

/**
 * Reads a pilot file from disk, auto-detecting the container:
 * - a flat Windows-style .plt file (data fork), or
 * - a Mac pilot: resource fork (or resource-fork-format data fork, e.g. a
 *   pilot copied off a Mac as raw fork data) holding 'NpïL' 128/129.
 */
export async function readPilot(filePath: string): Promise<PilotData> {
    const fs = await import("fs");
    const dataFork = await fs.promises.readFile(filePath);
    const dataForkBytes = new Uint8Array(
        dataFork.buffer, dataFork.byteOffset, dataFork.byteLength);
    if (isPltPilot(dataForkBytes)) {
        return parsePltPilot(dataForkBytes);
    }
    let map: ResourceMap;
    try {
        map = await readResourceFork(filePath, true);
    } catch {
        // No (valid) resource fork; the data fork may itself be resource-
        // fork-format data.
        map = await readResourceFork(filePath, false);
    }
    return parsePilotResources(map);
}
