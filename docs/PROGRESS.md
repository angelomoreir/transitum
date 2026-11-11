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
  segredo HMAC por regra; POST JSON assinado (`x-transitum-signature:
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

## Fase 9 — Ligação encomenda→stock→expedição, documentos AT, tracking e motorista ✅ (2026-10-21)

Implementação da recomendação da análise comparativa com TMS/WMS concorrentes
(Cargoson, Onfleet, CartonCloud, e2open). Migração `0008`.

### Implementado

- **Encomenda → stock → expedição**: linhas de encomenda ligadas a artigos
  (`itemId`, `unitPrice`, `reservedQty`, `shippedQty`), `warehouseId` na
  encomenda, reserva atómica ao confirmar (`onHand − reserved` com UPDATE
  condicional anti-race em `lib/stock.ts`), linhas de expedição
  (`shipment_lines`) a partir das quantidades pendentes, saída automática de
  stock na transição para `in_transit` e devolução/libertação no cancelamento —
  tudo centralizado em `lib/shipment-flow.ts` usado por backoffice, rotas,
  motorista e eventos de transportadora.
- **Custos automáticos**: motor de tarifas (`lib/rating.ts`) com bases
  `flat`/`per_kg`/`per_km`/`per_package` e `minCharge`;
  `GET /shipments/:id/quotes` (cotação ordenada com motivo de falta),
  `POST /:id/apply-rate` (insere custo `freight` com `rateId`) e aplicação
  automática ao planear a expedição.
- **Geolocalização**: geocodificação Nominatim com cache em BD e rate limit
  (`lib/geo.ts`), coordenadas e distância estimada em expedições e paragens,
  `haversineKm` × `ROAD_DISTANCE_FACTOR`. Desativado em testes (`NODE_ENV=test`
  → noop) e com `GEOCODER=none`.
- **Tracking público**: `trackingToken` por expedição, página pública
  `/track/:token` (sem auth) com timeline, mapa Leaflet, posição GPS e POD;
  endpoint `GET /api/track/:token` filtra eventos internos (notas/stock) e
  não expõe morada completa nem email.
- **Notificações ao destinatário**: email (SMTP via `SMTP_URL`, senão consola)
  e SMS (`SMS_PROVIDER=twilio` ou consola) na entrada em trânsito e na entrega,
  com link de tracking; eventos `notification` registados na timeline.
- **Documentos AT (DL 198/2012)**: emissão de guias GT/GR com numeração por
  série, ATCUD (código de validação da série), assinatura RSA-SHA1 em cadeia e
  QR (Portaria 363/2010), comunicação à AT via SOAP/WS-Security em modo
  `mock` (dev/teste) ou `live` (portos 401/701, certificados por env);
  validação de NIF PT (módulo 11) e mensagens de erro por campo em falta.
- **PDFs**: guia de transporte (com ATCUD/QR), carta CMR e etiquetas com
  código de barras — PDFKit + bwip-js; `GET /shipments/:id/documents/{guide,cmr,labels}.pdf`.
- **App do motorista**: função `driver` com permissão exclusiva `driver:app`;
  rotas atribuídas (`driverUserId`), transições de paragem com GPS,
  prova de entrega (assinatura desenhada + foto + coords + nome) que conclui
  a paragem e entrega a expedição, posição GPS periódica (`route_positions`,
  última posição exposta na expedição, tracking e rota).
- **Transportadoras**: `carrier_connections` com credenciais cifradas AES-256-GCM
  (`lib/secrets.ts`, `SECRETS_KEY` obrigatório em produção); adaptadores
  CTT/DPD/Nacex (`sandbox` simulado; Nacex com modo `live`);
  `POST /:id/book` (nº de tracking + evento) e `POST /:id/sync-tracking`
  (eventos novos sem duplicar + transição automática); push de eventos na
  API v1 (`POST /api/v1/carrier-events` por nº de tracking).
- **Relatórios**: `GET /api/reports/overview` (expedições, on-time, custos por
  expedição/kg/tipo, por transportadora e cliente, semanas, rotas/PODs) e
  `GET /api/reports/shipments.csv` com permissão `reports:read`.
- **Frontend**: página pública `/track/:token`, app `/driver` (rota atribuída →
  paragens → POD com canvas de assinatura e foto), `/reports` com KPIs e
  exportação CSV, mapa Leaflet em expedição e rota, cartão de operações na
  expedição (cotações/aplicar tarifa, emitir guia AT, PDFs, marcar/sincronizar
  transportadora, link de tracking), linhas de expedição e PODs visíveis,
  formulário de encomenda com artigo+armazém+preço, destinatário na nova
  expedição, motorista (utilizador) na nova rota, dados fiscais + AT nas
  definições, ligações de transportadoras nas integrações, nav filtrada por
  permissões e papel `driver` nos convites.

### Testes executados

| Suite | Resultado |
|---|---|
| API Vitest | **143/143 ✅** (29 novos em `ops.test.ts`: reserva/saída/devolução de stock, cotação e tarifa, guia AT+ATCUD+PDFs, tracking público, POD via app do motorista, ligação+booking+sync Nacex sandbox, push API v1, relatórios, isolamento de tenant) |
| Web Vitest | 2/2 ✅ |
| Typecheck API + Web | ✅ |
| Build Web | ✅ |
| Playwright e2e | **8/8 ✅** |

### Limitações conhecidas

- AT em `live` exige certificados e chaves reais por env; só o modo `mock`
  foi exercido em testes. O mesmo para Nacex `live` (CTT/DPD só sandbox).
- SMS real depende de Twilio configurado; geocodificação é Nominatim (limite
  1 req/s — distância estimada por fator, sem matriz de rotas reais).
- Otimização de rotas, EDI e integrações ERP/e-commerce ficam para fases
  seguintes.

---

## Fase 10 — Otimização de paragens, importação CSV, reposição, ETA e i18n EN ✅ (2026-10-21)

### Implementado

- **Otimização de paragens** (`POST /api/routes/:id/optimize`): reordena as
  paragens pendentes por proximidade via nearest-neighbor sobre as coordenadas
  (`optimizeStopOrder` em `lib/geo.ts`). Ponto de partida opcional
  (`startLat`/`startLng`) ou última posição GPS da rota; paragens já
  iniciadas/concluídas mantêm a posição e as sem coordenadas ficam no fim.
  Botão «Otimizar paragens» no detalhe da rota.
- **Importação CSV em massa** (`lib/csv.ts` — separador `;`/`,` detetado
  automaticamente, campos entre aspas, máx. 500 linhas):
  `POST /api/partners/import` e `POST /api/items/import` aceitam `{ csv }`,
  validam cada linha com os schemas partilhados, criam as válidas e devolvem
  erros por número de linha. Cabeçalhos em inglês ou português (tipos
  `cliente|fornecedor|transportadora`, `nome`, `nif`, `unidade`, `peso`…);
  SKUs duplicados são saltados. Diálogo `CsvImportDialog` nas páginas de
  parceiros e artigos.
- **Ponto de reposição** (migração `0009`): `stock_levels.reorder_point` por
  artigo × armazém; `PUT /api/stock/reorder-point` (upsert da linha de stock)
  e `GET /api/stock/alerts` (disponível `on_hand − reserved` ≤ ponto, com
  `deficit`). UI: faixa de alertas de rutura no separador Stock e clique no
  valor para definir o ponto.
- **ETA no tracking público**: `estimatedArrivalAt` no DTO público —
  distância restante (última posição GPS → destino) × fator rodoviário a
  50 km/h, só quando `in_transit`; mostrado na página `/track/:token`.
- **Idioma en-GB**: `i18n/en-GB.ts` completo, deteção por
  `navigator.language` (pt* → pt-PT, resto → en-GB), persistência em
  `localStorage` e seletor no menu do utilizador (`document.lang` atualizado).
- **Dependências**: `vitest` 3.2.7 → 5.0.5 — `npm audit` de 7 vulnerabilidades
  (2 críticas: `tinypool`, `@vitest/mocker`) para 4 moderadas, todas dev-only
  em `esbuild` antigo dentro do `drizzle-kit` (fix exigiria downgrade
  breaking; não aplicado).

### Testes executados

| Suite | Resultado |
|---|---|
| API Vitest | **150/150 ✅** (7 novos em `phase10.test.ts`: import parceiros/artigos com erros por linha e CSV vazio, ponto de reposição + alerta + limpeza, otimização NN com coords injetadas, ETA no tracking) |
| Web Vitest | 2/2 ✅ |
| Typecheck API + Web | ✅ |
| Build Web | ✅ |

### Limitações conhecidas

- A otimização usa distância em linha reta (× fator) — sem matriz de tempos
  reais, janelas horárias ou capacidade (OSRM/Valhalla numa fase posterior).
- ETA assume velocidade média fixa (50 km/h), sem trânsito.
- Importação CSV sem preview/mapeamento de colunas nem exportação modelo
  (.xlsx futuro).
- As 4 vulnerabilidades moderadas restantes são dev-only (`esbuild` via
  `drizzle-kit`) — acompanhar upgrade compatível do drizzle-kit.
- EDI/ERP, MFA/SSO, auditoria de faturas de frete e WMS avançado (lotes,
  bins, picking) continuam em aberto.

---

## Fase 11 — MFA/TOTP, auditoria de faturas de frete, CSV de encomendas e contagem de stock ✅ (2026-10-23)

### Implementado

- **MFA/TOTP** (RFC 6238, sem dependências — `lib/totp.ts`): segredo base32,
  HMAC-SHA1, janela 30 s ±1.
  - `POST /api/auth/mfa/setup` gera segredo (guardado **cifrado** AES-256-GCM
    via `lib/secrets.ts`) + URI `otpauth://`; `/mfa/enable` e `/mfa/disable`
    confirmam com código (desativar revoga as outras sessões).
  - Login em duas fases: com MFA ativo, `POST /login` devolve
    `{ mfaRequired, mfaToken }` (JWT 5 min com `purpose: "mfa"`) sem emitir
    sessão; `POST /mfa/verify` troca-o por sessão completa. Tokens com
    `purpose` são rejeitados por `authenticate`/`requirePermission`, logo o
    mfaToken não funciona como access token.
  - UI: passo de código no login e cartão `MfaCard` nas definições
    (segredo + URI otpauth, ativar/desativar).
- **Auditoria de faturas de frete** (tabela `carrier_invoices`, migração
  `0010`): `POST /api/freight-invoices` regista a fatura da transportadora e
  calcula `expectedAmount` (soma dos custos `freight` da expedição na mesma
  moeda), `variance` e estado (`pending` sem expedição/custos, `matched`
  |desvio| ≤ 0,01, `discrepancy`). `GET /` com filtros e resumo
  (pendentes/conformes/discrepâncias + desvio total). Página
  `/freight-invoices` com badges de resumo, filtro por estado e diálogo de
  registo (transportadora + expedição opcional).
- **Scorecard de transportadora** no relatório overview: por transportadora
  junta-se `podRate` (PODs/entregas), `invoices` e `invoiceDiscrepancies` no
  período; colunas POD e Faturas na tabela do relatório.
- **Importação CSV de encomendas** (`POST /api/orders/import`): linhas com a
  mesma `ref`/`encomenda` são agrupadas (multi-linha); cliente resolvido por
  `cliente` (nome exato) ou `nif`, armazém por nome, artigos por `sku`.
  Criadas em rascunho (a reserva de stock acontece ao confirmar); peso vem do
  artigo quando a linha tem SKU. Erros reportados por linha do grupo.
  `CsvImportDialog` na página de encomendas.
- **Contagem física de stock** (tabelas `inventory_counts` +
  `inventory_count_lines`, numeração `CNT-XXXXX`): `POST /api/inventory-counts`
  faz snapshot do `on_hand` por artigo no armazém (ou dos `itemIds` dados);
  `PATCH /:id/lines` regista quantidades contadas; `POST /:id/apply` gera um
  movimento `adjust` por divergência (quebras respeitam o stock reservado) e
  fecha a contagem; `POST /:id/cancel`. Separador «Contagens» na página de
  inventário com diálogo de registo linha a linha.

### Testes executados

| Suite | Resultado |
|---|---|
| API Vitest | **163/163 ✅** (13 novos em `phase11.test.ts`: enroll+código errado/correto, desafio no login, mfaToken rejeitado como access token, verify; fatura conforme/discrepante/pendente + resumo + scorecard; CSV encomendas multi-linha com erros; contagem snapshot→linhas→apply→movimentos, apply duplo e cancel) |
| Web Vitest | 2/2 ✅ |
| Typecheck API + Web | ✅ |
| Build Web | ✅ |
| Playwright e2e | **8/8 ✅** |

### Limitações conhecidas

- O segredo TOTP é mostrado como texto + URI `otpauth://` (sem imagem QR —
  adicionar `qrcode` no futuro); sem códigos de recuperação (recovery codes)
  — se o utilizador perder o dispositivo, só um admin o pode ajudar criando
  nova conta ou desativando MFA via suporte.
- Auditoria de faturas compara com custos `freight` registados na expedição;
  não faz match automático por número de fatura nem importa faturas em
  massa/EDI.
- A contagem faz snapshot de artigos **com registo de stock**; artigos sem
  nível no armazém não entram (adicionar linhas manualmente numa fase
  posterior). Sem contagem cíclica agendada nem contagens por zona/bin.
- Continuam em aberto: EDI/ERP, SSO, WMS avançado (lotes, séries, bins,
  picking/packing), matriz de distâncias reais e faturação ao cliente.

## Fase 12 — Frota, devoluções, picking, torre de controlo e contagens por seleção

- **Frota de viaturas** (tabela `vehicles`, migração `0011_grey_squadron`):
  CRUD `/api/vehicles` com matrícula única por tenant, tipo
  (carrinha/camião/ligeiro/mota/outro), capacidade em kg e ativação.
  `routes.vehicle_id` liga a viatura à rota — ao atribuir, `vehicleRef` fica
  automaticamente com a matrícula; PATCH sincroniza a matrícula ao trocar de
  viatura. Viaturas inativas são rejeitadas. Página `/vehicles` + seletor no
  formulário de nova rota.
- **Devoluções RMA** (tabelas `returns` + `return_lines`, numeração
  `DEV-XXXXX`): `POST /api/returns` com cliente + armazém + encomenda
  opcional + linhas (artigo ou texto livre — descrição derivada do nome do
  artigo quando omitida). `POST /:id/receive` dá entrada em stock (movimento
  `in`) por linha com artigo — suporta receção parcial e fecha quando nada
  falta; `POST /:id/cancel`. Página `/returns` com criação multi-linha,
  detalhe e ações receber/anular.
- **Guia de picking**: `GET /api/orders/:id/picklist` devolve as linhas por
  expedir (encomendado − expedido) com reservado e stock disponível no
  armazém da encomenda (0 quando o artigo não tem registo);
  `GET .../picklist.pdf` gera a guia A4 com grelha SKU/artigo/a
  separar/disponível, coluna «apanhado» e assinaturas
  separado/conferido/embalado. Card de picking + botão PDF no detalhe da
  encomenda.
- **Torre de controlo**: `GET /api/reports/exceptions` agrega exceções
  ativas — expedições em atraso (data prevista passada, por entregar; alta),
  entregues sem POD (média) e em curso sem transportadora (média) —
  ordenadas por severidade. Secção na página de relatórios com contadores e
  tabela ligada às expedições.
- **Contagem por seleção**: `POST /api/inventory-counts` com `itemIds`
  inclui os artigos escolhidos mesmo sem registo de stock (esperado 0) —
  permite contar artigos que deveriam existir; diálogo «Nova contagem» passa
  a ter âmbito todos/selecionados com lista de checkboxes.

### Testes executados

| Suite | Resultado |
|---|---|
| API Vitest | **178/178 ✔** (15 novos em `phase12.test.ts`: viatura CRUD + matrícula duplicada + atribuição/sincronização + inativas; RMA criar/receção parcial/total/anular + entrada em stock; picklist JSON + PDF + linha expedida; exceções; contagem com seleção + artigo sem stock + inexistente) |
| Web Vitest | 2/2 ✔ |
| Typecheck API + Web | ✔ |
| Build Web | ✔ |

### Limitações conhecidas

- A receção da devolução não faz inspeção/qualidade (aceitar/rejeitar por
  linha) nem gera nota de crédito — entra tudo em stock utilizável.
- A guia de picking não tem percurso otimizado por localizações (bins/zonas
  ainda não existem) nem modo wave/batch para várias encomendas.
- Exceções da torre de controlo são derivadas em tempo real (sem tabela de
  alertas, snooze ou atribuição); sem SLA configurável por cliente.

## Fase 13 — Localizações/bins, intake EDI, portal do cliente, alertas e CO₂ ✅ (2026-10-18)

### Implementado

- **Localizações (bins/zonas)**: tabela `warehouse_locations` (código único por
  armazém, zona, ativa) + `item_pick_locations` (localização preferencial de
  picking por artigo/armazém). CRUD `GET/POST /api/warehouses/:id/locations`,
  `PATCH /api/locations/:id`, atribuição `PUT /api/warehouses/:id/pick-locations`
  e `GET` do mapa artigo→localização. Importação CSV `codigo;zona` com
  deduplicação. Picking dirigido: a guia de picking (JSON + PDF) mostra a
  localização (`ZONA-COD`) e ordena as linhas pelo percurso (zona→código→fim).
  Separador «Localizações» no inventário com gestão de bins e atribuição por
  artigo.
- **Intake EDI/e-commerce (v1)**: `POST /api/v1/inbound-orders` — cria
  encomenda a partir de referências externas: `externalRef` idempotente
  (`orders.external_ref` unique por tenant), cliente resolvido por NIF/nome ou
  criado automaticamente, artigos por SKU (SKU desconhecido fica como linha de
  texto), armazém por código ou primeiro ativo. `GET /api/v1/stock` expõe
  níveis de stock paginados para integrações.
- **Portal do cliente**: `partners.portal_token` + `POST/DELETE
  /api/partners/:id/portal-link` (gera/roda/revoga token opaco). Endpoint
  público `GET /api/portal/:token` (rate-limited) devolve encomendas e
  expedições do cliente com links `/track/:token`. Página pública
  `/portal/:token`; ação «Link do portal» nos parceiros-clientes copia o URL.
- **Alertas de atraso**: `alertLateShipments` no scheduler — expedições
  planned/in_transit com `plannedDeliveryAt` ultrapassada geram evento `alert`
  na timeline + notificação in-app ao tenant, uma vez (`late_alerted_at`).
- **CO₂ estimado**: `estimatedCo2Kg` por expedição (distância × t × 0,096 kg
  CO₂e/t·km, DEFRA) no DTO e soma `shipments.estimatedCo2Kg` no relatório
  overview + KPI na página.
- Migração `0012_flimsy_bulldozer`.

### Testes executados

| Suite | Resultado |
|---|---|
| API Vitest | **189/189 ✅** (11 novos em `phase13.test.ts`: localizações CRUD + CSV, picking ordenado por zona, inbound-orders cria/idempotente/NIF, stock na v1, portal link/revogação, alertas scheduler, CO₂) |
| Web Vitest | 2/2 ✅ |
| Typecheck API + Web | ✅ |
| Build Web | ✅ |
| Playwright e2e | 8/8 ✅ |

### Limitações conhecidas

- Localizações são preferenciais (orientação), não contabilizam stock por bin —
  movimentos continuam ao nível do armazém (putaway/bin-to-bin pendente).
- O intake EDI é JSON REST, não EDI clássico (X12/EDIFACT) nem conectores
  prontos Shopify/WooCommerce — mas qualquer sistema consegue chamar o
  endpoint com chave de API.
- Portal é read-only (sem criação de encomendas nem documentos para download).
- Alertas de atraso só correm no scheduler do processo da API (intervalo
  configurável); sem re-notificação periódica.
- CO₂ usa fator rodoviário único (0,096 kg/t·km); sem fator por tipo de
  viatura nem outros modos.

## Fase 14 — Conectores Shopify/WooCommerce, lotes FEFO, wave picking e encomendas no portal ✅ (2026-10-18)

### Implementado

- **Canais de entrada (webhooks e-commerce)**: tabela `inbound_channels`
  (fonte shopify/woocommerce/generic, token único no URL, segredo HMAC
  guardado cifrado AES-256-GCM). CRUD em `/api/integrations/inbound-channels`
  (criar, listar, ativar/desativar). Endpoint público
  `POST /api/inbound/:token` com parser de corpo bruto: verifica a assinatura
  por fonte — Shopify `x-shopify-hmac-sha256` (base64), WooCommerce
  `x-wc-webhook-signature` (base64) e genérico `x-transitum-signature` (hex) —
  com comparação constant-time. Mapeadores `mapShopifyOrder`/
  `mapWooCommerceOrder` em `lib/inbound.ts` convertem os payloads
  (`line_items`, `shipping_address`/`shipping`, cliente por nome/email) para
  o formato inbound; idempotência por `externalRef` (`shopify:#1001`,
  `woocommerce:42`). A criação da encomenda partilha `createInboundOrder`
  com o endpoint v1 (resolução de cliente/SKU/armazém). Card «Lojas e EDI»
  na página de integrações com URL para copiar.
- **Lotes com validade + FEFO**: tabela `stock_lots` (código único por
  tenant+armazém+artigo, `expires_at`, `on_hand`) + `stock_movements.lot_code`.
  Entradas com `lotCode`/`lotExpiresAt` (movimentos manuais e receção de
  compras) criam/atualizam lotes (`applyLotDelta`); saídas manuais e saída
  automática da expedição consomem por **FEFO** (`consumeLotsFefo` — validade
  mais próxima primeiro, sem-validade por último) e o movimento regista os
  lotes consumidos na nota. `GET /api/stock/lots` lista lotes com
  `daysToExpiry` e filtro `expiringDays`. Separador «Lotes» no inventário +
  campos de lote no diálogo de entrada.
- **Wave picking**: `POST /api/orders/pick-wave` recebe `orderIds` e agrega
  as linhas por expedir por (artigo×armazém), com localização preferencial,
  stock disponível e detalhe por encomenda, ordenado pelo percurso
  zona→localização. Diálogo «Wave de picking» na página de encomendas
  (seleção das confirmadas → guia agregada imprimível).
- **Portal com criação de encomendas**: `POST /api/portal/:token/orders`
  (rate-limited) cria encomenda em rascunho sempre associada ao cliente do
  token — endereço herdado do parceiro, armazém por defeito, linhas por SKU
  ou texto livre, notificação in-app ao tenant. Formulário público na página
  `/portal/:token`.
- Migração `0013_dizzy_ikaris`.

### Testes executados

| Suite | Resultado |
|---|---|
| API Vitest | **203/203 ✅** (14 novos em `phase14.test.ts`: canais CRUD, Shopify assinatura OK/falha/idempotente/mapeamento, WooCommerce, genérico hex, token desconhecido, canal inativo, lotes FEFO + validações, wave agregado/ordenado, portal cria/isolamento) |
| Web Vitest | 2/2 ✅ |
| Typecheck API + Web | ✅ |
| Build Web | ✅ |
| Playwright e2e | 8/8 ✅ |

### Limitações conhecidas

- Webhooks Shopify/WooCommerce validam assinatura e mapeiam o payload comum
  de «order created»; campos extra (impostos, envios parciais, clientes com
  NIF) não são mapeados. Sem retries/queue — o remetente reenvia.
- Lotes são um desdobramento informativo do `on_hand` (a soma dos lotes pode
  divergir do nível se houver movimentos sem lote); devoluções de expedições
  canceladas repõem stock sem lote. Sem stock por bin nem putaway.
- A wave é uma guia calculada (não persiste atribuição a operador nem estado
  de separação por linha).
- Encomendas do portal ficam em rascunho sem preço do catálogo nem validação
  de stock; o backoffice confirma/edita antes de reservar.

## Fase 15 — Faturação ao cliente, stock por bin, números de série e distâncias reais ✅ (2026-10-18)

### Implementado

- **Faturação ao cliente**: `sales_invoices` + `sales_invoice_lines` (migração
  `0014_melted_sunset`). CRUD em `/api/sales-invoices` guardado por
  `billing:read`/`billing:write`, numeração `FT-XXXXX`, ciclo
  rascunho → emitida → paga (ou anulada). Com `orderId` e sem linhas manuais,
  copia as linhas com preço da encomenda. Página `/sales-invoices` com filtros,
  detalhe de linhas e ações de estado.
- **Stock por bin**: `stock_bin_levels` desagrega o `on_hand` por
  `warehouse_location` (informativo, como os lotes). Entradas manuais,
  receções de compra e devoluções aceitam `locationId` (putaway); saídas
  consomem do bin indicado ou da localização preferencial de picking
  (`consumeBins`). `POST /api/stock/bin-transfer` move stock entre bins sem
  alterar o total do armazém (registado como movimento `transfer` com o par
  de bins na nota); `GET /api/stock/bin-levels` lista por armazém/artigo;
  `stock_movements.location_id` guarda o bin. Separador «Bins» com
  transferência guiada e select de bin no diálogo de movimentos.
- **Números de série**: `items.serialized` + `item_serials` (único por
  tenant×artigo×série; estados `in_stock`/`issued`). Artigos serializados
  exigem lista de séries igual à quantidade em entradas, saídas e
  transferências — movimentos manuais, receções de compra e devoluções
  (`returnSerials` repõe issued→in_stock). A saída automática da expedição
  consome as primeiras séries em stock (`issueSerialsAuto`) e regista-as na
  nota do movimento; o cancelamento repõe as últimas saídas.
  `GET /api/stock/serials` com filtros q/estado + separador «Séries»;
  checkbox «Gerido por número de série» no artigo e textarea de séries no
  movimento.
- **Distâncias reais (OSRM + cache)**: `lib/routing.ts` chama
  `GET /route/v1/driving` (`ROUTER`/`ROUTER_URL`, timeout 5 s) com cache
  persistente em `distance_cache` (par de coordenadas a ~11 m). `routeLeg`
  devolve km + duração; sem router ou em falha recua para Haversine × fator.
  Ligado à `distanceKm` das expedições, ao ETA do tracking público (duração
  real quando disponível) e à otimização de paragens
  (`optimizeStopOrderAsync` — nearest-neighbor sobre distâncias reais).
  `NODE_ENV=test` desliga o router.
- **Code-splitting**: todas as páginas passaram a `React.lazy` com `Suspense`
  global; `manualChunks` separa vendors (react, leaflet, radix, zod, i18n,
  icons, shared). O chunk de entrada desce de ~1,1 MB para **156 kB**;
  o Leaflet (150 kB) só carrega nas páginas com mapa.
- Correção latente: `return_lines.line_no` — o detalhe da devolução ordenava
  as linhas por UUID (ordem aleatória, flake nos testes).

### Testes executados

| Suite | Resultado |
|---|---|
| API Vitest | **221/221 ✅** (18 novos em `phase15.test.ts`: faturas manual/da encomenda/estados/isolamento, putaway/bin-transfer/consumo dirigido/bin inválido, séries entrada/saída/duplicada/inexistente/receção PO, OSRM cache+fallback) |
| Web Vitest | 2/2 ✅ |
| Typecheck API + Web | ✅ |
| Build Web | ✅ — entry 156 kB, vendors separados |
| Playwright e2e | 8/8 ✅ |

### Limitações conhecidas

- Faturas são documentos internos (sem PDF nem comunicação AT de faturas);
  `unitPrice` é o valor final da linha — sem IVA por linha nem totais de IVA.
- Bins são informativos como os lotes: a soma dos bins pode divergir do
  `on_hand` quando há movimentos sem localização; transferências entre
  armazéns não movem bins; a saída da expedição consome bins mas o
  cancelamento não repõe o bin (o stock volta, a posição não).
- Séries: transferência entre armazéns exige lista explícita; contagens e
  ajustes ignoram séries; o auto-pick da expedição escolhe por ordem
  alfabética da série.
- OSRM depende do endpoint configurado (público ou self-hosted); sem SLA. A
  otimização resolve distâncias por par de forma sequencial — mitigado pela
  cache persistente.


## Fase 16 - Faturas fiscais, bins reversiveis, series em contagem, waves persistidas, SSO/OIDC e EDIFACT

### Faturas de venda com IVA + fiscalizacao AT

- Linhas com `taxRate` (23% por defeito, excecao 0/6/13/23); fatura com
  `subtotal`, `taxTotal` e `total` (bruto), arredondados a centimos por linha.
- Na emissao (`status -> issued`), a fatura e fiscalizada como as guias:
  serie prefixada `FT`, sequencial por serie, ATCUD, hash encadeado SHA-256
  (encadeamento por serie dentro do tenant) e `hashControl`; se o tenant
  tiver credenciais AT ativas, `app.atClient.communicateInvoice()` envia o
  documento e grava `atStatus`/`atMessage`.
- `GET /api/sales-invoices/:id/pdf` gera PDF A4 (`salesInvoicePdf` em
  `lib/pdf.ts`) com linhas, IVA por linha, totais discriminados, ATCUD e
  hash parcial; frontend com coluna IVA, totais e botao de download.

### Bins: reversao exata e reconciliacao

- A saida automatica de stock da expedicao regista no movimento `out` os
  bins/lotes/series consumidos por linha (`B:LOCx2+LOC2x1 | L:LOTx3 | S:a,b`).
- O cancelamento le essas notas e repoe **nos mesmos bins** as quantidades,
  e as series voltam a `in_stock` no armazem original.
- `GET /api/stock/bin-reconciliation` compara `on_hand` com a soma dos bins
  por armazem+artigo e reporta divergencias (causadas por movimentos sem
  localizacao). Painel de reconciliacao no separador Localizacoes.

### Contagens serializadas + waves persistidas

- Linhas de contagem aceitam `serialList` para artigos serializados: o
  `countedQty` deriva da lista; no `apply`, series esperadas nao contadas
  passam a `written_off` e extras/novas a `in_stock` (validacao de
  duplicados e de armazem proprietario no PATCH).
- Tabelas `pick_waves`/`pick_wave_lines` (numeracao `WV-XXXXX`) com operador
  atribuido e estado `open/in_progress/done/cancelled`. Endpoints
  `/api/pick-waves` (list/create/detail/patch/lines); o progresso por linha
  (`pickedQty`) transita a wave automaticamente. Pagina `/pick-waves` e
  botao "Guardar wave" no dialogo de picking agregado das encomendas.

### SSO/OIDC por tenant

- `sso_providers` (descoberta por dominio de email, clientId, endpoints,
  segredo cifrado AES-256-GCM, papel por defeito e auto-provisionamento) e
  `sso_states` (state+nonce com expiracao).
- CRUD tenant em `/api/sso-providers`; endpoints publicos
  `GET /api/auth/sso/providers?email=`, `GET /api/auth/sso/start?provider=`,
  `GET /api/auth/sso/callback` (code exchange, userinfo, login/provisioning
  com audit). Login page com campo de email para descobrir SSO; pagina
  `/auth/sso/callback`; card de gestao nas definicoes. `API_BASE_URL`
  controla o redirect URI (fallback: headers do pedido).

### EDI classico: EDIFACT ORDERS

- `lib/edifact.ts` faz parse de um subconjunto ORDERS D.96A: UNB (remetente),
  UNH, BGM (numero), DTM, NAD+BY (nome/NIF), LIN/QTY/PRI/IMD; separadores
  respeitam escapes `?`.
- `inbound_channels` aceita `source: "edifact"`; `POST /api/inbound/:token`
  com `Content-Type: application/edifact` ou `text/plain` faz parse e cria a
  encomenda via o mesmo `createInboundOrder` (idempotente por
  `edifact:{sender}:{doc}`). Assinatura `x-transitum-signature` (HMAC hex).

### Migracao

- `0015_narrow_menace.sql`: enum `edifact`, `pick_wave_status`, colunas
  fiscais em `sales_invoices`/`sales_invoice_lines`, `counted_serials` em
  `inventory_count_lines`, tabelas `pick_waves`, `pick_wave_lines`,
  `sso_providers`, `sso_states`.

### Testes

- `test/phase16.test.ts`: 20 testes (IVA+fiscalizacao+PDF, reversao de bins
  e reconciliacao, contagem serializada, waves persistidas, SSO, EDIFACT).
- Suite: 241/241 API, 2/2 web, typechecks e build verdes, e2e 8/8.

### Limitacoes conhecidas

- IVA e um valor por linha (sem codigos de isencao nem regimes); o PDF nao
  inclui QR code AT (espaco reservado para quando a certificacao exigir).
- A comunicacao AT de faturas usa o endpoint de guias do provider mock —
  em producao real exige o webservice de faturas da AT.
- Reconciliacao bin<>nivel e so de leitura (reporta, nao corrige).
- SSO e OIDC authorization-code apenas (sem SAML nem SCIM; JIT cria o user
  com o papel configurado, sem mapeamento de grupos do IdP).
- EDIFACT e o subconjunto ORDERS descrito (sem CONTRL/APERAK, EDIFACT de
  resposta, nem transporte SFTP/AS2/MFT); conectores especificos de ERP
  (Primavera/PHC) continuam fora de ambito.
