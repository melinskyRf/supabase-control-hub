CREATE TABLE IF NOT EXISTS connections (
 id text PRIMARY KEY, name text NOT NULL, account_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('pat','oauth','manual')), secret text NOT NULL,
 enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS organizations (id text PRIMARY KEY, name text NOT NULL, restricted boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS projects (
 ref text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id),
 name text NOT NULL, region text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'UNKNOWN',
 publishable_key text, environment text NOT NULL DEFAULT 'production', priority integer NOT NULL DEFAULT 100,
 health text NOT NULL DEFAULT 'unknown', checked_at timestamptz,
 schema_snapshot jsonb, schema_at timestamptz
);
CREATE TABLE IF NOT EXISTS project_connections (
 project_ref text REFERENCES projects(ref), connection_id text REFERENCES connections(id) ON DELETE CASCADE,
 PRIMARY KEY(project_ref,connection_id)
);
CREATE TABLE IF NOT EXISTS observations (
 id text PRIMARY KEY, scope text NOT NULL, resource_id text NOT NULL, category text NOT NULL,
 value double precision, unit text NOT NULL, source text NOT NULL, error text,
 collected_at timestamptz NOT NULL DEFAULT now(), period text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS observations_latest ON observations(scope,resource_id,category,collected_at DESC);
CREATE TABLE IF NOT EXISTS capacity_limits (
 id text PRIMARY KEY, scope text NOT NULL, resource_id text NOT NULL, category text NOT NULL,
 capacity double precision NOT NULL CHECK(capacity>0), unit text NOT NULL, source text NOT NULL,
 warning integer NOT NULL DEFAULT 70, elevated integer NOT NULL DEFAULT 85,
 critical integer NOT NULL DEFAULT 95, period text NOT NULL DEFAULT '',
 UNIQUE(scope,resource_id,category,period)
);
CREATE TABLE IF NOT EXISTS applications (
 id text PRIMARY KEY, name text NOT NULL, active_ref text REFERENCES projects(ref),
 version integer NOT NULL DEFAULT 1, paused boolean NOT NULL DEFAULT true,
 data_policy text NOT NULL CHECK(data_policy IN ('independent','synchronized','restored')),
 auth_mode text NOT NULL CHECK(auth_mode IN ('none','supabase','external')),
 machine_hash text NOT NULL, cooldown_seconds integer NOT NULL DEFAULT 900,
 last_switch timestamptz, blocked boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS pool_members (
 application_id text REFERENCES applications(id) ON DELETE CASCADE,
 project_ref text REFERENCES projects(ref), priority integer NOT NULL DEFAULT 100,
 role text NOT NULL DEFAULT 'reserve', enabled boolean NOT NULL DEFAULT true,
 data_evidence jsonb, identity_evidence jsonb,
 PRIMARY KEY(application_id,project_ref)
);
CREATE TABLE IF NOT EXISTS operations (
 id text PRIMARY KEY, application_id text REFERENCES applications(id),
 from_ref text, to_ref text NOT NULL, state text NOT NULL,
 reason text NOT NULL, details jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS operations_one_running ON operations(application_id)
 WHERE state IN ('PLANNING','VALIDATING','SWITCHING','VERIFYING','ROLLING_BACK');
CREATE TABLE IF NOT EXISTS audit (
 id text PRIMARY KEY, actor text NOT NULL, action text NOT NULL,
 resource text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 hash text PRIMARY KEY, role text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rate_limits (key text PRIMARY KEY, count integer NOT NULL, reset_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_states (
 hash text PRIMARY KEY, session_hash text NOT NULL, verifier text NOT NULL, name text NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS backup_jobs (
 id text PRIMARY KEY, project_ref text REFERENCES projects(ref), kind text NOT NULL,
 state text NOT NULL DEFAULT 'QUEUED', filename text, digest text, bytes bigint,
 error text, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days'
);
CREATE TABLE IF NOT EXISTS backup_schedules (
 project_ref text PRIMARY KEY REFERENCES projects(ref), every_hours integer NOT NULL CHECK(every_hours>=1),
 next_run timestamptz NOT NULL DEFAULT now(), kind text NOT NULL DEFAULT 'database', enabled boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS worker_leases (name text PRIMARY KEY, owner text NOT NULL, until_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS alerts (
 id text PRIMARY KEY, limit_id text NOT NULL REFERENCES capacity_limits(id),
 resource_id text NOT NULL, category text NOT NULL, severity text NOT NULL,
 percent double precision NOT NULL, message text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS alerts_one_active ON alerts(limit_id) WHERE resolved_at IS NULL;
