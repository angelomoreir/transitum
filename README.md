# Transitum

Plataforma SaaS de gestão de logística e supply chain. Monorepo npm workspaces.

## Estrutura

```
apps/api        — API REST (Fastify + TypeScript + Drizzle + PostgreSQL)
apps/web        — Frontend (React 19 + Vite + Tailwind v4 + estilo shadcn/ui)
packages/shared — Schemas Zod, roles/permissões e DTOs partilhados
e2e/            — Testes end-to-end (Playwright)
docs/           — Documentação técnica e registo de progresso
```

## Arranque rápido (sem Docker/Postgres)

Requisitos: Node >= 20.19.

```powershell
npm install
npm run dev
```

- Frontend: http://localhost:5173
- API: http://localhost:3001 — OpenAPI em http://localhost:3001/docs

Sem `DATABASE_URL`, a API usa **PGlite** (PostgreSQL real compilado para WASM),
persistindo em `apps/api/.data/pglite`. Em produção defina `DATABASE_URL` para um
Postgres normal — o mesmo schema e migrações aplicam-se.

## Publicar como demonstração

```powershell
# API: modo demo protege as contas *@transitum.local (sem mudança de password,
# MFA nem suspensão — visitantes não conseguem trancar a demo)
DEMO_MODE=true

# Web: a caixa de credenciais demo no login só aparece com VITE_DEMO=1 no build
docker build -f apps/web/Dockerfile --build-arg VITE_DEMO=1 -t transitum-web .
# (no compose: VITE_DEMO=1 docker compose up -d --build)

# Repovoar/reset dos dados demo (agendar periodicamente, ex.: cron diário)
SEED_DEMO=1 SEED_RESET=1 npm run db:seed -w @transitum/api
```

## Base de dados

```powershell
npm run db:generate   # gerar migrações SQL a partir do schema Drizzle
npm run db:seed       # dados de demonstração (SEED_DEMO=1 necessário)
```

As migrações correm automaticamente ao arrancar a API.

Para Postgres real: `docker compose up -d postgres` e definir `DATABASE_URL` em
`apps/api/.env` (ver `.env.example`).

## Testes

```powershell
npm test              # Vitest (API + Web)
npm run test:e2e      # Playwright (arranca API+web automaticamente)
```

## Comandos úteis

| Comando | Descrição |
|---|---|
| `npm run dev` | API + web em paralelo |
| `npm run dev:api` / `dev:web` | serviços isolados |
| `npm run build` | build de produção |
| `npm run typecheck -w @transitum/api` | typecheck da API |

## Funcionalidades

- **Fase 1**: autenticação completa, multi-tenancy, RBAC, utilizadores,
  dashboard, pesquisa global, notificações.
- **Fase 2**: parceiros (clientes/fornecedores/transportadoras com códigos
  `CLI-/FOR-/TRA-`), encomendas com linhas (`ENC-`), expedições com ciclo de
  estados e timeline (`EXP-`).
- **Fase 3**: rotas com paragens ordenadas (`ROT-`), checkpoints automáticos
  na timeline das expedições, tarifas por transportadora e custos de
  expedição.
- **Fase 4**: armazéns (`ARM-`), catálogo de artigos (SKU), níveis de stock
  por armazém, movimentos (entrada/saída/ajuste/transferência) e compras a
  fornecedores (`PC-`) com receção que alimenta o stock.
- **Fase 5**: documentos ligados a entidades (upload/download via storage
  local, preparado para S3), notificações persistidas por utilizador com
  estado de leitura, e regras de automatização que notificam o tenant em
  eventos operacionais (expedição entregue, encomenda confirmada, rota
  concluída, receção de compra, documento carregado).
- **Fase 6**: comércio internacional — Incoterms, estado aduaneiro e artigos
  para despacho nas expedições, fatura comercial em CSV; integrações — chaves
  de API (`x-api-key`) com API pública `/api/v1` documentada no OpenAPI, e
  webhooks assinados (HMAC) como ação das regras de automatização, com log de
  entregas.
- **Fase 7**: subscrições SaaS — planos Starter/Pro/Enterprise com limites
  (`maxUsers`, `maxApiKeys`), trial de 14 dias no registo, faturas `INV-xxxxx`
  com emissão/pagamento manual, enforcement de limites e suspensão de tenants;
  administração da plataforma em `/api/admin` + página `/admin` (bootstrap via
  `PLATFORM_ADMIN_EMAILS`) e página `/billing` na app.
- **Fase 8**: scheduler de subscrições (trial/fatura vencida → `past_due`),
  retries de webhooks com backoff, expiração opcional de chaves API e rate
  limit na `/api/v1`, driver de storage S3/MinIO, Dockerfiles + compose
  completo, documentos de segurança (`docs/SECURITY.md`) e produção
  (`docs/PRODUCTION.md`).

## Autenticação

- JWT de acesso curto (15min) + refresh token opaco em cookie httpOnly com rotação
  e deteção de reutilização (revoga todas as sessões).
- Passwords com scrypt (node:crypto), tokens de convite/reset com hash sha256.
- Registo cria tenant + admin; login por email (globalmente único).
- Ver `docs/ARCHITECTURE.md` para detalhes, `docs/SECURITY.md` para a postura
  de segurança e `docs/PRODUCTION.md` para o guia de deploy.
