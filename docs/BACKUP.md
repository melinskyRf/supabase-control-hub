# Backups e restauração

Configure PG_DUMP_PATH e PG_RESTORE_PATH para executáveis compatíveis com o PostgreSQL de origem. No cadastro de conexão, databaseUrl deve conter uma URL do projeto selecionado. Pooler exige usuário com sufixo `.PROJECT_REF`; host direto deve ser `db.PROJECT_REF.supabase.co`. A senha é enviada ao subprocesso por variável de ambiente. Instale o certificado raiz apropriado para verify-full quando necessário.

Exports database/schema usam formato custom pg_dump e retiram ownership/ACL. Storage usa credencial administrativa explícita storageKey e exporta buckets/objetos em JSONL. Os artefatos são cifrados por AES-256-GCM e autenticados com ID, projeto e tipo. SHA-256 verifica integridade do arquivo cifrado. Retenção padrão: 30 dias; expiração é processada pelo worker.

Backups agendados requerem PostgreSQL externo e worker. Em desenvolvimento, criação manual executa a exportação no processo web; em produção o job é consumido pelo worker. Consulte o estado final em Backup Center. Um job criado não comprova exportação concluída.

Para restaurar database/schema, escolha um destino fora das rotas ativas e digite `RESTORE PROJECT_REF`. O Hub verifica o digest, autentica o artefato inteiro e só então chama pg_restore com clean, if-exists e single-transaction. A operação altera o destino e exige confirmação administrativa. Após restaurar, valide dados, permissões, schema e identidade antes de emitir um atestado no pool.

Storage possui restauração integrada para destinos sem buckets com os mesmos IDs. Objetos são enviados sem sobrescrita. Falhas de rede podem deixar uma restauração parcial, que exige revisão e limpeza explícita antes de repetir. Preserve a chave de criptografia e metadados dos jobs junto ao backup do banco de controle; o download `.hub` não é diretamente utilizável por pg_restore. A importação integrada autentica o artefato inteiro antes de criar buckets ou enviar objetos. O diretório de backups é configurado no servidor por BACKUP_DIRECTORY, sem escolha de provedor remoto pelo painel.

Faça ensaios em projetos descartáveis antes da primeira restauração real. A suíte atual não executa restaurações contra projetos externos.
