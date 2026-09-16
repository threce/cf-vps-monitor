import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateRestockMonitorInput,
  shouldNotifyRestock,
  shouldNotifyOutOfStock,
} from './restock-monitor.ts';

test('validateRestockMonitorInput validates name and URL', () => {
  const valid = validateRestockMonitorInput({
    name: 'RackNerd 2024 Black Friday 1C1G',
    url: 'https://my.racknerd.com/cart.php?a=add&pid=123',
    tags: ['RackNerd', '美国西海岸', '黑五特价'],
    check_mode: 'keyword',
    stock_keywords: ['Add to Cart', 'In Stock'],
    out_of_stock_keywords: ['Out of Stock'],
  });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.value.name, 'RackNerd 2024 Black Friday 1C1G');
    assert.equal(valid.value.url, 'https://my.racknerd.com/cart.php?a=add&pid=123');
    assert.deepEqual(valid.value.tags, ['RackNerd', '美国西海岸', '黑五特价']);
    assert.equal(valid.value.check_mode, 'keyword');
    assert.deepEqual(valid.value.stock_keywords, ['Add to Cart', 'In Stock']);
    assert.deepEqual(valid.value.out_of_stock_keywords, ['Out of Stock']);
    assert.equal(valid.value.interval_sec, 120);
    assert.equal(valid.value.timeout_sec, 15);
    assert.equal(valid.value.notify_on_restock, true);
  }

  // Missing / empty name
  assert.equal(validateRestockMonitorInput({ name: '', url: 'https://example.com', stock_keywords: ['In Stock'] }).ok, false);

  // Invalid URL
  assert.equal(validateRestockMonitorInput({ name: 'Test', url: 'not-a-url', stock_keywords: ['In Stock'] }).ok, false);

  // Keyword mode without keywords
  assert.equal(validateRestockMonitorInput({ name: 'Test', url: 'https://example.com', check_mode: 'keyword', stock_keywords: [], out_of_stock_keywords: [] }).ok, false);

  // Regex mode without pattern
  assert.equal(validateRestockMonitorInput({ name: 'Test', url: 'https://example.com', check_mode: 'regex', stock_pattern: '' }).ok, false);

  // Regex mode with invalid pattern
  assert.equal(validateRestockMonitorInput({ name: 'Test', url: 'https://example.com', check_mode: 'regex', stock_pattern: '[unclosed' }).ok, false);
});

test('shouldNotifyRestock avoids repeated notifications and triggers on state transitions', () => {
  // Previously out of stock, now in stock -> notify
  assert.equal(
    shouldNotifyRestock('out_of_stock', 'in_stock', true, null, '2026-09-15T12:00:00.000Z'),
    true,
  );

  // Previously unknown, now in stock -> notify
  assert.equal(
    shouldNotifyRestock('unknown', 'in_stock', true, null, '2026-09-15T12:00:00.000Z'),
    true,
  );

  // Previously error, now in stock -> notify
  assert.equal(
    shouldNotifyRestock('error', 'in_stock', true, null, '2026-09-15T12:00:00.000Z'),
    true,
  );

  // Already in stock, still in stock -> DO NOT notify
  assert.equal(
    shouldNotifyRestock('in_stock', 'in_stock', true, '2026-09-15T12:00:00.000Z', '2026-09-15T12:00:00.000Z'),
    false,
  );

  // Notification disabled -> DO NOT notify
  assert.equal(
    shouldNotifyRestock('out_of_stock', 'in_stock', false, null, '2026-09-15T12:00:00.000Z'),
    false,
  );

  // Already notified for current state change -> DO NOT notify
  assert.equal(
    shouldNotifyRestock('out_of_stock', 'in_stock', true, '2026-09-15T12:05:00.000Z', '2026-09-15T12:00:00.000Z'),
    false,
  );
});

test('shouldNotifyOutOfStock triggers when in_stock changes to out_of_stock', () => {
  // In stock -> out of stock, notify enabled -> notify
  assert.equal(
    shouldNotifyOutOfStock('in_stock', 'out_of_stock', true),
    true,
  );

  // Notify disabled -> false
  assert.equal(
    shouldNotifyOutOfStock('in_stock', 'out_of_stock', false),
    false,
  );

  // Out of stock -> out of stock -> false
  assert.equal(
    shouldNotifyOutOfStock('out_of_stock', 'out_of_stock', true),
    false,
  );
});
