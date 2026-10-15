import { expect, test } from "@playwright/test";

const stamp = Date.now();
const EMAIL = `e2e-docs-${stamp}@empresa.pt`;
const PASSWORD = "Password123!";

test("automatização → notificação → documento", async ({ page }) => {
  // Registo + login
  await page.goto("/register");
  await page.getByLabel("Nome da empresa").fill(`E2E Docs ${stamp}`);
  await page.getByLabel("Nome", { exact: true }).fill("Admin Docs");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Palavra-passe", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Painel" })).toBeVisible();

  // 1. Automatizações: 3 regras por omissão + criar "Encomenda confirmada"
  await page.getByRole("link", { name: "Automatizações" }).click();
  await expect(page.getByRole("heading", { name: "Automatizações" })).toBeVisible();
  await expect(page.getByText("Expedição entregue", { exact: true })).toBeVisible();
  await expect(page.getByText("Rota concluída", { exact: true })).toBeVisible();

  await page.getByTestId("automation-new").click();
  await page.locator("#rule-name").fill("Aviso encomenda confirmada");
  await page.getByTestId("automation-trigger").click();
  await page.getByRole("option", { name: "Encomenda confirmada" }).click();
  await page.getByTestId("automation-save").click();
  await expect(page.getByText("Aviso encomenda confirmada")).toBeVisible();

  // 2. Parceiro + encomenda → confirmar dispara notificação
  await page.getByRole("link", { name: "Parceiros" }).click();
  await page.getByRole("button", { name: "Novo parceiro" }).click();
  await page.getByTestId("type-customer").click();
  await page.getByLabel("Nome", { exact: true }).fill("Cliente Docs E2E");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("cell", { name: /CLI-\d+/ })).toBeVisible();

  await page.getByRole("link", { name: "Encomendas" }).click();
  await page.getByRole("link", { name: "Nova encomenda" }).click();
  await page.getByTestId("order-customer").click();
  await page.getByRole("option", { name: /Cliente Docs E2E/ }).click();
  await page.getByTestId("order-line-0").getByLabel("Descrição").fill("Paletes");
  await page.getByRole("button", { name: "Criar", exact: true }).click();
  await expect(page.getByRole("heading", { name: /ENC-\d+/ })).toBeVisible();
  await page.getByRole("button", { name: "Confirmar encomenda" }).click();
  await expect(page.getByText("Confirmada").first()).toBeVisible();

  // 3. Upload de documento na encomenda
  await page.getByTestId("doc-file-input").setInputFiles({
    name: "nota-encomenda.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("documento e2e"),
  });
  await expect(page.getByText("nota-encomenda.txt")).toBeVisible();

  // 4. Página global de documentos mostra o ficheiro
  await page.getByRole("link", { name: "Documentos" }).click();
  await expect(page.getByRole("heading", { name: "Documentos" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "nota-encomenda.txt" })).toBeVisible();

  // 5. Notificação gerada pela automatização
  await page.getByRole("button", { name: "Notificações" }).click();
  await expect(page.getByText(/Encomenda ENC-\d+ confirmada/)).toBeVisible();

  // 6. Marcar todas como lidas limpa o badge
  await page.getByRole("button", { name: "Marcar todas" }).click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Notificações" }).locator("span"),
  ).toBeHidden();
});
