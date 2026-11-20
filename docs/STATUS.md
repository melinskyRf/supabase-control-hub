# Estado da implementação — 2026-11-20

## Implementado

- Login administrativo somente com senha, scrypt, cookies HttpOnly, validação de origem e controle persistente de tentativas.
- Setup local com senha oculta de 14 a 256 caracteres e confirmação. Os iniciadores Windows verificam dependências e configuração.
- Desenvolvimento pelo servidor oficial do Next.js em um processo, com workers em threads; produção mantém build e inicialização padrão.
- Conexões cifradas, rotação de PAT, descoberta atômica, projetos únicos e vínculos entre contas e projetos.
- Coleta de banco e Storage por consultas oficiais somente leitura, com distinção entre zero e indisponibilidade.
- Limites por escopo, agrupamentos, histórico e alertas persistentes.
- Aplicações, pools, snapshots de schema, planejamento, alternância versionada, rollback e recuperação assistida.
- Exportação e restauração de banco/schema/Storage, artefatos cifrados, digest e retenção.
- SDK de servidor, integração MCP de leitura e auditoria.

## Evidência local

| Verificação | Resultado |
| --- | --- |
| Suíte central com Node | 16 testes aprovados |
| Integração com PGlite e handlers reais | 8 testes aprovados |
| TypeScript | Aprovado |
| Login somente com senha | 200; senha incorreta recusada com 401 |
| Navegador real | Tela de login e painel autenticado verificados |
| Configuração local | Validada sem imprimir segredos |
| Vitest, build completo e suíte Playwright | Bloqueados no executor por spawn EPERM |

O banco embarcado e os artefatos cifrados dos testes são reais; respostas Supabase são simuladas. Os detalhes e limites estão em [TEST_RESULTS.md](TEST_RESULTS.md).

## O que depende de configuração externa

- PATs, credenciais de banco/Storage e projetos Supabase autorizados.
- Aplicativo OAuth registrado, quando esse método for utilizado.
- PostgreSQL de controle independente, HTTPS, worker e volumes em produção.
- Ferramentas PostgreSQL compatíveis com os servidores exportados.

## Pendências e limitações

- Build completo e suíte de navegador precisam de um ambiente que permita os subprocessos necessários.
- Não foram executadas restaurações nem integrações contra projetos de produção.
- Coletores adicionais de Compute/CPU/RAM/tráfego/API, notificações externas e armazenamento remoto de backups ainda dependem de implementação/configuração.
- Ensaios de concorrência entre processos, falhas prolongadas, rollback e restauração reais precisam de projetos de teste autorizados.
- Storage pode ficar parcialmente restaurado em falhas de rede e exige revisão antes de uma nova tentativa.
- O Hub não replica dados nem migra identidades, sessões, transações ou Realtime.

