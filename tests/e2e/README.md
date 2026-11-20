# Testes de navegador

A suíte `access.spec.ts` verifica:

- Exibição do login somente com senha e recusa de acesso sem sessão.
- Instruções de primeiro acesso e transição automática para o login quando a configuração se torna válida.
- Contrato enviado pelo formulário de cadastro de conexões autorizadas.

## Executar

Na raiz do projeto:

```powershell
npx playwright install chromium
npm run test:e2e
```

O Playwright usa `http://127.0.0.1:3000` e pode reutilizar um servidor local existente fora de CI. Os testes de formulários usam respostas simuladas e não conectam projetos Supabase reais.

O executor local utilizado na validação inicial bloqueou a criação do worker com `spawn EPERM`. A inspeção do login e do painel foi feita separadamente no navegador real. Consulte os [resultados e limites da evidência](../../docs/TEST_RESULTS.md).
