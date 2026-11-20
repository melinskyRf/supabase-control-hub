import { readOnly } from './supabase';
import { query, sql } from './db';
import { fingerprint, schemaDifference } from '../core/failover.mjs';

// Fixed read-only catalog queries. Never interpolate identifiers or accept arbitrary SQL from clients.
const sections: Record<string, string> = {
  tables: `select n.nspname as schema,c.relname as name,c.relkind,c.relrowsecurity,c.relforcerowsecurity
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p','v','m','f') order by 1,2`,
  columns: `select table_schema,table_name,column_name,ordinal_position,column_default,is_nullable,data_type,udt_schema,udt_name,character_maximum_length,numeric_precision,numeric_scale,is_identity,identity_generation,is_generated,generation_expression,collation_name
    from information_schema.columns where table_schema='public' order by table_name,ordinal_position`,
  indexes: `select schemaname,tablename,indexname,indexdef from pg_catalog.pg_indexes where schemaname='public' order by tablename,indexname`,
  constraints: `select n.nspname,c.relname,co.conname,co.contype,pg_catalog.pg_get_constraintdef(co.oid,true) as definition
    from pg_catalog.pg_constraint co join pg_catalog.pg_class c on c.oid=co.conrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by 1,2,3`,
  triggers: `select n.nspname,c.relname,t.tgname,t.tgenabled,pg_catalog.pg_get_triggerdef(t.oid,true) as definition
    from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal order by 1,2,3`,
  functions: `select n.nspname,p.proname,pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,pg_catalog.pg_get_functiondef(p.oid) as definition
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p') order by 1,2,3`,
  views: `select schemaname,viewname,definition from pg_catalog.pg_views where schemaname='public' order by viewname`,
  policies: `select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_catalog.pg_policies where schemaname='public' order by tablename,policyname`,
  grants: `select grantee,table_schema,table_name,privilege_type,is_grantable from information_schema.role_table_grants where table_schema='public' order by 1,2,3,4`,
  routine_grants: `select grantee,routine_schema,routine_name,privilege_type,is_grantable from information_schema.role_routine_grants where routine_schema='public' order by 1,2,3,4`,
  sequences: `select sequence_schema,sequence_name,data_type,start_value,minimum_value,maximum_value,increment,cycle_option from information_schema.sequences where sequence_schema='public' order by sequence_name`,
  extensions: `select e.extname,e.extversion,n.nspname as schema from pg_catalog.pg_extension e join pg_catalog.pg_namespace n on n.oid=e.extnamespace order by 1`,
  migrations: `select version,name from supabase_migrations.schema_migrations order by version`,
};
export async function snapshot(ref: string) {
  const result: Record<string, any[]> = {};
  for (const [key, statement] of Object.entries(sections)) result[key] = await readOnly(ref, statement);
  await query(sql`UPDATE projects SET schema_snapshot=${JSON.stringify(result)}::jsonb,schema_at=now() WHERE ref=${ref}`);
  return { ref, fingerprint: fingerprint(result), counts: Object.fromEntries(Object.entries(result).map(([k,v]) => [k,v.length])) };
}
export async function compare(sourceRef: string, targetRef: string) {
  await snapshot(sourceRef); await snapshot(targetRef);
  const rows = await query(sql`SELECT ref,schema_snapshot FROM projects WHERE ref IN (${sourceRef},${targetRef})`);
  return schemaDifference(rows.find(p => p.ref === sourceRef)?.schema_snapshot, rows.find(p => p.ref === targetRef)?.schema_snapshot);
}
