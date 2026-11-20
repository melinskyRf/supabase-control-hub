import { aggregate, categories } from '../src/core/capacity.mjs';
import { resourceGroups } from '../src/core/resources.mjs';
import { createInterface } from 'node:readline';
const tools=[
  {name:'hub_capacity',description:'Capacidade agregada por categoria, sem duplicar cotas compartilhadas.'},
  {name:'hub_health',description:'Saúde e atualidade das observações por projeto.'},
  {name:'hub_alerts',description:'Alertas persistidos e histórico de resolução.'},
  {name:'hub_resource_groups',description:'Consumo de banco por conta, organização e aplicação. Grupos não são somáveis.'},
  {name:'hub_overview',description:'Lê contas, organizações, projetos e capacidade observada.'},
  {name:'hub_projects',description:'Consulta projetos únicos e saúde, sem credenciais.'},
  {name:'hub_backups',description:'Consulta histórico e integridade dos backups.'},
  {name:'hub_activity',description:'Consulta auditoria e alternâncias.'},
];
const rl=createInterface({input:process.stdin,crlfDelay:Infinity});
function reply(id:unknown,result:unknown){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\n');}
for await(const line of rl){
  let message:any;
  try{
    message=JSON.parse(line);if(message.id===undefined)continue;
    if(message.method==='initialize'){reply(message.id,{protocolVersion:'2024-11-05',capabilities:{tools:{listChanged:false}},serverInfo:{name:'supabase-control-hub',version:'0.1.0'}});continue;}
    if(message.method==='ping'){reply(message.id,{});continue;}
    if(message.method==='tools/list'){reply(message.id,{tools:tools.map(t=>({...t,inputSchema:{type:'object',properties:{},additionalProperties:false}}))});continue;}
    if(message.method==='tools/call'){
      if(!tools.some(t=>t.name===message.params?.name))throw new Error('Unknown tool');
      if(!process.env.AGENT_READ_TOKEN)throw new Error('Configure AGENT_READ_TOKEN');
      const response=await fetch(`${process.env.HUB_ORIGIN || 'http://127.0.0.1:3000'}/api/agent/snapshot`,{headers:{Authorization:`Bearer ${process.env.AGENT_READ_TOKEN}`},redirect:'error',signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error('Control Hub unavailable');const data=await response.json();
      const name=message.params.name;
      const reports:Record<string,unknown>={hub_capacity:categories.map(category=>({category,...aggregate(data.projects,data.observations,data.limits,category,category==='egress_bytes'?new Date().toISOString().slice(0,7):'')})),hub_health:data.projects.map((p:any)=>({ref:p.ref,name:p.name,health:p.health,checkedAt:p.checked_at,authorized:p.authorized})),hub_alerts:data.alerts||[],hub_resource_groups:Object.fromEntries(['account','organization','application'].map(d=>[d,resourceGroups(data,d,'database_bytes')]))};
      const output=name in reports?reports[name]:message.params.name==='hub_projects'?data.projects:message.params.name==='hub_backups'?data.backups:message.params.name==='hub_activity'?{logs:data.logs,operations:data.operations}:data;
      reply(message.id,{content:[{type:'text',text:JSON.stringify(output)}]});continue;
    }
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Method not found'}})+'\n');
  }catch{if(message?.id!==undefined)reply(message.id,{isError:true,content:[{type:'text',text:'Não foi possível executar a ferramenta. Confira o servidor e o token de leitura.'}]});}
}
