# SDK de servidor

O módulo `index.ts` resolve a rota ativa de uma aplicação antes de cada operação Supabase. Use-o no backend consumidor; o token de máquina não deve entrar em bundles do navegador.

## Uso

```typescript
import { controlHub } from './index';

const hub = controlHub({
  origin: process.env.HUB_ORIGIN!,
  applicationId: process.env.HUB_APPLICATION_ID!,
  machineToken: process.env.HUB_MACHINE_TOKEN!,
});

const result = await hub.run(client => client.from('products').select('*'));
```

O identificador e o token são retornados pelo cadastro da aplicação no painel. A função `run` consulta a rota e usa um cliente correspondente à versão atual.

O callback opcional `onRouteChange` permite tratar uma mudança de projeto. Clientes retidos fora de `run` não passam pelas verificações posteriores. O SDK não migra sessões, transações ou Realtime entre projetos.

Consulte a [API e os contratos de integração](../../docs/API.md) e o [fluxo de alternância](../../docs/FAILOVER.md).
