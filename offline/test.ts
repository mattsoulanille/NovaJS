import assert from 'node:assert/strict';
import {readResourceFork, Resource} from '../resource_fork';
import {SpobResource} from '../novaparse/src/resource_parsers/SpobResource';
import {defaultIDSpace} from '../novaparse/test/resource_parsers/DefaultIDSpace';
async function main() {
    const mac = await readResourceFork('novaparse/test/resource_parsers/files/spob.ndat', false);
    assert.equal(new SpobResource(mac.spöb[128], defaultIDSpace).landingPictID, 10003);
    assert.equal(new SpobResource(mac.spöb[129], defaultIDSpace).landingPictID, 10042);
    const data = new DataView(new ArrayBuffer(1118));
    data.setUint16(24, 65535);
    data.setUint16(26, 10020);
    assert.equal(new SpobResource(new Resource('spöb',128,'test',data,'rez'),defaultIDSpace).landingPictID,10020);
    const rez = await readResourceFork('resource_fork/test.rez', false);
    const entries = Object.values(rez).flatMap(group=>Object.values(group));
    assert.ok(entries.length);
    assert.ok(entries.every(resource=>resource.containerFormat === 'rez'));
    console.log('PASS: Mac landscape fixtures, Windows landscape layout, REZ metadata');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
