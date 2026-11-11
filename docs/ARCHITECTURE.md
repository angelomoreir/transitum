# Arquitetura

## Visão geral

Monorepo npm workspaces:

- **`apps/api`** — Fastify 5 + TypeScript + Drizzle ORM. REST com OpenAPI em `/docs`
  (`@fastify/swagger` + schemas Zod via `fastify-type-provider-zod@4`, que suporta
  Fastify 5 com Zod 3).
- **`apps/web`** — React 19 + Vite 6 + Tailwind CSS v4 (`@tailwindcss/vite`) +
  componentes estilo shadcn/ui construídos sobre Radix + CVA. React Router 7,
  i18next (pt-PT).
- **`packages/shared`** — fonte única de verdade para DTOs e validação:
  schemas Zod, mapa de permissões por função (RBAC), tipos de resposta.

## Base de dados

Drizzle ORM com dois drivers:

- `DATABASE_URL` definido → PostgreSQL real (`node-postgres`/pg).
- `DATABASE_URL` vazio → **PGlite** (PostgreSQL WASM). `NODE_ENV=test` → memória;
  em dev persiste em `PGLITE_DIR` (`.data/pglite`).

As migrações SQL são geradas por `drizzle-kit generate` em `apps/api/drizzle/` e
aplicadas no arranque (`runMigrations`). Limitação conhecida: PGlite não suporta
RLS — o isolamento multi-tenant é enforced ao nível de aplicação (todas as
queries filtram `tenantId`) e validado por testes (`test/tenancy.test.ts`).
Hardening com Postgres RLS fica previsto para a Fase 8.

## Modelo de dados (Fase 1)

- `tenants` — empresa cliente (slug único, plano).
- `users` — pertencem a um tenant; `email` globalmente único; `role`
  (admin/manager/operator/viewer); `status` (invited/active/suspended).
- `refresh_tokens` — sessões; hash sha256, rotação com `replacedById`,
  revogação, deteção de reutilização.
- `auth_tokens` — convites e resets de password (hash, expiração, uso único).
- `audit_events` — registo de auditoria por tenant (ação, ator, entidade, IP).

### Modelo de dados (Fase 2)

- `partners` — clientes/fornecedores/transportadoras numa entidade única com
  `types` (array enum `partner_type`), código sequencial (`CLI-/FOR-/TRA-`),
  NIF, contactos, morada, `active` (soft delete).
- `orders` + `order_lines` — encomendas `ENC-xxxxx` ligadas a um parceiro do
  tipo `customer`; estados `draft/confirmed/cancelled`.
- `shipments` + `shipment_events` — expedições `EXP-xxxxx` com moradas de
  recolha/entrega, `customerId`/`carrierId`/`orderId` opcional, estados
  `draft→planned→in_transit→delivered|cancelled` (mapa `SHIPMENT_TRANSITIONS`
  em `packages/shared`, enforced no backend) e timeline de eventos.
- `sequences` — contadores por tenant para numeração atómica
  (`nextNumber(db, tenantId, scope)` em `lib/sequences.ts`).

### Modelo de dados (Fase 3)

- `routes` — rotas `ROT-xxxxx` com `carrierId`, condutor/viatura, janela
  planeada e estados `draft→dispatched→completed|cancelled`
  (`ROUTE_TRANSITIONS` partilhado).
- `route_stops` — paragens ordenadas (`seq`) de tipo `pickup|delivery` com
  morada, `plannedAt`, `arrivedAt`/`doneAt`, ligação opcional a `shipments` e
  estados `pending→arrived→done|skipped` (`STOP_TRANSITIONS`).
- `carrier_rates` — tarifas por transportadora: base `flat|per_kg|per_km|
  per_package`, preço, moeda, `minCharge`, vigência, `active`.
- `shipment_costs` — linhas de custo por expedição
  (`freight|fuel|tolls|other`, valor + moeda).
- `shipment_events.location` — localização opcional; eventos do tipo
  `checkpoint` são criados automaticamente quando uma paragem ligada é
  concluída (acompanhamento/tracking).

### Modelo de dados (Fase 4)

- `warehouses` — armazéns `ARM-xxxxx` com morada e flag `active`.
- `items` — catálogo de artigos (SKU único por tenant, unidade, peso).
- `stock_levels` — nível de stock por armazém × artigo (`onHand`, `reserved`);
  upsert com constraint `(tenantId, warehouseId, itemId)`.
- `stock_movements` — movimentos `in|out|adjust|transfer` com armazém
  origem/destino, referência (ex.: nº de compra) e autor. Movimentos nunca
  deixam `onHand` negativo (verificação + reversão).
- `purchase_orders` + `purchase_order_lines` — compras `PC-xxxxx` a
  fornecedores com armazém destino; `receivedQty` por linha; receção cria
  movimentos `in` e recalcula o estado (`partially_received`/`received`).

### Modelo de dados (Fase 5)

- `documents` — metadados de ficheiros ligados a entidades
  (`shipment|order|purchase_order|partner|route`): nome, mime, tamanho,
  `storageKey` (`<tenantId>/<docId>`), autor. Conteúdo fica no
  `StorageDriver` — `LocalStorage` (`.data/storage`, env `STORAGE_DIR`) em
  dev/testes; a interface (`put/get/delete`) permite um driver S3/MinIO em
  produção.
- `notifications` — notificações persistidas por utilizador: `type`
  (= gatilho), `title`, `body`, `link`, `readAt`. Não derivam de auditoria.
- `automation_rules` — regras por tenant `{name, trigger, action="notify"|
  "webhook", webhookUrl, webhookSecret(HMAC), active}`. `notifyTenant()`
  (lib/notify.ts) verifica regras ativas para o gatilho: `notify` cria uma
  notificação por utilizador ativo do tenant; `webhook` faz POST JSON
  assinado (`x-transitum-signature: sha256=...`) e regista em
  `webhook_deliveries`. Chamado nos pontos de transição
  (expedição/encomenda/rota/receção/upload/alfândega).
- `customs_items` + `shipments.incoterm`/`customs_status` — dados aduaneiros
  por expedição; `CUSTOMS_TRANSITIONS` valida o fluxo documental; fatura
  comercial exportável em CSV.
- `api_keys` — chaves `bjk_<prefix>_<secret>` (hash sha256 persistido,
  `lastUsedAt`, revogáveis). Autenticam `/api/v1/*` via `x-api-key` com
  âmbito de «operator» do tenant.
- `webhook_deliveries` — log de entregas de webhooks (url, gatilho, status
  HTTP, duração, erro).

### Modelo de dados (Fase 7 — SaaS)

- `plans` — planos globais (code único, `priceMonthly`, moeda, `maxUsers`,
  `maxApiKeys`, `sort`); semeados no arranque por `ensurePlans`.
- `subscriptions` — 1:1 com tenant (`tenantId` único): `planId`, estado
  `trialing|active|past_due|cancelled`, `trialEndsAt`, período corrente,
  `cancelAtPeriodEnd`. Criada no registo (trial 14 dias, Starter).
- `subscription_invoices` — faturas SaaS por tenant (`INV-xxxxx` via
  `sequences`), valor/moeda, `open|paid|void`, emissão e pagamento manuais.
- `platform_admins` — `userId` de administradores da plataforma, sincronizada
  com a env `PLATFORM_ADMIN_EMAILS` em cada login/registo (a env é a fonte de
  verdade: remover da env revoga no próximo login).
- `tenants.suspendedAt` — suspensão pela administração da plataforma:
  `requirePermission` bloqueia escritas (permissões não `:read`) com 403.
- Enforcement de plano: `maxUsers` no convite de utilizadores e `maxApiKeys`
  na criação de chaves — ambos verificados contra a subscrição do tenant.

### Modelo de dados (Fase 8 — hardening)

- `api_keys.expiresAt` — expiração opcional verificada na auth da `/api/v1`
  (que tem também rate limit dedicado, 120/min).
- `webhook_deliveries.payload`/`attempts`/`nextRetryAt` — retries com backoff
  (5 min, 30 min; máx. 3) executados pelo scheduler.
- **Scheduler** (`lib/scheduler.ts`): `setInterval` embutido na API
  (`SCHEDULER_INTERVAL_MS`), desligado em `NODE_ENV=test`; corre
  `expireTrials` (trial→`past_due`), `markOverdueSubscriptions` (fatura
  vencida→`past_due`) e `retryFailedWebhooks`, notificando os utilizadores.
- **Storage**: `S3Storage` (`@aws-sdk/client-s3`, carregamento dinâmico) ativo
  quando `S3_BUCKET` está definido; `STORAGE_DIR`/local por omissão.

## Autenticação e segurança

- **Access token**: JWT 15min (`{sub, tid, role, name, email}`).
- **Refresh token**: opaco, cookie `transitum_rt` httpOnly SameSite=Lax
  `path=/api/auth`, TTL 30 dias, rotação a cada refresh. Reutilização de token
  revogado revoga todas as sessões do utilizador.
- **Passwords**: scrypt (node:crypto) com salt aleatório, `timingSafeEqual`.
- **RBAC**: `requirePermission(perm)` como preHandler; mapa em
  `packages/shared/src/permissions.ts` — partilhado com o frontend (mesma fonte).
- Rate limiting em endpoints de auth (10/min), helmet, CORS restrito por env.
- **Administração da plataforma**: `/api/admin/*` exige JWT + registo em
  `platform_admins` (não depende de `role` do tenant); operações auditadas no
  tenant afetado.
- Erros normalizados: `{error: {code, message, issues?}}`.
- RGPD: dados mínimos (nome/email/função), auditoria de ações sensíveis,
  eliminação/suspensão por tenant — direito de apagamento/exportação será
  endereçado numa fase posterior.

## Decisões e trade-offs

- **PGlite como fallback**: a máquina alvo não tem Docker/Postgres. PGlite é
  PostgreSQL real (WASM) — garante dev e testes completos sem instalação.
  Produção usa Postgres normal via `DATABASE_URL`.
- **scrypt vs argon2**: scrypt do node:crypto evita binários nativos no Windows.
- **Email**: `Mailer` interface — implementação de consola em dev; SMTP real
  fica para quando houver integração de email (Fase 5+).
- **TSX em produção**: `npm start` corre via tsx. Build empacotado pode ser
  adicionado na Fase 8.

## Vulnerabilidades conhecidas (npm audit)

Resolvidas: `fast-jwt` (upgrade `@fastify/jwt` v10), `@fastify/swagger-ui` v6,
`drizzle-orm` 0.45.

Dev-only remanescentes: `vitest`/`tinypool`/`@vitest/mocker` (vitest 4/5 corrige,
mas npm 11.0.0 tem bug de resolução de peer deps que bloqueia a instalação —
verificar novamente), `esbuild` transitivo de `drizzle-kit` (dev server apenas).
Nenhuma afeta o código de produção.
