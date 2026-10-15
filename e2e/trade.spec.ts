import { expect, test } from "@playwright/test";

const stamp = Date.now();
const EMAIL = `e2e-trade-${stamp}@empresa.pt`;
const PASSWORD = "Password123!";

test("alfândega na expedição + chave de API", async ({ page }) => {
  // Registo + login
  await page.goto("/register");
  await page.getByLabel("Nome da empresa").fill(`E2E Trade ${stamp}`);
  await page.getByLabel("Nome", { exact: true }).fill("Admin Trade");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Palavra-passe", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Painel" })).toBeVisible();

  // 1. Cliente
  await page.getByRole("link", { name: "Parceiros" }).click();
  await page.getByRole("button", { name: "Novo parceiro" }).click();
  await page.getByTestId("type-customer").click();
  await page.getByLabel("Nome", { exact: true }).fill("Cliente Trade E2E");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("cell", { name: /CLI-\d+/ })).toBeVisible();

  // 2. Expedição
  await page.getByRole("link", { name: "Expedições" }).click();
  await page.getByRole("link", { name: "Nova expedição" }).click();
  await page.getByTestId("shipment-customer").click();
  await page.getByRole("option", { name: /Cliente Trade E2E/ }).click();
  await page.locator("#pickup-line1").fill("Rua Origem 1");
  await page.locator("#pickup-city").fill("Porto");
  await page.locator("#pickup-postal").fill("4000-001");
  await page.locator("#pickup-country").fill("PT");
  await page.locator("#delivery-line1").fill("Rue Destin 2");
  await page.locator("#delivery-city").fill("Lyon");
  await page.locator("#delivery-postal").fill("69000");
  await page.locator("#delivery-country").fill("FR");
  await page.getByRole("button", { name: "Criar", exact: true }).click();
  await expect(page.getByRole("heading", { name: /EXP-\d+/ })).toBeVisible();

  // 3. Alfândega: incoterm + artigo + transição para "prepared"
  await page.getByTestId("customs-incoterm").click();
  await page.getByRole("option", { name: "DAP" }).click();
  await expect(page.getByTestId("customs-incoterm")).toContainText("DAP");

  await page.getByTestId("customs-add").click();
  const row = page.getByTestId("customs-new-row");
  await row.getByLabel("Descrição").fill("Componentes E2E");
  await row.getByLabel("HS Code").fill("854239");
  await row.getByLabel("País origem").fill("PT");
  await row.getByLabel("Qtd.").fill("10");
  await row.getByLabel("Valor").fill("1200");
  await page.getByTestId("customs-save-item").click();
  await expect(page.getByRole("cell", { name: "Componentes E2E" })).toBeVisible();

  await page.getByTestId("customs-prepared").click();
  await expect(page.getByTestId("customs-status")).toHaveText("Documentação preparada");
  // evento aduaneiro na timeline
  await expect(page.getByText("Alfândega: Documentação preparada")).toBeVisible();

  // 4. Integrações: criar chave de API, segredo mostrado uma vez
  await page.getByRole("link", { name: "Integrações" }).click();
  await expect(page.getByRole("heading", { name: "Integrações" })).toBeVisible();
  await page.getByTestId("key-new").click();
  await page.locator("#key-name").fill("ERP E2E");
  await page.getByTestId("key-save").click();
  const secret = await page.getByTestId("key-secret").inputValue();
  expect(secret).toMatch(/^bjk_[0-9a-f]{8}_[0-9a-f]{48}$/);
  await page.getByTestId("key-done").click();
  await expect(page.getByRole("cell", { name: "ERP E2E" })).toBeVisible();

  // 5. A chave autentica na API pública v1 (fetch dentro da página)
  const orders = await page.evaluate(async (k) => {
    const res = await fetch("/api/v1/shipments", { headers: { "x-api-key": k } });
    return { status: res.status, body: await res.json() };
  }, secret);
  expect(orders.status).toBe(200);
  expect(orders.body.items[0].number).toMatch(/^EXP-\d+$/);
});
