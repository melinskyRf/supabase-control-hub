# API administrativa

O handler `route.ts` concentra os endpoints HTTP do Control Hub no runtime Node.js. As respostas administrativas não são armazenadas em cache.

| Endpoint | Autorização |
| --- | --- |
| `/api/health` | Público; retorna disponibilidade e estado de configuração, sem segredos |
| `/api/auth/login` | Senha administrativa e origem válida; controle de tentativas |
| `/api/auth/logout` | Sessão administrativa e origem válida |
| `/api/state` | Sessão administrativa |
| `/api/action` | Sessão administrativa, origem válida e entrada validada por Zod |
| `/api/route` | Token de máquina específico da aplicação |
| `/api/agent/snapshot` | Token separado de leitura |
| `/api/backups/download` | Sessão administrativa |
| `/api/oauth/start` e `/api/oauth/callback` | Sessão administrativa e fluxo OAuth configurado |

O login recebe apenas `{ "password": "SUA_SENHA" }`. A sessão usa cookie HttpOnly. Tokens Supabase e chaves de criptografia permanecem no servidor.

Alternância e restauração exigem as confirmações previstas no contrato; este handler não replica dados nos projetos monitorados.

Veja os [contratos HTTP e exemplos](../../../../docs/API.md), a [segurança operacional](../../../../docs/SECURITY.md) e a [arquitetura](../../../../docs/ARCHITECTURE.md).
