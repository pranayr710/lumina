import { test, expect } from '@playwright/test';

test.describe('Lumina Frontend', () => {
  test('should load the homepage, click launch, and render ReactFlow canvas', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');

    // Check that the page loaded successfully
    await expect(page).toHaveTitle(/Lumina|Next/i);

    // Click the launch button on the landing page
    await page.locator('text=Launch Orchestrator').click();

    // Give it a moment to render the ReactFlow canvas
    await page.waitForTimeout(2000);

    // Verify that the ReactFlow container exists (the main visual node editor)
    const reactFlowWrapper = page.locator('.react-flow');
    await expect(reactFlowWrapper).toBeVisible({ timeout: 5000 });
  });
});
