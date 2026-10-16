import { expect, test } from "@playwright/test";

const stamp = Date.now();
const EMAIL = `e2e-transport-${stamp}@empresa.pt`;
const PASSWORD = "Password123!";

// Teste longo (fluxo completo com API real + PGlite) — margem extra
test.setTimeout(120_000);

test("tarifa → expedição planeada → rota com paragem → checkpoint + custo", async ({
  page,
}) => {
  // Registo + login
  await page.goto("/register");
  await page.getByLabel("Nome da empresa").fill(`E2E Transport ${stamp}`);
  await page.getByLabel("Nome", { exact: true }).fill("Admin Transport");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Palavra-passe", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Painel" })).toBeVisible();

  // 1. Cliente + transportadora
  await page.getByRole("link", { name: "Parceiros" }).click();
  await page.getByRole("button", { name: "Novo parceiro" }).click();
  await page.getByTestId("type-customer").click();
  await page.getByLabel("Nome", { exact: true }).fill("Cliente Transp E2E");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText(/CLI-\d+/)).toBeVisible();

  await page.getByRole("button", { name: "Novo parceiro" }).click();
  await page.getByTestId("type-carrier").click();
  await page.getByLabel("Nome", { exact: true }).fill("Transp Transp E2E");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText(/TRA-\d+/)).toBeVisible();

  // 2. Tarifa da transportadora
  await page.getByRole("link", { name: "Tarifas" }).click();
  await expect(page.getByRole("heading", { name: "Tarifas" })).toBeVisible();
  await page.getByRole("button", { name: "Nova tarifa" }).click();
  await page.getByTestId("rate-carrier").click();
  await page.getByRole("option", { name: /Transp Transp E2E/ }).click();
  await page.locator("#rate-name").fill("Tarifa base nacional");
  await page.locator("#rate-price").fill("250");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Tarifa base nacional")).toBeVisible();

  // 3. Encomenda → expedição → planned
  await page.getByRole("link", { name: "Encomendas", exact: true }).click();
  await page.getByRole("link", { name: "Nova encomenda" }).click();
  await page.getByTestId("order-customer").click();
  await page.getByRole("option", { name: /Cliente Transp E2E/ }).click();
  await page.getByLabel("Descrição").fill("Contentor E2E");
  await page.getByRole("button", { name: "Criar", exact: true }).click();
  await page.getByRole("button", { name: "Confirmar encomenda" }).click();
  await page.getByRole("link", { name: "Criar expedição" }).click();
  await page.getByTestId("shipment-carrier").click();
  await page.getByRole("option", { name: /Transp Transp E2E/ }).click();
  await page.getByLabel("Morada").first().fill("Armazém 5");
  await page.locator("#pickup-city").fill("Porto");
  await page.locator("#pickup-postal").fill("4000-001");
  await page.locator("#delivery-line1").fill("Rua Destino 20");
  await page.locator("#delivery-city").fill("Lisboa");
  await page.locator("#delivery-postal").fill("1000-001");
  await page.getByRole("button", { name: "Criar", exact: true }).click();
  await expect(page.getByRole("heading", { name: /EXP-\d+/ })).toBeVisible();
  await page.getByTestId("transition-planned").click();
  await expect(page.getByText("Planeada").first()).toBeVisible();

  // 4. Nova rota com paragem de entrega ligada à expedição
  await page.getByRole("link", { name: "Rotas" }).click();
  await expect(page.getByRole("heading", { name: "Rotas" })).toBeVisible();
  await page.getByRole("link", { name: "Nova rota" }).click();
  await page.locator("#r-name").fill("Rota Sul E2E");
  await page.getByTestId("route-carrier").click();
  await page.getByRole("option", { name: /Transp Transp E2E/ }).click();
  await page.locator("#r-driver").fill("Carlos E2E");
  await page.getByRole("button", { name: "Adicionar paragem" }).click();
  const stop = page.getByTestId("stop-0");
  await stop.locator("button[role='combobox']").nth(1).click();
  await page.getByRole("option", { name: /EXP-\d+/ }).click();
  await stop.getByPlaceholder("Morada").fill("Terminal Lisboa");
  await stop.getByPlaceholder("Cidade").fill("Lisboa");
  await stop.getByPlaceholder("Código postal").fill("1900-001");
  await page.getByRole("button", { name: "Criar", exact: true }).click();
  await expect(page.getByRole("heading", { name: /ROT-\d+/ })).toBeVisible();
  await expect(page.getByTestId("stop-item-1")).toBeVisible();

  // 5. Despachar → paragem no local → concluída (gera checkpoint na expedição)
  await page.getByTestId("route-dispatched").click();
  await expect(page.getByText("Despachada").first()).toBeVisible();
  await page.getByTestId("stop-1-arrived").click();
  await page.getByTestId("stop-1-done").click();
  await expect(
    page.getByTestId("stop-item-1").getByText("Concluída", { exact: true }),
  ).toBeVisible();

  // 6. Verificar checkpoint + adicionar custo na expedição
  await page.getByTestId("stop-item-1").getByRole("link", { name: /EXP-\d+/ }).click();
  await expect(page.getByRole("heading", { name: /EXP-\d+/ })).toBeVisible();
  await expect(page.getByText(/concluída \(rota ROT-\d+\)/)).toBeVisible();
  await expect(page.getByText("Lisboa, PT", { exact: true })).toBeVisible();

  await page.getByLabel("Descrição").fill("Frete rota sul");
  await page.getByLabel("Valor").fill("250");
  await page.getByRole("button", { name: "Adicionar custo" }).click();
  await expect(page.getByText("Frete rota sul")).toBeVisible();
  await expect(page.getByText(/Custo total:.*250/)).toBeVisible();
});
