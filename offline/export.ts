import {NovaParse} from '../novaparse/NovaParse';
import {FilesystemData} from '../nova/src/server/parsing/FilesystemData';
import {GameDataAggregator} from '../nova/src/server/parsing/GameDataAggregator';
import fs from 'fs';
async function main(){
const warnings:string[]=[];
const game=new GameDataAggregator([new FilesystemData('nova/objects'),new NovaParse(process.env.NOVA_DATA_PATH || 'nova/Nova_Data',false)],m=>warnings.push(m));
const ids=await game.ids;
fs.mkdirSync('build/offline/assets',{recursive:true});
fs.writeFileSync('build/offline/assets/ids.json',JSON.stringify(ids));
for(const [type,list] of Object.entries(ids)){
 console.log(type,list.length);
 for(const id of list){
 try{const data=await (game.data as any)[type].get(id);
 let ext='json', bytes:any=JSON.stringify(data);
 if(data instanceof ArrayBuffer || Buffer.isBuffer(data)){ext=type==='SoundFile'?'mp3':'png';bytes=Buffer.from(data as any);}
 fs.mkdirSync('build/offline/assets/'+type,{recursive:true});
 fs.writeFileSync('build/offline/assets/'+type+'/'+id+'.'+ext,bytes);
 }catch(e){warnings.push(type+'/'+id+': '+e);}
 }
}
fs.writeFileSync('build/offline/warnings.txt',warnings.join('\n'));console.log('DONE warnings',warnings.length);
}main().catch(e=>{console.error(e);process.exit(1)});
