// Standalone integration verification using Node's test runner and the actual embedded database.
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {mkdir,readFile,writeFile,copyFile,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const directory=await mkdtemp(path.resolve('.data-check-'));
const sources=['server/db.ts','server/auth.ts','server/alerts.ts','app/api/[...path]/route.ts','core/alerts.mjs','core/configuration.mjs','server/supabase.ts','server/schema.ts','server/engine.ts','server/backups.ts','core/security.mjs','core/failover.mjs','core/capacity.mjs'];
for(const relative of sources){
 const destination=path.join(directory,relative.replace(/\.ts$/,'.js'));await mkdir(path.dirname(destination),{recursive:true});
 if(relative.endsWith('.mjs')){await copyFile(path.join('src',relative),destination);continue;}
 let source=await readFile(path.join('src',relative),'utf8');
 source=source.replace("from 'next/server'","from 'next/server.js'");
 source=source.replace(/from (['"])(\.[^'"]+)\1/g,(match,quote,specifier)=>`from ${quote}${path.extname(specifier)?specifier:specifier+'.js'}${quote}`);
 await writeFile(destination,ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
}
await writeFile(path.join(directory,'package.json'),'{"type":"module"}');
process.env.NODE_ENV='test';delete process.env.DATABASE_URL;
process.env.HUB_DATA_DIR=path.join(directory,'postgres');process.env.HUB_ENCRYPTION_KEY='a'.repeat(64);
const db=await import(pathToFileURL(path.join(directory,'server/db.js')).href);
const {encrypt,passwordHash}=await import(pathToFileURL(path.join(directory,'core/security.mjs')).href);
const api=await import(pathToFileURL(path.join(directory,'server/supabase.js')).href);
const engine=await import(pathToFileURL(path.join(directory,'server/engine.js')).href);
const previousFetch=globalThis.fetch;
after(async()=>{globalThis.fetch=previousFetch;await rm(directory,{recursive:true,force:true}).catch(()=>{});});
test('embedded control database, transaction rollback, multi-account discovery and protected routing',async()=>{
 const database=await db.database();
 await assert.rejects(database.transaction(async tx=>{await tx.query(db.sql`INSERT INTO organizations(id,name) VALUES('rollback','Temp')`);throw new Error('rollback');}));
 assert.equal((await db.query(db.sql`SELECT id FROM organizations WHERE id='rollback'`)).length,0);
 for(const id of ['account-1','account-2'])await db.query(db.sql`INSERT INTO connections(id,name,account_id,kind,secret) VALUES(${id},${id},${id},'pat',${encrypt({access_token:'private-test-token'},id)})`);
 globalThis.fetch=async url=>new Response(JSON.stringify(String(url).endsWith('/organizations')?[{id:'org',name:'Org'}]:[{id:'abcdefghijklmnopqrst',organization_id:'org',name:'Project'}]),{status:200});
 await api.discover('account-1');await api.discover('account-2');
 assert.equal((await db.query(db.sql`SELECT * FROM projects`)).length,1);
 assert.equal((await db.query(db.sql`SELECT * FROM project_connections`)).length,2);
 await db.query(db.sql`DELETE FROM connections WHERE id='account-1'`);
 assert.equal((await db.query(db.sql`SELECT * FROM projects`)).length,1);
 await db.query(db.sql`UPDATE projects SET publishable_key='sb_publishable_test'`);
 const app=await engine.registerApplication({name:'Site',activeRef:'abcdefghijklmnopqrst',dataPolicy:'independent',authMode:'none'});
 await assert.rejects(engine.resolveRoute(app.id,'wrong'));
 assert.equal((await engine.resolveRoute(app.id,app.machineToken)).ref,'abcdefghijklmnopqrst');
 const snapshot=JSON.stringify(await engine.state());
 assert.ok(!snapshot.includes('private-test-token'));assert.ok(!snapshot.includes(app.machineToken));
 assert.deepEqual((await engine.state()).projectConnections,[{project_ref:'abcdefghijklmnopqrst',connection_id:'account-2'}]);
 await db.query(db.sql`UPDATE applications SET blocked=true WHERE id=${app.id}`);
 await assert.rejects(engine.resolveRoute(app.id,app.machineToken));
});
test('password-only login rejects invalid passwords, cross-origin writes and expired sessions',async()=>{
 const auth=await import(pathToFileURL(path.join(directory,'server/auth.js')).href);
 const password='test-only-private-password';
 process.env.ADMIN_PASSWORD_HASH=passwordHash(password);
 process.env.HUB_ORIGIN='http://127.0.0.1:3000';
 await assert.rejects(auth.login('wrong'));
 const token=await auth.login(password);
 assert.notEqual(await auth.login(password),token);
 const request=new Request('http://127.0.0.1:3000/api/action',{headers:{cookie:`hub_session=${token}`,origin:process.env.HUB_ORIGIN}});
 assert.equal((await auth.principal(request,true)).role,'admin');
 await assert.rejects(auth.principal(new Request(request,{headers:{cookie:`hub_session=${token}`,origin:'https://other.invalid'}}),true));
 await db.query(db.sql`UPDATE sessions SET expires_at=now()-interval '1 second'`);
 await assert.rejects(auth.principal(request));
 assert.ok(auth.sessionCookie(token).includes('HttpOnly'));
});
test('real API handlers enforce private access, origin, validation, secret isolation and logout',async()=>{
 const route=await import(pathToFileURL(path.join(directory,'app/api/[...path]/route.js')).href);
 const origin='http://127.0.0.1:3000';
 const call=(pathname,{method='GET',body,cookie,from=origin}={})=>{
  const headers={origin:from};if(cookie)headers.cookie=cookie;if(body)headers['content-type']='application/json';
  return route[method](new Request(`${origin}/api/${pathname}`,{method,headers,body:body?JSON.stringify(body):undefined}),{params:Promise.resolve({path:pathname.split('/')})});
 };
 const key=process.env.HUB_ENCRYPTION_KEY;delete process.env.HUB_ENCRYPTION_KEY;
 const unconfigured=await call('health');assert.equal(unconfigured.status,200);assert.deepEqual(await unconfigured.json(),{ok:true,configured:false});
 process.env.HUB_ENCRYPTION_KEY=key;
 assert.deepEqual(await (await call('health')).json(),{ok:true,configured:true});
 assert.equal((await call('state')).status,401);
 assert.equal((await call('action',{method:'POST',body:{action:'metrics.collect',input:{}}})).status,401);
 const password='api-only-test-password';process.env.ADMIN_PASSWORD_HASH=passwordHash(password);
 assert.equal((await call('auth/login',{method:'POST',body:{password:'wrong'}})).status,401);
 assert.equal((await call('auth/login',{method:'POST',body:{password},from:'https://other.invalid'})).status,403);
 const login=await call('auth/login',{method:'POST',body:{password}});assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie').split(';')[0];
 assert.equal((await call('state',{cookie})).status,200);
 const create={action:'connection.create',input:{name:'API test',accountId:'api-account',token:'api-secret-test-token'}};
 assert.equal((await call('action',{method:'POST',cookie,from:'https://other.invalid',body:create})).status,403);
 assert.equal((await call('action',{method:'POST',cookie,body:{action:'connection.create',input:{}}})).status,400);
 const created=await call('action',{method:'POST',cookie,body:create});assert.equal(created.status,200);
 const connectionId=(await created.json()).id;assert.ok(connectionId);
 assert.equal((await call('action',{method:'POST',cookie,body:{action:'connection.update',input:{id:connectionId,name:'Disabled',enabled:false}}})).status,200);
 assert.equal((await call('action',{method:'POST',cookie,body:{action:'connection.update',input:{id:connectionId,name:'Rotated',enabled:true,token:'rotated-private-api-token'}}})).status,200);
 assert.equal((await api.credentials(connectionId)).access_token,'rotated-private-api-token');
 const snapshot=await call('state',{cookie});assert.equal(snapshot.headers.get('cache-control'),'no-store');const snapshotText=await snapshot.text();assert.ok(!snapshotText.includes('api-secret-test-token'));assert.ok(!snapshotText.includes('rotated-private-api-token'));
 assert.equal((await call('action',{method:'POST',cookie,body:{action:'failover.execute',input:{applicationId:'invalid',target:'invalid',version:1,confirmation:'SWITCH invalid'}}})).status,400);
 assert.equal((await call('action',{method:'POST',cookie,body:{action:'backup.restore',input:{id:'invalid',target:'invalid',confirmation:'wrong'}}})).status,400);
 assert.equal((await call('auth/logout',{method:'POST',cookie,body:{}})).status,200);
 assert.equal((await call('state',{cookie})).status,401);
});
test('Storage backup encrypts, restores an authenticated artifact and rejects corruption',async()=>{
 const backups=await import(pathToFileURL(path.join(directory,'server/backups.js')).href);
 process.env.BACKUP_DIRECTORY=path.join(directory,'backup-artifacts');
 await db.query(db.sql`UPDATE connections SET secret=${encrypt({access_token:'private-test-token',storage_key:'test-only-storage-key'},'account-2')} WHERE id='account-2'`);
 globalThis.fetch=async()=>new Response('[]',{status:200,headers:{'Content-Type':'application/json'}});
 const source='abcdefghijklmnopqrst';const target='bbbbbbbbbbbbbbbbbbbb';
 await db.query(db.sql`INSERT INTO projects(ref,organization_id,name) VALUES(${target},'org','Backup target')`);
 await db.query(db.sql`INSERT INTO project_connections(project_ref,connection_id) VALUES(${target},'account-2')`);
 const job=await backups.queueBackup(source,'storage');await backups.runBackup(job.id);
 const artifact=await backups.downloadBackup(job.id);
 assert.equal(artifact.job.state,'COMPLETED');
 const bytes=await readFile(artifact.filename);assert.equal(bytes.subarray(0,5).toString(),'HBAK1');
 assert.ok(!bytes.includes(Buffer.from('hub-storage-v1')));
 await assert.rejects(backups.restoreBackup(job.id,target,'wrong','test'));
 const restored=await backups.restoreBackup(job.id,target,`RESTORE ${target}`,'test');
 assert.equal(restored.restored,true);assert.equal(restored.requiresValidation,true);
 const corrupt=Buffer.from(bytes);corrupt[20]^=1;await writeFile(artifact.filename,corrupt);
 await assert.rejects(backups.downloadBackup(job.id));
});
test('failed destination verification rolls back the route and records the operation',async()=>{
 const target='bbbbbbbbbbbbbbbbbbbb';
 const [app]=await db.query(db.sql`SELECT * FROM applications WHERE name='Site'`);
 await db.query(db.sql`UPDATE applications SET blocked=false WHERE id=${app.id}`);
 await db.query(db.sql`UPDATE projects SET publishable_key='sb_publishable_test' WHERE ref=${target}`);
 await db.query(db.sql`INSERT INTO pool_members(application_id,project_ref,priority,role) VALUES(${app.id},${target},1,'reserve')`);
 for(const category of ['database_bytes','storage_bytes'])await db.query(db.sql`INSERT INTO capacity_limits(id,scope,resource_id,category,capacity,unit,source) VALUES(${category},'PROJECT_LEVEL',${target},${category},1000,'bytes','test')`);
 let destinationChecks=0;
 globalThis.fetch=async(url,options)=>{
  const statement=JSON.parse(options.body).query;
  if(statement.includes('pg_database_size')){
   if(String(url).includes(target)&&++destinationChecks>=2)return new Response('{}',{status:503});
   return new Response('[{"bytes":"10"}]',{status:200});
  }
  if(statement.includes('metadata'))return new Response('[{"bytes":"10"}]',{status:200});
  return new Response('[]',{status:200});
 };
 await assert.rejects(engine.executeSwitch(app.id,target,app.version,'test'),/rota anterior restaurada/);
 const [after]=await db.query(db.sql`SELECT * FROM applications WHERE id=${app.id}`);
 assert.equal(after.active_ref,app.active_ref);assert.equal(after.blocked,false);assert.equal(after.version,app.version+2);
 const [operation]=await db.query(db.sql`SELECT * FROM operations WHERE application_id=${app.id} ORDER BY created_at DESC LIMIT 1`);
 assert.equal(operation.state,'ROLLED_BACK');
});

test('null, empty and malformed measurements stay unavailable; real zero stays measured',async()=>{
 const ref='abcdefghijklmnopqrst';
 for(const value of [null,'',false,'NaN','-1',{}]){
  globalThis.fetch=async()=>new Response(JSON.stringify([{bytes:value}]),{status:200});
  const result=await api.collect(ref);assert.equal(result.errors.length,2);
  const latest=await db.query(db.sql`SELECT DISTINCT ON(category) * FROM observations WHERE resource_id=${ref} ORDER BY category,collected_at DESC`);
  assert.ok(latest.length>=2);assert.ok(latest.every(o=>o.value===null));
  const [project]=await db.query(db.sql`SELECT health FROM projects WHERE ref=${ref}`);assert.equal(project.health,'unknown');
 }
 globalThis.fetch=async()=>new Response('[{"bytes":"0"}]',{status:200});
 assert.deepEqual((await api.collect(ref)).errors,[]);
 const latest=await db.query(db.sql`SELECT DISTINCT ON(category) * FROM observations WHERE resource_id=${ref} ORDER BY category,collected_at DESC`);
 assert.ok(latest.every(o=>o.value===0));
});

test('persisted alerts and account memberships reach the real dashboard snapshot',async()=>{
 const {refreshAlerts}=await import(pathToFileURL(path.join(directory,'server/alerts.js')).href);
 const {resourceGroups}=await import('../src/core/resources.mjs');
 const ref='abcdefghijklmnopqrst';
 await db.query(db.sql`INSERT INTO capacity_limits(id,scope,resource_id,category,capacity,unit,source) VALUES('snapshot-limit','PROJECT_LEVEL',${ref},'database_bytes',100,'bytes','test')`);
 globalThis.fetch=async()=>new Response('[{"bytes":"96"}]',{status:200});
 await api.collect(ref);await refreshAlerts();
 const snapshot=await engine.state();
 assert.ok(snapshot.alerts.some(a=>a.limit_id==='snapshot-limit'&&a.severity==='critical'));
 assert.ok(snapshot.projectConnections.some(pc=>pc.project_ref===ref&&pc.connection_id==='account-2'));
 assert.equal(resourceGroups(snapshot,'account','database_bytes').find(g=>g.id==='account-2').total,2);
 assert.ok(!JSON.stringify(snapshot).includes('rotated-private-api-token'));
});

test('route capacity rejects negative, absent, stale and future observations',async()=>{
 const ref='bbbbbbbbbbbbbbbbbbbb';
 const project={ref,organization_id:'org'};
 for(const invalid of [{value:-1,time:Date.now()},{value:null,time:Date.now()},{value:10,time:Date.now()-600000},{value:10,time:Date.now()+86400000}]){
  await db.query(db.sql`DELETE FROM observations WHERE resource_id=${ref}`);
  await db.query(db.sql`INSERT INTO observations(id,scope,resource_id,category,value,unit,source,collected_at) VALUES('capacity-invalid','PROJECT_LEVEL',${ref},'database_bytes',${invalid.value},'bytes','test',${new Date(invalid.time).toISOString()})`);
  await db.query(db.sql`INSERT INTO observations(id,scope,resource_id,category,value,unit,source) VALUES('capacity-valid','PROJECT_LEVEL',${ref},'storage_bytes',10,'bytes','test')`);
  assert.ok((await engine.capacityReasons(project)).some(r=>r.includes('database_bytes')));
 }
 await db.query(db.sql`UPDATE observations SET value=10,collected_at=now() WHERE id='capacity-invalid'`);
 assert.deepEqual(await engine.capacityReasons(project),[]);
});
