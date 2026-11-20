import { randomUUID } from 'node:crypto';
import { database, query, sql } from '../src/server/db';
import { collect } from '../src/server/supabase';
import { queueBackup,runBackup,retainBackups } from '../src/server/backups';
import { executeSwitch,plan,audit } from '../src/server/engine';
import { latestObservations } from '../src/core/capacity.mjs';
import { refreshAlerts } from '../src/server/alerts';

if (!process.env.DATABASE_URL) throw new Error('Worker independente requer DATABASE_URL. PGlite aceita somente um processo.');
const owner = randomUUID(); let stopping = false;
process.on('SIGTERM',()=>{stopping=true;}); process.on('SIGINT',()=>{stopping=true;});
async function tick() {
  const [lease] = await query(sql`INSERT INTO worker_leases(name,owner,until_at) VALUES('monitor',${owner},now()+interval '30 minutes') ON CONFLICT(name) DO UPDATE SET owner=excluded.owner,until_at=excluded.until_at WHERE worker_leases.until_at<now() RETURNING owner`);
  if (!lease) return;
  try {
    // Interrupted switches are never silently marked successful.
    await (await database()).transaction(async db => {
      await db.query(sql`UPDATE applications SET blocked=true WHERE id IN(SELECT application_id FROM operations WHERE state IN ('SWITCHING','VERIFYING','ROLLING_BACK') AND updated_at<now()-interval '30 minutes')`);
      await db.query(sql`UPDATE operations SET state='NEEDS_ATTENTION',updated_at=now() WHERE state IN ('PLANNING','VALIDATING','SWITCHING','VERIFYING','ROLLING_BACK') AND updated_at<now()-interval '30 minutes'`);
      await db.query(sql`UPDATE backup_jobs SET state='FAILED',error='Worker interrompido durante exportação.' WHERE state='RUNNING' AND created_at<now()-interval '30 minutes'`);
    });
    const projects=await query(sql`SELECT DISTINCT p.* FROM projects p JOIN project_connections pc ON pc.project_ref=p.ref JOIN connections c ON c.id=pc.connection_id WHERE c.enabled=true`);
    for(const p of projects) { if(stopping)break;await collect(p.ref).catch(()=>undefined); }
    await refreshAlerts();
    const apps=await query(sql`SELECT * FROM applications WHERE paused=false AND blocked=false`);
    for(const app of apps) {
      const p=projects.find(p=>p.ref===app.active_ref); if(!p)continue;
      const limits=await query(sql`SELECT * FROM capacity_limits WHERE (scope='PROJECT_LEVEL' AND resource_id=${p.ref}) OR (scope='ORGANIZATION_LEVEL' AND resource_id=${p.organization_id})`);
      const observations=latestObservations(await query(sql`SELECT * FROM observations WHERE collected_at>now()-interval '3 minutes' ORDER BY collected_at DESC`));
      let cause: any = null;
      for(const limit of limits) {
        if(!['database_bytes','storage_bytes'].includes(limit.category))continue;
        const refs=limit.scope==='PROJECT_LEVEL'?[p.ref]:projects.filter(x=>x.organization_id===p.organization_id).map(x=>x.ref);
        const values=refs.map(ref=>observations.find(o=>o.scope==='PROJECT_LEVEL'&&o.resource_id===ref&&o.category===limit.category));
        if(values.every(o=>o?.value!=null)&&values.reduce((s,o)=>s+Number(o.value),0)>=Number(limit.capacity)*limit.critical/100){cause=limit;break;}
      }
      if(!cause)continue;
      const planned=await plan(app.id,undefined,true).catch(()=>null); if(!planned?.selected)continue;
      const target=projects.find(p=>p.ref===planned.selected);
      if(cause.scope==='ORGANIZATION_LEVEL'&&target?.organization_id===p.organization_id)continue;
      await executeSwitch(app.id,planned.selected,planned.version,'worker',true).catch(()=>undefined);
    }
    const schedules=await query(sql`SELECT * FROM backup_schedules WHERE enabled=true AND next_run<=now()`);
    for(const schedule of schedules){
      try{await queueBackup(schedule.project_ref,schedule.kind);await query(sql`UPDATE backup_schedules SET next_run=now()+every_hours*interval '1 hour' WHERE project_ref=${schedule.project_ref}`);}catch{await audit('worker','backup.schedule.failed',schedule.project_ref);}
    }
    const jobs=await query(sql`SELECT id FROM backup_jobs WHERE state='QUEUED' ORDER BY created_at LIMIT 5`);
    for(const job of jobs){if(stopping)break;await runBackup(job.id);}
    await retainBackups();
    await query(sql`DELETE FROM sessions WHERE expires_at<now()`); await query(sql`DELETE FROM oauth_states WHERE expires_at<now()`);
    await query(sql`DELETE FROM rate_limits WHERE reset_at<now()-interval '1 day'`);
  }finally{await query(sql`DELETE FROM worker_leases WHERE name='monitor' AND owner=${owner}`);}
}
console.log('Control Hub worker iniciado.');
while(!stopping){await tick().catch(()=>console.error('Ciclo do worker falhou; será repetido.'));for(let i=0;i<30&&!stopping;i++)await new Promise(r=>setTimeout(r,1000));}
process.exit(0);
