import { test } from 'node:test';
import './configuration.test.mjs';
import { evaluateLimits } from '../src/core/alerts.mjs';
import { resourceGroups } from '../src/core/resources.mjs';
import assert from 'node:assert/strict';
import { aggregate, latestObservations, formatBytes } from '../src/core/capacity.mjs';
import { eligibility, fingerprint, schemaDifference } from '../src/core/failover.mjs';
import { encrypt, decrypt, passwordHash, passwordValid, projectOrigin, safeMessage } from '../src/core/security.mjs';
const projects=[{ref:'a',organization_id:'org'},{ref:'b',organization_id:'org'}];
const observation=(resource_id,value,at='2026-11-17T10:00:00Z')=>({scope:'PROJECT_LEVEL',resource_id,category:'database_bytes',period:'',value,collected_at:at});
const limit=(scope,resource_id,capacity)=>({scope,resource_id,category:'database_bytes',capacity,period:''});
test('shared allowances counted once, projects deduplicated across connections',()=>{
 const result=aggregate([...projects,projects[0]],[observation('a',4e9),observation('b',3e9)],[limit('ORGANIZATION_LEVEL','org',10e9)],'database_bytes');
 assert.equal(result.used,7e9);assert.equal(result.capacity,10e9);assert.equal(result.remaining,3e9);assert.equal(result.percent,70);assert.equal(result.total,2);
});
test('independent organization capacities add without mixing resources',()=>{
 const p=[projects[0],{ref:'c',organization_id:'other'}];
 const result=aggregate(p,[observation('a',2e9),observation('c',3e9)],[limit('PROJECT_LEVEL','a',8e9),limit('PROJECT_LEVEL','c',16e9),{...limit('PROJECT_LEVEL','a',5e9),category:'ram_bytes'}],'database_bytes');
 assert.equal(result.capacity,24e9);assert.equal(result.remaining,19e9);
});
test('missing or failed latest metrics never become zero or available capacity',()=>{
 const r=aggregate(projects,[observation('a',4e9),observation('a',null,'2026-11-17T11:00:00Z')],[limit('ORGANIZATION_LEVEL','org',10e9)],'database_bytes');
 assert.equal(r.used,null);assert.equal(r.remaining,null);assert.equal(r.complete,false);assert.equal(formatBytes(null),'Não monitorado');assert.equal(formatBytes(1e9),'1 GB');
 assert.equal(latestObservations([observation('a',1),observation('a',null,'2026-11-18')]).length,1);
});
test('monthly transfer never leaks across periods',()=>{
 const r=aggregate(projects,[{...observation('a',500),category:'egress_bytes',period:'2026-10'}],[],'egress_bytes','2026-11');assert.equal(r.used,null);
});
const now=Date.parse('2026-11-17T12:00:00Z');const stamp=new Date(now).toISOString();
test('account views deduplicate shared projects without assigning an entire shared allowance to subsets',()=>{
 const state={projects,connections:[{id:'c1',account_id:'one'},{id:'c2',account_id:'two'}],projectConnections:[{connection_id:'c1',project_ref:'a'},{connection_id:'c2',project_ref:'a'},{connection_id:'c2',project_ref:'b'}],applications:[],members:[],organizations:[{id:'org',name:'Org'}],observations:[observation('a',4),observation('b',3)],limits:[limit('ORGANIZATION_LEVEL','org',10)]};
 const groups=resourceGroups(state,'account','database_bytes');
 assert.equal(groups[0].used,4);assert.equal(groups[0].capacity,null);assert.equal(groups[1].used,7);assert.equal(groups[1].capacity,10);
 assert.equal(aggregate(projects,state.observations,state.limits,'database_bytes').used,7);
});
test('application view includes only pool members and omits unrelated shared capacity',()=>{
 const state={projects,applications:[{id:'app',name:'Site'}],members:[{application_id:'app',project_ref:'a'}],observations:[observation('a',4),observation('b',3)],limits:[limit('ORGANIZATION_LEVEL','org',10)]};
 const group=resourceGroups(state,'application','database_bytes')[0];assert.equal(group.used,4);assert.equal(group.total,1);assert.equal(group.remaining,null);
});
test('shared capacity alert sums once and respects configured thresholds',()=>{
 const limits=[{...limit('ORGANIZATION_LEVEL','org',100),id:'one',warning:70,elevated:85,critical:95}];
 const evaluate=(a,b)=>evaluateLimits([...projects,projects[0]],[observation('a',a,stamp),observation('b',b,stamp)],limits,now)[0];
 assert.equal(evaluate(40,30).severity,'warning');assert.equal(evaluate(40,46).severity,'elevated');assert.equal(evaluate(50,46).severity,'critical');assert.equal(evaluate(50,50).severity,'exhausted');assert.equal(evaluate(10,10).severity,'normal');
});
test('missing, stale, invalid or future telemetry cannot resolve an alert',()=>{
 const limits=[{...limit('PROJECT_LEVEL','a',100),id:'one',warning:70,elevated:85,critical:95}];
 for(const o of [observation('a',null,stamp),observation('a',4,'invalid'),observation('a',4,'2025-01-01'),observation('a',4,'2030-01-01')])assert.equal(evaluateLimits(projects,[o],limits,now)[0].severity,'unknown');
});
function fixture(){return {now,app:{data_policy:'independent',auth_mode:'none',cooldown_seconds:900},source:{ref:'a',schema_snapshot:{tables:[{name:'users'}]},schema_at:stamp},target:{ref:'b',authorized:true,restricted:false,health:'healthy',checked_at:stamp,schema_at:stamp,schema_snapshot:{tables:[{name:'users'}]},publishable_key:'sb_publishable_test'},member:{enabled:true}};}
test('compatible authorized destination eligible regardless of account ownership',()=>{const f=fixture();f.source.account_id='account-one';f.target.account_id='account-two';assert.equal(eligibility(f).eligible,true);});
test('schema policy differences block even with matching table names',()=>{assert.equal(schemaDifference({tables:['users'],policies:['private']},{tables:['users'],policies:['public']}).compatible,false);const f=fixture();f.target.schema_snapshot={tables:[]};assert.equal(eligibility(f).eligible,false);});
test('continuity policies require current scoped evidence',()=>{const f=fixture();f.app.data_policy='synchronized';assert.equal(eligibility(f).eligible,false);f.member.data_evidence={source_ref:'a',target_ref:'b',schema_hash:fingerprint(f.target.schema_snapshot),reference:'validated-job-1',policy:'synchronized',expires_at:new Date(now+60000).toISOString()};assert.equal(eligibility(f).eligible,true);f.member.data_evidence.target_ref='c';assert.equal(eligibility(f).eligible,false);});
test('Supabase Auth, stale timestamps, restriction and cooldown block switching',()=>{
 for(const mutate of [f=>f.app.auth_mode='supabase',f=>f.target.checked_at='invalid',f=>f.source.schema_at='invalid',f=>f.target.restricted=true,f=>f.target.authorized=false,f=>f.app.last_switch=stamp,f=>f.target.checked_at='2025-01-01',f=>f.app.blocked=true]){const f=fixture();mutate(f);assert.equal(eligibility(f).eligible,false);}
});
test('credentials encrypted and authenticated against connection identity',()=>{const key='a'.repeat(64);const encrypted=encrypt({token:'private-value'},'account-a',key);assert.ok(!encrypted.includes('private-value'));assert.deepEqual(decrypt(encrypted,'account-a',key),{token:'private-value'});assert.throws(()=>decrypt(encrypted,'account-b',key));assert.throws(()=>decrypt(encrypted.slice(0,-5)+'AAAAA','account-a',key));});
test('password hashing and SSRF restrictions fail closed',()=>{const h=passwordHash('a-long-private-password');assert.equal(passwordValid('wrong',h),false);assert.equal(passwordValid('a-long-private-password',h),true);assert.throws(()=>projectOrigin('https://127.0.0.1'));assert.throws(()=>projectOrigin('../metadata'));assert.equal(safeMessage(new Error('token=SECRET')).includes('SECRET'),false);});
