# Supabase Control Hub

Leia README.md e docs/ARCHITECTURE.md antes de alterar integrações. Use somente APIs oficiais. Não exponha credenciais no frontend ou logs. O banco de controle é independente dos projetos monitorados. Não crie tabelas nem replique dados nos projetos durante alternância.

Preserve identificação única de projetos e cotas compartilhadas. Métrica ausente nunca é zero. Trocas precisam verificar saúde, schema, capacidade, dados, identidade e versão da rota. Não remova bloqueios de segurança para fazer testes passarem.

Verifique com `node tests/core.test.mjs`, `npm run typecheck`, `npm test`, `npm run build` e Playwright quando o ambiente permitir. Documente testes não executados. Não conecte projetos reais, restaure dados nem publique sem configuração e autorização apropriadas.
