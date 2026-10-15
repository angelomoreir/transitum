import { expect, test } from "@playwright/test";

const stamp = Date.now();
const EMAIL = `e2e-${stamp}@empresa.pt`;
const PASSWORD = "Password123!";

test("registar empresa → painel → convidar utilizador", async ({ page }) => {
  // Registo
  await page.goto("/register");
  await page.getByLabel("Nome da empresa").fill(`E2E Logística ${stamp}`);
  await page.getByLabel("Nome", { exact: true }).fill("Admin E2E");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Palavra-passe", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Criar conta" }).click();

  // Painel com dados reais
  await expect(page.getByRole("heading", { name: "Painel" })).toBeVisible();
  await expect(page.getByText("Utilizadores ativos")).toBeVisible();

  // Utilizadores
  await page.getByRole("link", { name: "Utilizadores" }).click();
  await expect(page.getByRole("heading", { name: "Utilizadores" })).toBeVisible();
  await expect(page.getByRole("cell", { name: EMAIL })).toBeVisible();

  // Convidar operador
  await page.getByRole("button", { name: "Convidar utilizador" }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Operador E2E");
  await page.getByLabel("Email").fill(`op-${stamp}@empresa.pt`);
  await page.locator("form").getByRole("button", { name: "Convidar utilizador" }).click();
  await expect(page.locator("#invite-url")).toHaveValue(/accept-invite\?token=/);
  await page.keyboard.press("Escape");

  // Logout e login de novo
  await page.locator("header").getByRole("button").last().click();
  await page.getByRole("menuitem", { name: "Terminar sessão" }).click();
  await expect(page.getByRole("heading", { name: "Iniciar sessão" })).toBeVisible();
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Palavra-passe", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Iniciar sessão" }).click();
  await expect(page.getByRole("heading", { name: "Painel" })).toBeVisible();
});
