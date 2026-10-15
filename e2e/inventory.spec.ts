import { expect, test } from "@playwright/test";

const stamp = Date.now();
const EMAIL = `e2e-inv-${stamp}@empresa.pt`;
const PASSWORD = "Password123!";

test("armazém → artigo → compra → receção → nível de stock", async ({ page }) => {
  // Registo + login
  await page.goto("/register");
  await page.getByLabel("Nome da empresa").fill(`E2E Inv ${stamp}`);
  await page.getByLabel("Nome", { exact: true }).fill("Admin Inv");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Palavra-passe", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Painel" })).toBeVisible();

  // 1. Fornecedor
  await page.getByRole("link", { name: "Parceiros" }).click();
  await page.getByRole("button", { name: "Novo parceiro" }).click();
  await page.getByTestId("type-supplier").click();
  await page.getByLabel("Nome", { exact: true }).fill("Fornecedor Inv E2E");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText(/FOR-\d+/)).toBeVisible();

  // 2. Armazém
  await page.getByRole("link", { name: "Armazéns" }).click();
  await expect(page.getByRole("heading", { name: "Armazéns" })).toBeVisible();
  await page.getByRole("button", { name: "Novo armazém" }).click();
  await page.locator("#wh-name").fill("Armazém Central E2E");
  await page.locator("#wh-line1").fill("Zona Industrial 1");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("cell", { name: /ARM-\d+/ })).toBeVisible();

  // 3. Artigo
  await page.getByRole("link", { name: "Inventário" }).click();
  await page.getByRole("button", { name: "Novo artigo" }).click();
  await page.locator("#it-sku").fill("SKU-E2E");
  await page.locator("#it-name").fill("Caixa E2E");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByTestId("item-SKU-E2E")).toBeVisible();

  // 4. Compra ao fornecedor com destino ao armazém
  await page.getByRole("link", { name: "Compras" }).click();
  await expect(page.getByRole("heading", { name: "Compras" })).toBeVisible();
  await page.getByRole("link", { name: "Nova compra" }).click();
  await page.getByTestId("po-supplier").click();
  await page.getByRole("option", { name: /Fornecedor Inv E2E/ }).click();
  await page.getByTestId("po-warehouse").click();
  await page.getByRole("option", { name: /Armazém Central E2E/ }).click();
  const line = page.getByTestId("po-line-0");
  await line.locator("button[role='combobox']").click();
  await page.getByRole("option", { name: /SKU-E2E/ }).click();
  await line.getByLabel("Qtd.").fill("50");
  await page.getByRole("button", { name: "Criar", exact: true }).click();
  await expect(page.getByRole("heading", { name: /PC-\d+/ })).toBeVisible();

  // 5. Enviar ao fornecedor → receção total → estado "Recebida"
  await page.getByTestId("po-sent").click();
  await expect(page.getByText("Enviada").first()).toBeVisible();
  await page.getByTestId("po-receive").click();
  await page.getByTestId("po-receive-confirm").click();
  await expect(page.getByText("Recebida").first()).toBeVisible();

  // 6. Verificar nível de stock
  await page.getByRole("link", { name: "Inventário" }).click();
  await page.getByTestId("tab-stock").click();
  await expect(page.getByTestId(/onhand-ARM-\d+-SKU-E2E/)).toHaveText(/50 un/);

  // 7. Movimento de entrada automático da receção visível
  await page.getByTestId("tab-movements").click();
  await expect(page.getByRole("cell", { name: /PC-\d+/ }).first()).toBeVisible();
});
