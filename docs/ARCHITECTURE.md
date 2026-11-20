# Supabase Control Hub

## Decision record — 2026-11-17

Next.js App Router and a Node worker share a control database independent of all monitored Supabase projects. PostgreSQL is the production database; PGlite (real embedded PostgreSQL) is the single-process development adapter. Drizzle executes parameterized statements. No monitored tables are created or modified.

Connections own AES-256-GCM encrypted PAT/OAuth credentials. Organizations and projects are global identities; a join table records which connections can access each project. Discovery commits its snapshot atomically. Removing a connection does not delete shared projects. Manual connections use the same authorization checks.

Metrics are time-stamped observations with category, unit, scope, source and availability. Capacity is configured separately with explicit scope and provenance. Shared organization allowances are counted once. Unknown is never zero. Resource charts show only observed data.

Applications own project pools and a versioned active route. Every route change revalidates credentials, schema, freshness, capacity, data continuity and identity. An optimistic compare-and-swap and a unique running operation prevent competing switches. Auth identity continuity is not implied by copying tables. A synchronization/restore attestation is a human assertion with expiry, never a claim that this hub replicated data.

Failover states: PLANNING → VALIDATING → SWITCHING → VERIFYING → COMPLETED. Failure before switching is BLOCKED; after switching it is ROLLING_BACK → ROLLED_BACK, or NEEDS_ATTENTION if the previous route cannot be verified. Recovery after a process crash conservatively blocks routing for unfinished operations. The SDK uses route versions and fails closed while switching; existing direct Supabase clients must be reinitialized. This is not transparent transaction, Realtime or session migration.

Backups are durable jobs with encrypted artifacts, a SHA-256 digest, retention and audit. PostgreSQL exports require pg_dump and an independently configured database connection; Storage exports require explicit credentials. Restores require a typed confirmation and target verification. Backups are not replication.

Admin authentication uses scrypt passwords and expiring database-backed opaque cookies. APIs require same-origin mutations. Database-backed rate limiting works across replicas. Read-only machine tokens are distinct from admin sessions. Secrets never enter dashboard payloads or browser bundles. Only fixed api.supabase.com Management API and validated *.supabase.co project origins are accepted.

## Runtime

- Web: Next.js Node runtime, private by default, localhost during development.
- Local development launcher: public Next.js custom-server API, one Node process bound to 127.0.0.1:3000, with development workers running as threads. Production keeps the standard build/start flow and standalone output. Reference: https://nextjs.org/docs/app/guides/custom-server.
- Production worker: separate process + PostgreSQL; development worker runs through authenticated collection requests (PGlite must have only one owner).
- Docker Compose: PostgreSQL + web + worker, shared encrypted backup volume.
- External account access, OAuth client registration, SMTP/webhooks and deployment infrastructure require operator configuration.

## Official sources reviewed

- https://supabase.com/docs/reference/api/introduction
- https://supabase.com/docs/guides/platform/personal-access-tokens
- https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration
- https://supabase.com/docs/reference/api/v1-read-only-query
- https://supabase.com/docs/guides/observability/metrics
- https://supabase.com/changelog/supabase-cli-v3

Scoped PAT permissions and OAuth scope names differ. OAuth scopes are configured on the registered app, not requested ad hoc via the deprecated scope query parameter. Use PKCE, single-use state and server-side refresh. Read-only SQL endpoint is beta: report unsupported/forbidden rather than silently falling back to write access. CLI v3 targets local by default; hosted commands need explicit remote selection and mutation consent. This application does not depend on invoking the Supabase CLI.
