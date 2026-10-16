# Segurança

Postura de segurança da plataforma e controlos implementados.

## Autenticação

- **Access token**: JWT de curta duração (15 min, `JWT_SECRET` obrigatório em
  produção, min. 16 caracteres — usar 32+).
- **Refresh token**: opaco, cookie `blujay_rt` httpOnly `SameSite=Lax`
  `path=/api/auth`, TTL 30 dias; rotação em cada refresh com `replacedById`;
  deteção de reutilização revoga **todas** as sessões do utilizador.
- **Passwords**: scrypt (`node:crypto`) com salt aleatório + `timingSafeEqual`;
  política mínima aplicada por schema Zod. Reset com token sha256 de uso único
  e expiração; reset/alteração de password revoga sessões.
- **Rate limiting**: auth (10/min), API pública v1 (120/min por chave/IP).
- **Chaves de API**: formato `bjk_<prefixo>_<segredo>`, persistidas como hash
  sha256 (segredo visível uma vez), revogáveis, `expiresAt` opcional,
  `lastUsedAt` registado.

## Multi-tenancy

- Todas as entidades operacionais têm `tenantId`; queries filtram sempre
  `tenantId = req.user.tid` (do JWT). Isolamento validado por testes
  (`test/tenancy.test.ts`, `test/billing.test.ts`).
- **RLS (recomendado em produção)**: ver políticas de exemplo em
  `docs/PRODUCTION.md`. Não aplicável a PGlite (dev/testes).
- **Suspensão de tenant** (`tenants.suspendedAt`): escritas bloqueadas com 403
  em `requirePermission`; leitura mantida. JWTs já emitidos expiram em ≤15 min.

## Autorização

- RBAC 4 funções (admin/manager/operator/viewer) + permissões por módulo,
  enforced no backend via `requirePermission` (nunca só no frontend).
- `/api/admin/*` exige registo em `platform_admins` (bootstrap por
  `PLATFORM_ADMIN_EMAILS`, sincronizado em cada login — a env é a fonte de
  verdade).
- Limites de plano enforced: `maxUsers` (convites) e `maxApiKeys` (chaves).

## Ataques comuns

- **XSS**: React escapa por omissão; CSP via helmet em produção.
- **CSRF**: cookies SameSite=Lax; API autenticada por Bearer (sem CSRF em
  pedidos JSON); refresh cookie confinado a `/api/auth`.
- **SQL injection**: todas as queries via Drizzle ORM parametrizadas.
- **Path traversal em storage**: chaves validadas por `path.resolve` +
  prefixo do root no driver local; chaves geradas pelo servidor
  (`<tenantId>/<docId>`), nunca pelo cliente.
- **Uploads**: limite de 5 MB (base64 JSON, `bodyLimit` dedicado), tipos por
  whitelist de extensão não confiável — *scanning antivírus fica como
  recomendação de produção*.
- **SSRF em webhooks**: URLs fornecidas pelo tenant; mitigação parcial —
  timeout 5s. *Recomendação: bloquear IP ranges privados no gateway de saída
  em produção.*
- **JWT**: segredo obrigatório em produção (`env.ts` falha sem ele);
  algoritmo fixo do @fastify/jwt (HS256); `fast-jwt` atualizado para linha
  corrigida.

## Auditoria e dados

- `audit_events` para ações sensíveis (auth, utilizadores, estados, billing,
  admin) com ator, IP e metadata.
- Segredos: `webhookSecret` por regra (HMAC `x-blujay-signature`), nunca
  devolvido nas listagens; hash de refresh tokens; zero segredos no repo —
  `.env` real fica fora do git (`.env.example` apenas).
- RGPD: dados mínimos; direito de apagamento/exportação por tenant fica como
  trabalho futuro (requer procedimento operacional).

## Dependências (npm audit)

- Produção: limpa na última revisão (Fase 8).
- Dev-only remanescentes: `vitest`/`tinypool`/`@vitest/mocker` (correção exige
  vitest 4/5 — bloqueado por bug de resolução de peer deps do npm 11),
  `esbuild` transitivo de `drizzle-kit` (dev server apenas). Nenhuma afeta o
  bundle de produção.

## Recomendações pendentes para produção

1. Ativar RLS no Postgres (ver `docs/PRODUCTION.md`).
2. SMTP real com DKIM/SPF (atualmente `ConsoleMailer`).
3. Scanning antivírus de uploads (ex.: ClamAV) + tipos MIME verificados por
   magic bytes.
4. Bloqueio SSRF de webhooks a IPs privados.
5. WAF/reverse proxy com rate limiting global por IP.
6. Rotação de `JWT_SECRET` com grace period (dual-sign).
