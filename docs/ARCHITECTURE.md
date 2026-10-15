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

## Autenticação e segurança

- **Access token**: JWT 15min (`{sub, tid, role, name, email}`).
- **Refresh token**: opaco, cookie `blujay_rt` httpOnly SameSite=Lax
  `path=/api/auth`, TTL 30 dias, rotação a cada refresh. Reutilização de token
  revogado revoga todas as sessões do utilizador.
- **Passwords**: scrypt (node:crypto) com salt aleatório, `timingSafeEqual`.
- **RBAC**: `requirePermission(perm)` como preHandler; mapa em
  `packages/shared/src/permissions.ts` — partilhado com o frontend (mesma fonte).
- Rate limiting em endpoints de auth (10/min), helmet, CORS restrito por env.
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
