# Blujay

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
| `npm run typecheck -w @blujay/api` | typecheck da API |

## Funcionalidades

- **Fase 1**: autenticação completa, multi-tenancy, RBAC, utilizadores,
  dashboard, pesquisa global, notificações.
- **Fase 2**: parceiros (clientes/fornecedores/transportadoras com códigos
  `CLI-/FOR-/TRA-`), encomendas com linhas (`ENC-`), expedições com ciclo de
  estados e timeline (`EXP-`).

## Autenticação

- JWT de acesso curto (15min) + refresh token opaco em cookie httpOnly com rotação
  e deteção de reutilização (revoga todas as sessões).
- Passwords com scrypt (node:crypto), tokens de convite/reset com hash sha256.
- Registo cria tenant + admin; login por email (globalmente único).
- Ver `docs/ARCHITECTURE.md` para detalhes.
