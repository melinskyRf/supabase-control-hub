# Segurança operacional

O controle deve ficar em rede privada e HTTPS. Login usa somente senha com scrypt, cookies HttpOnly de oito horas e rate limiting persistido no PostgreSQL. Não existe senha padrão. O setup exige confirmação da senha.

Credenciais são cifradas com AES-256-GCM, nonce aleatório e contexto da conexão como AAD. A chave de 32 bytes deve ser guardada fora do banco e copiada com segurança. Perdê-la impede recuperar credenciais e backups. Não substituir a chave sem um procedimento de recifragem.

Tokens administrativos ficam no servidor. Payloads de estado omitem segredos e corpos de funções do schema. Tokens de agentes e aplicações têm finalidades distintas; o MCP é somente leitura. URLs de projeto e Management API são limitadas aos hosts oficiais. Redirects de rede são recusados. Conexões PostgreSQL para backup precisam corresponder ao Project Ref selecionado e exigem TLS verify-full.

Use tokens com permissões mínimas. Cadastre uma conexão por credencial PostgreSQL de backup quando os projetos exigirem usuários/URLs diferentes. Revogue tokens no Supabase quando remover conexões. Audite logs, proteja `.env.local`, volumes e dumps temporários, e faça backup independente do banco de controle.

O painel não implementa múltiplos administradores nem gerenciamento visual de papéis. O principal atual é administrador; integrações de máquinas usam tokens separados. Recuperação da senha exige acesso autorizado ao servidor. Integrações reais, pen test e restaurações precisam ser verificados antes de uso em produção.
