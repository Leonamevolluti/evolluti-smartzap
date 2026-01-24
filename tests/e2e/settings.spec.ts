import { test, expect } from './fixtures'
import { SettingsPage, LoginPage } from './pages'

/**
 * Testes E2E da página de Configurações
 *
 * A página de Settings tem dois estados principais:
 * 1. Sistema Online (conectado) - mostra status e métricas
 * 2. Desconectado ou Editando - mostra formulário de credenciais
 */
test.describe('Configurações', () => {
  // Antes de cada teste, faz login
  test.beforeEach(async ({ page }) => {
    const loginPage = new LoginPage(page)
    const password = process.env.MASTER_PASSWORD || process.env.TEST_PASSWORD || 'test123'

    await loginPage.goto()
    await loginPage.loginAndWaitForDashboard(password)
  })

  test.describe('Página de Settings', () => {
    test('deve exibir página de configurações corretamente', async ({ page }) => {
      const settingsPage = new SettingsPage(page)

      await settingsPage.goto()

      // Verifica que está na página de settings
      expect(await settingsPage.isVisible()).toBe(true)
    })

    test('deve mostrar título da página', async ({ page }) => {
      const settingsPage = new SettingsPage(page)

      await settingsPage.goto()

      // Verifica título
      await expect(settingsPage.pageTitle).toBeVisible()
    })

    test('deve mostrar status de conexão', async ({ page }) => {
      const settingsPage = new SettingsPage(page)

      await settingsPage.goto()

      // Deve mostrar "Sistema Online" ou "Desconectado"
      const status = await settingsPage.getConnectionStatus()
      expect(['online', 'offline']).toContain(status)
    })
  })

  test.describe('Sistema Conectado', () => {
    test('deve mostrar Sistema Online quando conectado', async ({ page }) => {
      const settingsPage = new SettingsPage(page)

      await settingsPage.goto()

      // Se está conectado, deve mostrar "Sistema Online"
      const isConnected = await settingsPage.isConnected()
      if (isConnected) {
        await expect(page.locator('text=Sistema Online')).toBeVisible()
      }
    })

    test('deve ter botão Editar quando conectado', async ({ page }) => {
      const settingsPage = new SettingsPage(page)

      await settingsPage.goto()

      const isConnected = await settingsPage.isConnected()
      if (isConnected) {
        await expect(settingsPage.editButton).toBeVisible()
      }
    })

    test('deve ter botão Desconectar quando conectado', async ({ page }) => {
      const settingsPage = new SettingsPage(page)

      await settingsPage.goto()

      const isConnected = await settingsPage.isConnected()
      if (isConnected) {
        await expect(settingsPage.disconnectButton).toBeVisible()
      }
    })

    test('deve mostrar informações de limite quando conectado', async ({ page }) => {
      const settingsPage = new SettingsPage(page)

      await settingsPage.goto()

      const isConnected = await settingsPage.isConnected()
      if (isConnected) {
        // Deve mostrar limite de mensagens
        await expect(settingsPage.limitsInfo).toBeVisible()
      }
    })
  })

  test.describe('Edição de Credenciais', () => {
    test('deve abrir formulário ao clicar em Editar', async ({ page }) => {
      const settingsPage = new SettingsPage(page)

      await settingsPage.goto()

      const isConnected = await settingsPage.isConnected()
      if (isConnected) {
        await settingsPage.clickEdit()

        // Formulário deve estar visível
        expect(await settingsPage.isFormVisible()).toBe(true)
      }
    })

    test('deve cancelar edição e voltar ao status', async ({ page }) => {
      const settingsPage = new SettingsPage(page)

      await settingsPage.goto()

      const isConnected = await settingsPage.isConnected()
      if (isConnected) {
        await settingsPage.clickEdit()
        await settingsPage.cancelEdit()

        // Botão Editar deve estar visível novamente
        await expect(settingsPage.editButton).toBeVisible()
      }
    })
  })

  test.describe('Navegação', () => {
    test('deve conseguir navegar para outras páginas', async ({ page }) => {
      const settingsPage = new SettingsPage(page)

      await settingsPage.goto()

      // Navega para home
      await page.goto('/')
      await page.waitForLoadState('domcontentloaded')

      // Não deve mais estar em settings
      expect(await settingsPage.isVisible()).toBe(false)
    })

    test('deve conseguir voltar para settings', async ({ page }) => {
      const settingsPage = new SettingsPage(page)

      await settingsPage.goto()
      await page.goto('/')
      await settingsPage.goto()

      // Deve estar em settings
      expect(await settingsPage.isVisible()).toBe(true)
    })
  })
})
