/**
 * `npm run synthetic-data` (packages/novaparse): regenerates the checked-in
 * synthetic Nova data set. An optional argument overrides the target root
 * (the directory that gets the "Nova Files" and "Plug-ins" children).
 */
import { SYNTHETIC_DATA_ROOT, writeSyntheticDataSet } from "./data_set.js";

const root = process.argv[2] ?? SYNTHETIC_DATA_ROOT;
const written = writeSyntheticDataSet(root);
console.log(`Wrote ${written}`);
