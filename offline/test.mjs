import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const root = fileURLToPath(new URL('..',import.meta.url));
process.chdir(root);
await build({absWorkingDir:root,entryPoints:['offline/test.ts'],outfile:'build/offline/test.cjs',bundle:true,platform:'node',alias:{resource_fork:path.join(root,'resource_fork/index.ts')},nodePaths:[path.join(root,'offline/node_modules')]});
execFileSync(process.execPath,['build/offline/test.cjs'],{stdio:'inherit'});
