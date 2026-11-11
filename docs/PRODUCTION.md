# Preparação para produção

Checklist e configuração para correr a plataforma em produção.

## Arranque rápido (docker-compose)

```bash
export JWT_SECRET=$(openssl rand -hex 32)
export PLATFORM_ADMIN_EMAILS=admin@empresa.com
docker compose up -d --build
```

Sobe Postgres, MinIO (+bucket `transitum-documents`), API (`:3001`) e web
(`:8080`). Migrações e seed de planos correm no arranque da API.

## Variáveis de ambiente obrigatórias

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | `postgres://user:pass@host:5432/db` — **obrigatório** em produção |
| `JWT_SECRET` | Segredo dos access tokens — mín. 32 caracteres aleatórios |
| `CORS_ORIGIN` | Origem do frontend (ex.: `https://app.exemplo.com`) |
| `WEB_BASE_URL` | URL pública do frontend (links de convite/reset) |
| `COOKIE_SECURE` | `true` atrás de HTTPS |
| `PLATFORM_ADMIN_EMAILS` | Emails com acesso a `/api/admin` (vírgula-separados) |
| `S3_BUCKET` + `S3_*` | Storage de documentos; vazio = disco local (`STORAGE_DIR`) |
| `SCHEDULER_INTERVAL_MS` | Intervalo do scheduler (def. 1h) |

Ver `apps/api/.env.example` para a lista completa.

## Base de dados

- Migrações: `apps/api/drizzle/*.sql`, aplicadas automaticamente no arranque
  (`runMigrations`). Para controlo manual correr com `drizzle-kit migrate`.
- Índices tenant-first já existem nas tabelas quentes.
- **Backups**: `pg_dump` agendado + PITR se gerido (RDS/CloudSQL/etc.).

### RLS (recomendado — defense-in-depth)

O isolamento é enforced ao nível de aplicação. Para reforçar na BD, ligar RLS
por tabela tenant-scoped, ex.:

```sql
ALTER TABLE partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON partners
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

Isto exige propagar `SET LOCAL app.tenant_id = '<tid>'` por transação no
cliente Drizzle — **mudança cirúrgica pendente**: aplicar no `db/client.ts`
dentro de `db.transaction()` ou via middleware de sessão por request.
Não testado em PGlite — validar primeiro num Postgres de staging.

## Storage de documentos

- `S3_BUCKET` definido → `S3Storage` (`@aws-sdk/client-s3`): PUT/GET/DELETE em
  `s3://<bucket>/<tenantId>/<docId>`; `S3_ENDPOINT` para MinIO/compatíveis
  (path-style automático); sem endpoint → AWS S3 nativo.
- Permissões mínimas no bucket: `s3:PutObject`, `s3:GetObject`,
  `s3:DeleteObject` apenas no prefixo necessário.

## Scheduler

Corre embutido na API (`startScheduler`): trial expirado → `past_due`,
fatura vencida → `past_due`, retries de webhooks (5 min, 30 min; máx. 3).
Para multi-instância, extrair para worker dedicado ou usar fila (BullMQ/SQS) —
o código é idempotente e seguro para 1 instância.

## Health e observabilidade

- `GET /api/health` — liveness/readiness.
- Logs: pino (JSON em produção). Enviar para agregador (Loki/CloudWatch).
- OpenAPI/Swagger UI em `/docs` — considerar desativar em produção
  (`swagger-ui` registo condicional).

## Checklist de go-live

- [ ] `DATABASE_URL` Postgres gerido, backups ativos
- [ ] `JWT_SECRET` ≥32 chars, em gestor de segredos
- [ ] `COOKIE_SECURE=true` + HTTPS terminado no LB/proxy
- [ ] `CORS_ORIGIN` restrito ao domínio da app
- [ ] `PLATFORM_ADMIN_EMAILS` definido
- [ ] Bucket S3 criado com política mínima; lifecycle/expiry se aplicável
- [ ] SMTP real (substituir `ConsoleMailer` — interface `Mailer`)
- [ ] RLS aplicado (ver acima) ou agendado como hardening
- [ ] `npm audit` limpo em deps de produção
- [ ] Rate limiting no edge (WAF/ALB/Cloudflare)
- [ ] Alertas: erros 5xx, falhas de webhook, subscrições `past_due`
- [ ] Runbook de recuperação (backup restore, revogação de segredos)

## Limitações conhecidas (aceites)

- `npm start` corre via `tsx` (sem build pass — código-fonte no container).
- Webhooks best-effort com retry limitado; sem fila persistente.
- Faturação manual (sem gateway); transições de subscrição via scheduler.
- Notificações in-app sem push/email.
- JWT não revogável antes da expiração natural (15 min) — mitigado por
  refresh rotation + suspensão de tenant/user no backend.
