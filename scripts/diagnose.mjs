import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
console.log(`Node ${process.version} · ${process.platform}`);
console.log(`Dependências: ${existsSync('node_modules/next/package.json')?'instaladas':'ausentes'}`);
let blocked=false;
for(const stdio of ['ignore','inherit','pipe']){
 const result=spawnSync(process.execPath,['-e','process.exit(0)'],{stdio,windowsHide:true,timeout:10000});
 console.log(`Processo filho / stdio=${stdio}: ${result.error?.code||`saída ${result.status}`}`);
 if(result.error||result.status!==0)blocked=true;
}
if(blocked){
 console.error('O ambiente recusou uma operação necessária às ferramentas de build. Este teste não altera permissões nem configurações.');
 process.exitCode=1;
}else console.log('Criação de processos e canais de comunicação disponível.');
