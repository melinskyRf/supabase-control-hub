import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
let directory:string;
let db: typeof import('../src/server/db');
beforeAll(async()=>{
 directory=await mkdtemp(path.join(tmpdir(),'hub-test-'));
 vi.stubEnv('NODE_ENV','test');vi.stubEnv('HUB_DATA_DIR',directory);vi.stubEnv('DATABASE_URL','');
 vi.stubEnv('HUB_ENCRYPTION_KEY','a'.repeat(64));
 db=await import('../src/server/db');
});
test('control database migrates and rolls back an incomplete discovery transaction',async()=>{
 const database=await db.database();
 await expect(database.transaction(async tx=>{
   await tx.query(db.sql`INSERT INTO organizations(id,name) VALUES('rollback-org','Temporary')`);
   throw new Error('network snapshot incomplete');
 })).rejects.toThrow('network snapshot incomplete');
 expect(await db.query(db.sql`SELECT id FROM organizations WHERE id='rollback-org'`)).toHaveLength(0);
});
test('discovery of one shared project through two accounts keeps one project identity',async()=>{
 const {encrypt}=await import('../src/core/security.mjs');
 const {discover}=await import('../src/server/supabase');
 for(const id of ['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222']){
  await db.query(db.sql`INSERT INTO connections(id,name,account_id,kind,secret) VALUES(${id},${id},${id},'pat',${encrypt({access_token:'private-test-token'},id)})`);
 }
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(JSON.stringify(url.endsWith('/organizations')?[{id:'shared-org',name:'Shared'}]:[{id:'abcdefghijklmnopqrst',organization_id:'shared-org',name:'Project',region:'local',status:'ACTIVE_HEALTHY'}]),{status:200,headers:{'Content-Type':'application/json'}})));
 await discover('11111111-1111-4111-8111-111111111111');
 await discover('22222222-2222-4222-8222-222222222222');
 expect(await db.query(db.sql`SELECT * FROM projects`)).toHaveLength(1);
 expect(await db.query(db.sql`SELECT * FROM project_connections`)).toHaveLength(2);
 await db.query(db.sql`DELETE FROM connections WHERE id='11111111-1111-4111-8111-111111111111'`);
 expect(await db.query(db.sql`SELECT * FROM projects`)).toHaveLength(1);
 expect(await db.query(db.sql`SELECT * FROM project_connections`)).toHaveLength(1);
});
test('snapshot omits connection credentials and route validates machine token',async()=>{
 const {state,registerApplication,resolveRoute}=await import('../src/server/engine');
 await db.query(db.sql`UPDATE projects SET publishable_key='sb_publishable_test' WHERE ref='abcdefghijklmnopqrst'`);
 const app=await registerApplication({name:'Integration test',activeRef:'abcdefghijklmnopqrst',dataPolicy:'independent',authMode:'none'});
 await expect(resolveRoute(app.id,'invalid')).rejects.toThrow();
 expect((await resolveRoute(app.id,app.machineToken)).ref).toBe('abcdefghijklmnopqrst');
 const snapshot=JSON.stringify(await state());
 expect(snapshot).not.toContain('private-test-token');expect(snapshot).not.toContain(app.machineToken);
 await db.query(db.sql`UPDATE applications SET blocked=true WHERE id=${app.id}`);
 await expect(resolveRoute(app.id,app.machineToken)).rejects.toThrow('Roteamento temporariamente bloqueado.');
});
afterAll(async()=>{
 vi.unstubAllGlobals();vi.unstubAllEnvs();
 // PGlite owns its directory until process exit; on Windows open files may prevent cleanup.
 if(directory)await rm(directory,{recursive:true,force:true}).catch(()=>undefined);
});
