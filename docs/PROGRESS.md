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

## Próximas fases (aguarda autorização)

- Fase 6: comércio internacional, integrações e API.
