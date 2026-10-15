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

## Próximas fases (aguarda autorização)

- Fase 3: gestão de transportes, rotas, custos e acompanhamento.
