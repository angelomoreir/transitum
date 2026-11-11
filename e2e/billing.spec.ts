import { expect, test } from "@playwright/test";

const stamp = Date.now();
const EMAIL = `e2e-billing-${stamp}@empresa.pt`;
const TENANT = `E2E Billing ${stamp}`;
const PASSWORD = "Password123!";

test.describe.configure({ mode: "serial" });

test("faturação: trial → fatura → pagamento → mudança de plano", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Nome da empresa").fill(TENANT);
  await page.getByLabel("Nome", { exact: true }).fill("Admin Billing");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Palavra-passe", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Painel" })).toBeVisible();

  // Página de faturação: plano Starter em trial
  await page.getByRole("link", { name: "Faturação" }).click();
  await expect(page.getByRole("heading", { name: "Faturação" })).toBeVisible();
  await expect(page.getByText("Starter")).toBeVisible();
  await expect(page.getByText("Período experimental")).toBeVisible();
  await expect(page.getByText(/Trial termina em/)).toBeVisible();
  await expect(page.getByText("1 / 5")).toBeVisible();

  // Emitir fatura → INV-xxxxx em aberto
  await page.getByRole("button", { name: "Emitir fatura" }).click();
  await expect(page.getByRole("cell", { name: /INV-\d{5}/ })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Em aberto" })).toBeVisible();

  // Pagar fatura → subscrição ativa
  await page.getByRole("button", { name: "Marcar paga" }).click();
  await expect(page.getByRole("cell", { name: "Paga" })).toBeVisible();
  await expect(page.getByText("Ativa", { exact: true })).toBeVisible();

  // Mudar de plano para Pro
  await page.getByRole("button", { name: "Mudar de plano" }).click();
  const proRow = page.locator("div.rounded-md.border", { hasText: "Pro —" });
  await proRow.getByRole("button", { name: "Selecionar" }).click();
  await expect(page.getByText("Pro", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("1 / 25")).toBeVisible();
});

test("administração da plataforma: suspender e reativar tenant", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Nome da empresa").fill(`E2E Admin ${stamp}`);
  await page.getByLabel("Nome", { exact: true }).fill("Super Admin");
  await page.getByLabel("Email").fill("e2e-admin@transitum.dev");
  await page.getByLabel("Palavra-passe", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Painel" })).toBeVisible();

  // Entrada de admin na sidebar (platform admin via PLATFORM_ADMIN_EMAILS)
  await page.getByRole("link", { name: "Administração" }).click();
  await expect(page.getByRole("heading", { name: "Administração da plataforma" })).toBeVisible();

  // O tenant do teste anterior aparece na lista (primeira tabela = tenants)
  const row = page
    .locator("table")
    .first()
    .getByRole("row", { name: new RegExp(TENANT) });
  await expect(row).toBeVisible();
  // ficou "Ativa" porque o teste anterior pagou uma fatura
  await expect(row.getByText("Ativa")).toBeVisible();

  // Suspender → badge; a fatura do teste anterior aparece na lista global
  await row.getByRole("button", { name: "Suspender" }).click();
  await expect(row.getByText("Suspenso")).toBeVisible();
  await expect(page.getByRole("cell", { name: /INV-\d{5}/ }).first()).toBeVisible();

  // Reativar
  await row.getByRole("button", { name: "Reativar" }).click();
  await expect(row.getByText("Suspenso")).not.toBeVisible();
});
