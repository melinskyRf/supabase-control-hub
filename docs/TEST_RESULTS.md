# Resultados da verificação - 2026-11-20

| Verificação | Resultado |
| --- | --- |
| node tests/core.test.mjs | 16 testes aprovados |
| npm run typecheck | Aprovado |
| npm run test:smoke | 8 testes aprovados |
| node --check scripts/dev.mjs | Aprovado |
| node --check scripts/setup.mjs | Aprovado |
| npm run setup sem terminal interativo | Rejeitado antes de gerar ou salvar credenciais; orienta abrir CONFIGURAR.cmd |
| Servidor local e navegador real | Primeiro acesso visível; página e health retornam 200; state privado retorna 401 |
| npm run check:config | Configuração de acesso criada e validada; saída 0 |
| npm run diagnose | stdio=pipe bloqueado com EPERM; ignore e inherit funcionam |
| npm test | Interrompido antes dos testes: spawn EPERM ao iniciar esbuild |
| npm run build | Código compilado em 9,7 s; build interrompido ao iniciar a etapa TypeScript com spawn EPERM |
| npm run test:e2e | Servidor existente reutilizado; criação do worker dos testes interrompida por spawn EPERM |

## Cobertura executada

- Remoção do autenticador solicitada pelo operador: login real somente com senha (200), senha incorreta recusada (401), tela sem o campo de código e nova entrada no painel confirmadas no navegador. A sessão foi deixada aberta. Os 16 testes centrais, os 8 testes de integração e a checagem de tipos passaram após a alteração.

- Acesso local real: configuração válida, login somente com senha definitiva (200), snapshot autenticado (200), ausência de credenciais no snapshot e logout da sessão de verificação (200). A sessão aberta no navegador é independente e permanece autenticada. Visão geral do workspace confirmada no navegador real.
- Configuração completa de senha/criptografia, origem segura e requisitos de produção, sem revelar valores de ambiente nos erros.
- Capacidade agregada, cotas compartilhadas, projetos deduplicados, períodos, métricas ausentes e agrupamentos por conta/aplicação.
- Alertas e rejeição de telemetria inválida, antiga ou futura.
- Compatibilidade de schema, continuidade, identidade, cooldown e autorização.
- Criptografia, hash de senha e validação de destinos.
- PGlite real: migração do banco de controle, rollback de transações, descoberta compartilhada e exclusão isolada de conexões.
- Login somente com senha, rejeição de senha incorreta, sessões independentes, sessão expirada e escrita de outra origem.
- Handlers reais: acesso privado, detecção de configuração incompleta, login/logout, cadastro e rotação de PAT em conexão desativada, validação, no-store e isolamento de segredos.
- Backup de Storage com resposta vazia simulada: arquivo realmente criptografado, confirmação de restauração e rejeição de corrupção.
- Motor real de alternância: falha no destino, rollback, incremento de versão e registro ROLLED_BACK.
- Coleta real com respostas simuladas: valores nulos, vazios, booleanos e malformados não viram zero; zero explícito é aceito.
- Alertas persistidos e vínculos de contas são devolvidos pelo snapshot real e alimentam os agrupamentos.
- O motor bloqueia capacidade com observações negativas, ausentes, antigas ou futuras; medições válidas liberam essa etapa.

## Limites da evidência

Os testes diretos transpilaram TypeScript para uma pasta temporária e executaram os módulos reais com Node. O banco e os arquivos criptografados são reais. Respostas Supabase foram simuladas; nenhuma conta real ou dado de produção foi utilizado.

Playwright contém testes da barreira privada, do contrato do formulário de contas e das instruções de primeiro acesso com retorno ao login. Eles não executaram nesta sessão devido ao bloqueio de subprocessos. Separadamente, a página real foi aberta e mostrou as instruções de primeiro acesso no navegador; as respostas HTTP reais confirmaram disponibilidade e manutenção da barreira privada.

Não foram verificados o cadastro interativo de senha, o iniciador por duplo clique, pg_dump/pg_restore externo, buckets/objetos reais, OAuth real, notificações, publicação, concorrência entre processos ou falhas prolongadas de rede. O build completo continua sem aprovação. Nenhuma proteção foi removida para fazer testes passarem.
