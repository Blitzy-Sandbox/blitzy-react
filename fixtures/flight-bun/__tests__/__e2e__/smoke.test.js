import {test, expect} from '@playwright/test';

test('smoke test', async ({page}) => {
  const consoleErrors = [];
  page.on('console', msg => {
    const type = msg.type();
    if (type === 'warn' || type === 'error') {
      consoleErrors.push({type: type, text: msg.text()});
    }
  });
  const pageErrors = [];
  page.on('pageerror', error => {
    pageErrors.push(error.stack);
  });

  // Initial server render verification
  await page.goto('/');
  await expect(page.getByTestId('layout-header')).toBeVisible();
  await expect(page.getByTestId('layout-content')).toBeVisible();

  // Client hydration validation
  await expect(page.getByTestId('counter-value')).toBeVisible();
  await expect(page.getByTestId('form-name-input')).toBeVisible();
  await expect(page.getByTestId('navigation')).toBeVisible();

  // Counter component interactivity
  await expect(page.getByTestId('counter-value')).toHaveText('0');
  await page.getByRole('button', {name: '+'}).click();
  await expect(page.getByTestId('counter-value')).toHaveText('1');
  await page.getByRole('button', {name: '+'}).click();
  await expect(page.getByTestId('counter-value')).toHaveText('2');
  await page.getByRole('button', {name: '-'}).click();
  await expect(page.getByTestId('counter-value')).toHaveText('1');

  // Error check after initial interactions
  await expect(consoleErrors).toEqual([]);
  await expect(pageErrors).toEqual([]);

  // Form Server Action submission
  await page.getByTestId('form-name-input').fill('Bun');
  await page.getByTestId('form-submit').click();
  await expect(page.getByTestId('form-result')).toBeVisible();
  await expect(page.getByTestId('form-result')).toHaveText('Hello, Bun!');

  // Suspense streaming resolution
  await expect(page.getByText('Loaded!')).toBeVisible();

  // Final error check
  await expect(consoleErrors).toEqual([]);
  await expect(pageErrors).toEqual([]);
});
