# API e integração

Todas as respostas administrativas têm `Cache-Control: no-store`. O navegador usa cookie HttpOnly e mutações exigem Origin igual a HUB_ORIGIN.

| Endpoint | Método | Uso |
| --- | --- | --- |
| /api/health | GET | Estado de configuração, sem credenciais |
| /api/auth/login | POST | `{password}` |
| /api/auth/logout | POST | Encerrar sessão |
| /api/state | GET | Inventário e observações sem segredos |
| /api/action | POST | `{action,input}`; administrador |
| /api/oauth/start | POST | `{name}`; retorna URL de autorização |
| /api/oauth/callback | GET | Callback vinculado à sessão e state |
| /api/route?applicationId=UUID | GET | Rota dinâmica; Bearer da aplicação |
| /api/agent/snapshot | GET | Snapshot; Bearer AGENT_READ_TOKEN |
| /api/backups/download?id=UUID | GET | Artefato cifrado e íntegro; sessão |

Ações: connection.create/update/delete/discover, project.manual, organization.restrict, metrics.collect, schema.snapshot/compare, capacity.save, application.create/pause, pool.save, failover.plan/execute, backup.create/restore/schedule. O contrato Zod está em src/app/api/[...path]/route.ts. Erros retornam `{error}` com código HTTP correspondente.

## SDK de servidor

Importe `controlHub` de src/sdk/index.ts para o backend do site:

```ts
const hub = controlHub({origin: process.env.HUB_ORIGIN!, applicationId: process.env.HUB_APPLICATION_ID!, machineToken: process.env.HUB_MACHINE_TOKEN!});
const result = await hub.run(client => client.from('products').select('*'));
```

Guarde o machineToken retornado no cadastro da aplicação; ele é exibido uma vez. Nunca o publique em NEXT_PUBLIC_*. Resolva a rota em cada operação. Não retenha clientes antigos. O callback onRouteChange permite tratar a reconexão. O SDK não oferece migração de transações ou sessões; em falhas bloqueia o uso de rota desatualizada e abre circuit breaker após três erros.

## MCP local

Execute `npm run --silent mcp` no diretório do projeto com `.env.local`. Ferramentas: hub_overview, hub_projects, hub_backups, hub_activity. O MCP acessa o servidor em HUB_ORIGIN e usa AGENT_READ_TOKEN, sem executar mutações. Cadastre esse comando no cliente Codex/Claude. O processo web precisa estar em execução.

Ferramentas MCP adicionais: hub_capacity, hub_health, hub_alerts e hub_resource_groups. A ação application.recover requer applicationId, version e confirmation igual a RECOVER seguido do Project Ref ativo. Ela verifica a rota atual, aumenta a versão e mantém automações pausadas.

`GET /api/health` retorna `{ok:true,configured:boolean}` sem credenciais; `configured` exige senha, chave de criptografia e origem válidos, além de PostgreSQL no ambiente de produção. Não verifica conectividade com os projetos. `GET /api/state` inclui `alerts` e `projectConnections`, usados por Monitoring e pelos agrupamentos por conta. A disponibilidade `capabilities.oauth` exige identificador e segredo do aplicativo OAuth.
