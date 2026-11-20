# Alternância e continuidade

Prepare manualmente schemas e dados. Cadastre os projetos no pool da aplicação, configure limites de banco e Storage e colete snapshots. A prioridade menor é avaliada primeiro. O planejamento retorna candidatos, motivos de bloqueio, destino e versão da rota.

Confirme uma troca manual com `SWITCH PROJECT_REF` e a versão retornada pelo planejamento. O executor valida tudo novamente, impede operações concorrentes, atualiza a rota por compare-and-swap e verifica o destino. Falha anterior à troca gera BLOCKED. Falha posterior tenta ROLLING_BACK; a origem só é liberada após verificação de saúde. Falha da origem gera NEEDS_ATTENTION e roteamento bloqueado.

Automações começam pausadas e exigem PostgreSQL externo e worker. O gatilho atual é o limite crítico configurado de banco/Storage, não indisponibilidade genérica. Limite compartilhado por organização só pode levar a um destino de outra organização. Cooldown padrão: 900 segundos. Validação exige saúde de até 180 segundos e schemas de até 300 segundos.

Políticas synchronized/restored exigem dataEvidence no pool:

```json
{"source_ref":"REF_ORIGEM","target_ref":"REF_DESTINO","schema_hash":"SHA256_DO_SNAPSHOT_DESTINO","reference":"relatorio-validacao-123","expires_at":"2026-12-01T00:00:00Z","policy":"synchronized"}
```

A identidade external também exige identityEvidence vigente com as mesmas referências e fingerprint. Supabase Auth bloqueia a troca porque sessões e identidades são específicas do projeto. Um atestado é uma declaração humana, não comprovação de replicação feita pelo Hub.

O SDK precisa resolver a rota a cada operação. Clientes Supabase diretos e referências antigas não são bloqueados pelo Hub. Não há migração transparente de Realtime, sessões ou transações em andamento. Operações interrompidas são marcadas conservadoramente pelo worker após expiração. NEEDS_ATTENTION exige análise manual do estado e da rota antes de qualquer desbloqueio.

Recuperação assistida: no Failover Manager, informe a aplicação bloqueada, a versão atual e RECOVER PROJECT_REF. A rota atual precisa estar saudável, autorizada e fora de organização restrita. Nenhuma operação pode estar em andamento. A recuperação mantém o mesmo projeto, incrementa a versão e pausa a automação para revisão.
