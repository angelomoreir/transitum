import { expect, test } from "@playwright/test";

const stamp = Date.now();
const EMAIL = `e2e-ops-${stamp}@empresa.pt`;
const PASSWORD = "Password123!";

test("parceiro → encomenda → expedição → estados e timeline", async ({ page }) => {
  // Registo + login
  await page.goto("/register");
  await page.getByLabel("Nome da empresa").fill(`E2E Ops ${stamp}`);
  await page.getByLabel("Nome", { exact: true }).fill("Admin Ops");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Palavra-passe", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Painel" })).toBeVisible();

  // 1. Criar cliente
  await page.getByRole("link", { name: "Parceiros" }).click();
  await expect(page.getByRole("heading", { name: "Parceiros" })).toBeVisible();
  await page.getByRole("button", { name: "Novo parceiro" }).click();
  await page.getByTestId("type-customer").click();
  await page.getByLabel("Nome", { exact: true }).fill("Cliente E2E");
  await page.getByLabel("Cidade").fill("Porto");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText(/CLI-\d+/)).toBeVisible();

  // 2. Criar transportadora
  await page.getByRole("button", { name: "Novo parceiro" }).click();
  await page.getByTestId("type-carrier").click();
  await page.getByLabel("Nome", { exact: true }).fill("Transportadora E2E");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText(/TRA-\d+/)).toBeVisible();

  // 3. Nova encomenda
  await page.getByRole("link", { name: "Encomendas", exact: true }).click();
  await page.getByRole("link", { name: "Nova encomenda" }).click();
  await page.getByTestId("order-customer").click();
  await page.getByRole("option", { name: /Cliente E2E/ }).click();
  await page.getByLabel("Descrição").fill("Paletes E2E");
  await page.getByRole("button", { name: "Criar", exact: true }).click();
  await expect(page.getByRole("heading", { name: /ENC-\d+/ })).toBeVisible();

  // 4. Confirmar encomenda → criar expedição
  await page.getByRole("button", { name: "Confirmar encomenda" }).click();
  await page.getByRole("link", { name: "Criar expedição" }).click();

  await page.getByTestId("shipment-carrier").click();
  await page.getByRole("option", { name: /Transportadora E2E/ }).click();
  await page.getByLabel("Morada").first().fill("Doca 1");
  await page.locator("#pickup-city").fill("Porto");
  await page.locator("#pickup-postal").fill("4000-001");
  await page.locator("#delivery-line1").fill("Av. Cliente 10");
  await page.locator("#delivery-city").fill("Lisboa");
  await page.locator("#delivery-postal").fill("1000-001");
  await page.getByRole("button", { name: "Criar", exact: true }).click();
  await expect(page.getByRole("heading", { name: /EXP-\d+/ })).toBeVisible();

  // 5. Transições de estado + timeline
  await page.getByTestId("transition-planned").click();
  await page.getByTestId("transition-in_transit").click();
  await page.locator("#shipment-note").fill("Carga conferida na doca");
  await page.getByRole("button", { name: "Adicionar nota" }).click();
  await expect(page.getByText("Carga conferida na doca")).toBeVisible();
  await page.getByTestId("transition-delivered").click();
  await expect(page.getByText("Entregue", { exact: true }).first()).toBeVisible();
});
