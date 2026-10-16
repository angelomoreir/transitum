# Registo de progresso

## Fase 1 — Fundação, auth, multi-tenancy, permissões ✅ (2026-10-14)

### Implementado

- Monorepo npm workspaces: `apps/api`, `apps/web`, `packages/shared`.
- API Fastify 5 + TypeScript + Drizzle ORM (PostgreSQL/PGlite), OpenAPI em `/docs`.
- Auth completa: registo de empresa (cria tenant + admin), login, refresh com
  rotação e deteção de reutilização, logout, recuperação de password,
  convites com token, aceitar convite, alterar password.
- RBAC: 4 funções (admin/manager/operator/viewer) com permissões partilhadas
  entre backend e frontend.
- Multi-tenancy: isolamento por `tenantId` em todas as queries; testes de
  isolamento automatizados.
- Auditoria: eventos de auth, convites, alterações de utilizadores e tenant.
- UI: login, registo, recuperação, aceitar convite; shell com sidebar (módulos
  futuros marcados "Brevemente"), topbar com pesquisa global (Ctrl+K, pesquisa
  real de utilizadores), notificações (derivadas de auditoria real), menu de
  utilizador; dashboard com indicadores reais; gestão de utilizadores completa
  (listar, filtrar, paginar, convidar, mudar função, suspender/reativar,
  reenviar convite); definições (nome da empresa, alterar password).
- i18n preparado (pt-PT inicial via react-i18next).
- Seed demo opcional: `SEED_DEMO=1 npm run db:seed`.

### Testes executados

| Suite | Resultado |
|---|---|
| API Vitest (auth, tenancy, rbac) | 17/17 ✅ |
| Web Vitest | 2/2 ✅ |
| Typecheck API + build Web (tsc+vite) | ✅ |
| Playwright e2e (registar→painel→convidar→logout→login) | ✅ 1 teste |
| Smoke manual API + proxy Vite + Swagger UI | ✅ |

### Limitações conhecidas

- Isolamento por aplicação (sem Postgres RLS — requer servidor real; Fase 8).
- Email via consola (link de convite também devolvido na resposta da API).
- `npm start` usa tsx (sem bundle de produção ainda).
- Vulnerabilidades dev-only do vitest (fix existe mas npm 11.0.0 bloqueia
  instalação de vitest 4/5).
- Notificações = eventos de auditoria; sistema dedicado na Fase 5.

### Como correr

Ver `README.md`. Resumo: `npm install && npm run dev` → http://localhost:5173.

---

## Fase 2 — Parceiros, encomendas e expedições ✅ (2026-10-15)

### Implementado

- **Parceiros** (`/partners`): entidade única com tipos `customer`, `supplier`,
  `carrier` (multi-tipo). Código sequencial por tenant com prefixo (`CLI-`,
  `FOR-`, `TRA-`), NIF, contactos, morada, ativo/inativo (soft delete),
  pesquisa e filtro por tipo. Criar/editar via diálogo.
- **Encomendas** (`/orders`): numeração `ENC-xxxxx`, linhas dinâmicas
  (descrição/qtd/peso), morada de entrega, estados `draft → confirmed |
  cancelled` com validação de transições, detalhe com linhas e expedições
  associadas, atalho "Criar expedição".
- **Expedições** (`/shipments`): numeração `EXP-xxxxx`, moradas de
  recolha/entrega, cliente + transportadora + encomenda opcional, ciclo
  `draft → planned → in_transit → delivered | cancelled` validado no backend
  (`SHIPMENT_TRANSITIONS` partilhado), `deliveredAt` automático, timeline de
  eventos (criação, mudanças de estado, notas manuais).
- **Numeração atómica** por tenant via tabela `sequences`
  (`lib/sequences.ts`).
- **Permissões novas**: `partners:*`, `orders:*`, `shipments:read|write|status`
  — integradas no RBAC (admin tudo; manager operacional; operator sem
  parceiros; viewer só leitura global).
- **Stats e pesquisa global** alargados a parceiros/encomendas/expedições;
  dashboard com novos KPIs operacionais.
- Validação de negócio: encomendas só a clientes ativos do tipo `customer`;
  expedições validam `customer`/`carrier`; transições inválidas → 400.

### Testes executados

| Suite | Resultado |
|---|---|
| API Vitest (auth, tenancy, rbac, partners/orders/shipments) | **34/34 ✅** |
| Web Vitest | 2/2 ✅ |
| Typecheck API + build Web | ✅ |
| Playwright e2e | ✅ 2 testes — inclui cadeia parceiro→encomenda→expedição→estados→timeline |
| Smoke real (PGlite): registo→parceiros→encomenda→expedição→transição→stats→search | ✅ |
| Swagger `/docs` | 200, 27 paths |

### Limitações conhecidas

- Sem edição de linhas de encomenda após criação (recriar encomenda).
- Moradas de expedição são independentes da morada do parceiro (sugestão
  automática pode vir numa fase posterior).
- Notificações continuam derivadas de auditoria (sistema dedicado: Fase 5).
- Sem custos/tarifas ainda (Fase 3).

### Nota operacional

O data dir PGlite de dev (`.data/pglite`) ficou corrompido após kill forçado
de um processo — foi preservado em `.data/pglite.bak` e recriado limpo.
Dados de dev podem ser regenerados via `SEED_DEMO=1 npm run db:seed`.

---

## Fase 3 — Transportes, rotas, custos e acompanhamento ✅ (2026-10-15)

### Implementado

- **Rotas** (`/routes`): numeração `ROT-xxxxx`, transportadora, condutor,
  viatura, janela planeada, estados `draft → dispatched → completed |
  cancelled` (`ROUTE_TRANSITIONS` partilhado). Lista com pesquisa/filtro,
  criação com paragens ordenadas (reordenar/remover), detalhe com ações de
  estado e gestão de paragens.
- **Paragens** (`route_stops`): tipo `pickup|delivery`, morada, hora prevista,
  ligação opcional a expedição, estados `pending → arrived → done | skipped`
  com `arrivedAt`/`doneAt` automáticos. Remoção só em rota `draft`.
- **Acompanhamento**: concluir uma paragem ligada a expedição gera evento
  `checkpoint` na timeline da expedição com localização (`shipment_events.location`);
  notas manuais também aceitam localização.
- **Tarifas** (`/rates`, `carrier_rates`): por transportadora, base
  `flat|per_kg|per_km|per_package`, preço, moeda, mínimo, vigência
  `validFrom/validTo`, ativar/desativar.
- **Custos** (`shipment_costs`): linhas de custo por expedição
  (`freight|fuel|tolls|other`) com total no detalhe da expedição.
- **Permissões novas**: `routes:read|write|status`, `rates:read|write`,
  `costs:read|write` integradas no RBAC.
- Pesquisa global inclui rotas; dashboard inclui KPI "Rotas despachadas".

### Testes executados

| Suite | Resultado |
|---|---|
| API Vitest (incl. routes/stops/rates/costs/tenancy) | **49/49 ✅** |
| Web Vitest | 2/2 ✅ |
| Typecheck API + build Web | ✅ |
| Playwright e2e | ✅ 3 testes — inclui tarifa→expedição→rota→paragem→checkpoint→custo |

### Incidentes resolvidos

- `GET /api/routes` falhava com erro de proxy do Drizzle — campo `stopCount`
  de subquery sem alias; resolvido com `.as("stopCount")`.

### Limitações conhecidas

- Custos são linhas manuais — sem cálculo automático a partir das tarifas
  (futuro: motor de rating na Fase 7/faturação).
- Sem otimização de rotas/mapas (planeamento é manual/ordenado).
- Estado da expedição não é alterado automaticamente pelos checkpoints —
  apenas regista o evento (integração automática pode vir depois).

---

## Fase 4 — Armazéns, inventário e cadeia de abastecimento ✅ (2026-10-15)

### Implementado

- **Armazéns** (`/warehouses`): códigos `ARM-xxxxx`, morada, ativo/inativo,
  contagem de artigos com stock. CRUD via diálogo.
- **Artigos** (`/inventory` → separador Artigos): SKU único por tenant
  (normalizado maiúsculas), nome, unidade, peso, stock total agregado,
  ativo/inativo.
- **Níveis de stock** (`stock_levels`): em mão + reservado por armazém ×
  artigo, com filtro por armazém e pesquisa. Disponível = em mão − reservado.
- **Movimentos** (`stock_movements`): `in|out|adjust|transfer` com origem/
  destino, referência e nota; validações (quantidade, stock não negativo,
  armazéns distintos na transferência); upsert atómico dos níveis.
- **Compras** (`/purchases`): `PC-xxxxx` para fornecedores, armazém destino,
  linhas com artigo/qtd/preço, ciclo `draft → sent → partially_received |
  received | cancelled`. Receção parcial/total por linha — gera movimento
  `in` e atualiza stock automaticamente, com estado recalculado.
- **Permissões novas**: `warehouses:*`, `inventory:*`, `purchases:*`
  (operator recebe `inventory:write` + `purchases:write`).
- Pesquisa global inclui compras e artigos; dashboard com KPIs "Compras em
  aberto" e "Artigos em catálogo".

### Testes executados

| Suite | Resultado |
|---|---|
| API Vitest (incl. armazéns/artigos/movimentos/compras/tenancy) | **69/69 ✅** |
| Web Vitest | 2/2 ✅ |
| Typecheck API + build Web | ✅ |
| Playwright e2e | ✅ 4 testes — inclui armazém→artigo→compra→envio→receção→stock |

### Limitações conhecias

- Campo `reserved` existe no modelo mas sem reserva automática ainda
  (integração com expedições numa fase posterior).
- Sem saída automática de stock ao expedir (ship out) — pode ser ligado às
  expedições/rotas numa fase posterior.
- Sem números de lote, validade ou localização interna (bins).
- Alertas de stock mínimo e reposição automática: não implementados.

---

## Fase 5 — Documentos, notificações e automatizações ✅ (2026-10-16)

### Implementado

- **Documentos** (`/api/documents`, `/documents`): upload/download/remoção de
  ficheiros ligados a entidades (`shipment`, `order`, `purchase_order`,
  `partner`, `route`). Upload via JSON base64 (limite 5 MB, `bodyLimit`
  dedicado de 8 MB na rota). Storage através da interface `StorageDriver` —
  implementação local em disco (`STORAGE_DIR`, `.data/storage` em dev,
  diretório temporário em testes); driver S3/MinIO preparado pela abstração
  (validação em produção: Fase 8). `storageKey` tenant-scoped, metadados na
  BD, download com `content-disposition`, remoção limpa o ficheiro.
- **Notificações persistidas** (`notifications`): por utilizador — tipo,
  título, corpo, link, `readAt`. `GET /api/notifications` (paginação + filtro
  `unread=true` + contagem), `POST /:id/read`, `POST /read-all`. O menu de
  notificações usa estado real do servidor (badge de não lidas, marcar
  individual/todas, navegação pelo link) — substitui a derivação de auditoria
  + localStorage.
- **Automatizações** (`automation_rules`, `/automations`): regras por tenant
  com gatilho → ação `notify`. Gatilhos: `shipment.status_changed`,
  `shipment.delivered`, `order.confirmed`, `purchase_order.received`,
  `route.completed`, `document.uploaded`. Motor `notifyTenant()` em
  `lib/notify.ts` — se existir regra ativa, cria notificação para todos os
  utilizadores ativos do tenant. Invocado nos pontos de transição reais
  (estado de expedição, confirmação de encomenda, conclusão de rota, receção
  total de compra, upload de documento). Registo de tenant semeia 3 regras
  por omissão. UI: listar, criar, ativar/desativar, eliminar.
- **Cartão de documentos** (`DocumentsCard`) nos detalhes de expedição,
  encomenda, compra e rota; página global `/documents` com pesquisa, filtro
  por tipo de entidade e paginação.
- **Permissões novas**: `documents:read|write`, `automations:read|write`
  (operator não gere automatizações; viewer sem documentos).

### Testes executados

| Suite | Resultado |
|---|---|
| API Vitest (incl. documentos, notificações, automatizações, isolamento) | **85/85 ✅** |
| Web Vitest | 2/2 ✅ |
| Typecheck API + build Web | ✅ |
| Playwright e2e | ✅ 5 testes — novo: regra → confirmação → notificação → upload → página documentos → marcar lidas |

### Limitações conhecidas

- Storage apenas em disco local — driver S3/MinIO existe como interface,
  falta implementação e validação em produção (Fase 8).
- Ação de automatização limitada a notificação in-app (sem email/push/webhook).
- Sem digitalização/antivírus de ficheiros nem assinatura de URLs de
  download — hardening na Fase 8.
- Notificações não são enviadas em tempo real (polling ao abrir o menu).

---

## Fase 6 — Comércio internacional, integrações e API ✅ (2026-10-16)

### Implementado

- **Alfândega nas expedições**: `incoterm` (10 Incoterms 2020) e
  `customs_status` (`none→prepared→submitted→cleared|held` com transições
  validadas por `CUSTOMS_TRANSITIONS`); eventos `customs` na timeline;
  `customs_items` por expedição (descrição, HS code 4–10 dígitos, país de
  origem, quantidade, peso, valor, moeda); exportação de **fatura comercial
  em CSV** (`GET /api/shipments/:id/commercial-invoice.csv`) com exportador,
  destinatário, incoterm e linhas. Gatilho novo `shipment.customs_cleared`.
- **Chaves de API** (`/api/integrations/keys`): formato `bjk_<prefixo>_<segredo>`,
  guardado como hash sha256 (segredo mostrado uma única vez), `lastUsedAt`,
  revogação (soft). Header `x-api-key` autentica a API pública.
- **API pública v1** (`/api/v1/*`, tag «Public API» no OpenAPI): `GET/POST
  /orders`, `GET /orders/:id`, `GET /shipments`, `GET /shipments/:id` — mesmas
  DTOs e validações; aceita `x-api-key` (âmbito operador do tenant) ou Bearer JWT.
- **Webhooks**: ação `webhook` nas regras de automatização com `webhookUrl` +
  segredo HMAC por regra; POST JSON assinado (`x-blujay-signature:
  sha256=...`), timeout 5s, log em `webhook_deliveries` (status, duração,
  erro). UI de automatizações com seletor de ação + URL; página
  `/integrations` com chaves e entregas.
- **Permissões novas**: `trade:read|write`, `integrations:read|write`
  (manager/admin; operator só `trade:write`).

### Testes executados

| Suite | Resultado |
|---|---|
| API Vitest (incl. customs, chaves, v1, webhook com servidor local real) | **97/97 ✅** |
| Web Vitest | 2/2 ✅ |
| Typecheck API + build Web | ✅ |
| Playwright e2e | ✅ 6 testes — novo: incoterm+artigo+transição aduaneira+evento, criar chave → `fetch("/api/v1/shipments")` autenticado |

### Limitações conhecidas

- Webhooks: entrega síncrona best-effort (sem retry/fila); assinatura HMAC
  por regra, payload genérico `{trigger,title,body,link,at}`.
- API v1 sem rate limiting dedicado nem scopes por chave (âmbito fixo
  «operator»); chaves não expiram.
- Fatura comercial é CSV simples (sem PDF/logótipo nem campos fiscais
  completos — ex.: valores por linha vs. totals separados por moeda).
- Sem declarativas aduaneiras formais (MRN, SAD, AES) — apenas dados para
  instrução documental.
- `operations.spec.ts` continua a falhar esporadicamente sob carga (flake de
  timing, passa isolado — pendente de investigação na Fase 8).

---

## Fase 7 — Subscrições, faturação e administração SaaS ✅ (2026-10-16)

### Implementado

- **Planos globais** (`plans`): Starter 29 €/5 users/2 chaves API,
  Pro 99 €/25/10, Enterprise 499 €/1000/50 — semeados no arranque
  (`ensurePlans`, idempotente por `code`).
- **Subscrição por tenant** (`subscriptions`): estado `trialing|active|
  past_due|cancelled`, `trialEndsAt`, período corrente, `cancelAtPeriodEnd`.
  O registo cria trial de 14 dias no plano Starter; `tenants.plan` fica
  sincronizado com o código do plano.
- **Faturas** (`subscription_invoices`): numeração `INV-xxxxx` por tenant,
  `open|paid|void`; emissão manual (valor = preço mensal do plano, vencimento
  +14 dias); pagamento marca `paid`, ativa a subscrição e abre novo período de
  30 dias; anulação só de faturas em aberto.
- **Administração da plataforma**: `platform_admins` sincronizada com a env
  `PLATFORM_ADMIN_EMAILS` em login/registo/aceite de convite; `isPlatformAdmin`
  no DTO do utilizador. Endpoints `/api/admin/*` com guard dedicado:
  `GET /tenants` (plano, estado de subscrição, nº de utilizadores, suspensão),
  `POST /tenants/:id/plan`, `POST /tenants/:id/suspend|activate`,
  `GET /invoices` (faturas de todos os tenants).
- **Enforcement de limites**: convite de utilizador rejeitado (403) ao atingir
  `maxUsers` do plano; criação de chave API rejeitada ao atingir `maxApiKeys`.
- **Suspensão de tenant** (`tenants.suspendedAt`): `requirePermission`
  bloqueia qualquer permissão de escrita (403 «Conta suspensa»); leitura
  mantém-se. Utilizadores do tenant recebem notificação direta
  (`notifyUsersDirect`, sem regra de automatização).
- **Permissões novas**: `billing:read|write` — admin/manager escrevem;
  admin/manager/operator leem. UI `/billing` (plano, uso vs. limites, faturas,
  mudança de plano) e `/admin` (só platform admins). Migração `0006`.

### Testes executados

| Suite | Resultado |
|---|---|
| API Vitest | **108/108 ✅** (11 novos: trial de 14d, planos, emissão/pagamento/anulação de faturas INV-xxxxx, mudança de plano, limite maxUsers, suspensão lê-não-escreve, isolamento de faturas, auth de admin, suspend/reactivate, faturas globais) |
| Web Vitest | 2/2 ✅ |
| Typecheck API + build Web | ✅ |
| Playwright e2e | **8/8 ✅** — 2 novos: trial→emitir fatura→pagar→mudar para Pro; admin suspende/reativa tenant com PLATFORM_ADMIN_EMAILS |

### Limitações conhecidas

- Faturação manual — sem gateway de pagamentos (Stripe) nem cobrança
  recorrente automática; sem prorrata ao mudar de plano.
- Sem transição automática de trial para `past_due`/`cancelled` nem dunning
  (precisa de scheduler — Fase 8).
- Tokens JWT já emitidos continuam válidos para leitura até expirarem (15 min)
  mesmo com o tenant suspenso — aceitável; hardening na Fase 8.
- `/api/admin` sem paginação nem filtros (suficiente para volumes iniciais).

---

## Fase 8 — Hardening, produção e documentação ✅ (2026-10-16)

### Implementado

- **Scheduler embutido** (`lib/scheduler.ts`, `SCHEDULER_INTERVAL_MS` def. 1h,
  desligado em testes): trial expirado → subscrição `past_due` + notificação;
  fatura `open` vencida em conta `active` → `past_due` + notificação; retry
  de webhooks falhados (backoff 5 min/30 min, máx. 3 tentativas via
  `webhook_deliveries.attempts`/`nextRetryAt`/`payload` persistido).
- **Chaves de API**: `expiresAt` opcional (schema, DTO, coluna, UI com input
  de data); a `/api/v1` rejeita chaves expiradas e tem rate limit dedicado
  (120/min).
- **Storage S3/MinIO**: `S3Storage` com `@aws-sdk/client-s3` carregado
  dinamicamente — ativado quando `S3_BUCKET` definido; path-style para
  MinIO/compatíveis; driver local mantém-se por omissão.
- **Produção**: `apps/api/Dockerfile` + `apps/web/Dockerfile` (multi-stage,
  nginx com SPA fallback + proxy `/api`), docker-compose completo
  (postgres+minio+bucket init+api+web), `tsx` movido para dependencies
  (`npm start` funciona em `--omit=dev`), `docs/PRODUCTION.md` (envs,
  RLS de exemplo, checklist go-live) e `docs/SECURITY.md` (postura completa).
- **Fixes**: encoding/mojibake dos comentários do `schema.ts`; flake do
  `operations.spec.ts` mitigado (timeout 120s — teste longo legítimo);
  migração `0007`.

### Testes executados

| Suite | Resultado |
|---|---|
| API Vitest | **114/114 ✅** (6 novos: trial expirado, fatura vencida, chave expirada/futura, retry de webhook real, máx. tentativas) |
| Web Vitest | 2/2 ✅ |
| Typecheck API + build Web | ✅ |
| Playwright e2e | **8/8 ✅** |
| npm audit | Produção limpa; dev-only remanescentes documentadas |

### Limitações conhecidas (finais)

- Scheduler embutido na API — para multi-instância extrair para worker/fila.
- Webhooks com retry limitado (3 tentativas) — sem fila persistente.
- RLS documentado mas não aplicado (exige propagar `app.tenant_id` por
  transação — mudança pendente, validável só em Postgres real).
- Sem scanning de uploads, bloqueio SSRF de webhooks, nem SMTP real.
- `npm start` corre via tsx (sem build pass no container).

---

## Estado do projeto

Fases 1–8 concluídas. A plataforma cobre: auth/multi-tenancy/RBAC, parceiros,
encomendas, expedições e tracking, rotas e custos, armazéns e inventário,
documentos e automatizações, comércio internacional, API pública e webhooks,
subscrições e administração SaaS — com testes (114 API + 8 e2e), docs de
arquitetura/segurança/produção e empacotamento Docker.
