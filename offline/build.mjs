import {build} from 'esbuild';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
const out = path.join(root, 'build/offline');
await mkdir(out, {recursive:true});
const alias = {resource_fork:path.join(root,'resource_fork/index.ts')};
for (const name of ['default_pict','default_rled']) {
    const bytes = await readFile(path.join(root,'novadatainterface',name+'.png'));
    const target = path.join(out,name+'.ts');
    await writeFile(target, 'export default new Uint8Array('+JSON.stringify([...bytes])+');');
    alias['novadatainterface/'+name] = target;
}
const nodeModules = path.join(root,'offline/node_modules');
const common = {absWorkingDir:root, bundle:true, alias, nodePaths:[nodeModules], tsconfig:path.join(root,'tsconfig.json')};
await build({...common, entryPoints:['offline/export.ts'], platform:'node', packages:'external', outfile:path.join(out,'export.cjs')});
execFileSync(process.execPath,[path.join(out,'export.cjs')],{stdio:'inherit',env:{...process.env,NODE_PATH:nodeModules}});
await build({...common,entryPoints:['nova/src/offline.ts'],platform:'browser',minify:true,outfile:path.join(out,'browser.js')});
execFileSync('python3',['offline/pack.py'],{stdio:'inherit'});
console.log('Created build/offline/NovaJS-Offline.html');
