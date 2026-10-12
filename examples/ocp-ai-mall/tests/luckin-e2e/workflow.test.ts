import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { FixtureLuckinPort } from '../../packages/luckin-adapter/src/fixture';
import { LuckinWorkflow } from '../../packages/luckin-integration/src/workflow';
import { luckinSelectionId, luckinTermsHash, mergeLuckinSelections, type LuckinScope, type LuckinSelection } from '../../packages/shopping-contracts/src/luckin';

const scope: LuckinScope = { owner_id: 'a', account_id: 'account-a', environment: 'fixture' };
const selection: LuckinSelection = { store_id: 'fixture-east', product_id: 'fixture-latte', sku_id: 'regular', options: { temperature: 'iced', sugar: 'none' }, quantity: 1 };
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'ocp-luckin-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  let clock = Date.now();
  const upstream = new FixtureLuckinPort(join(dir, 'upstream.sqlite'), () => clock);
  let workflow = new LuckinWorkflow(join(dir, 'workflow.sqlite'), upstream, () => clock);
  cleanups.push(() => { workflow.close(); upstream.close(); });
  return { upstream, get workflow() { return workflow; }, advance: (ms: number) => { clock += ms; },
    restart: () => { workflow.close(); workflow = new LuckinWorkflow(join(dir, 'workflow.sqlite'), upstream, () => clock); },
    quote: (selections = [selection], budget = 10_000, owner = scope) => workflow.quote(owner, { store_id: selections[0]!.store_id, selections, budget_minor: budget }),
  };
}
const confirm = (quote: Awaited<ReturnType<LuckinWorkflow['quote']>>) => ({ quote_id: quote.terms.quote_id, terms_hash: quote.terms_hash, confirmed: true });

describe('Luckin versioned selection and confirmation', () => {
  test('same product with different SKU/options/store remains separate', () => {
    const hot = { ...selection, options: { ...selection.options, temperature: 'hot' } };
    const large = { ...selection, sku_id: 'large' };
    const otherStore = { ...selection, store_id: 'fixture-west' };
    expect(mergeLuckinSelections([selection, hot, large, otherStore, selection])).toHaveLength(4);
    expect(mergeLuckinSelections([selection, { ...selection, options: { sugar: 'none', temperature: 'iced' } }])[0]!.quantity).toBe(2);
  });
  test('hash covers store, SKU, options, preview, fees, budget, scope and expiry', async () => {
    const env = setup(); const quote = await env.quote();
    for (const mutate of [
      (terms: typeof quote.terms) => { terms.preview_id += 'new'; },
      (terms: typeof quote.terms) => { terms.budget_minor++; },
      (terms: typeof quote.terms) => { terms.scope.account_id += 'new'; },
      (terms: typeof quote.terms) => { terms.expires_at = new Date(Date.parse(terms.expires_at) + 1000).toISOString(); },
      (terms: typeof quote.terms) => { terms.items[0]!.sku_id = 'large'; terms.items[0]!.line_id = luckinSelectionId(terms.items[0]!); },
      (terms: typeof quote.terms) => { terms.items[0]!.options.temperature = 'hot'; terms.items[0]!.line_id = luckinSelectionId(terms.items[0]!); },
    ]) { const terms = structuredClone(quote.terms); mutate(terms); expect(luckinTermsHash(terms)).not.toBe(quote.terms_hash); }
  });
  test('requires explicit confirmation; rejects tampering and expired/replaced quotes', async () => {
    const env = setup(); const first = await env.quote();
    await expect(env.workflow.confirm(scope, { ...confirm(first), confirmed: false })).rejects.toThrow();
    await expect(env.workflow.confirm(scope, { ...confirm(first), terms_hash: 'f'.repeat(64) })).rejects.toThrow('confirmation_mismatch');
    const next = await env.quote();
    await expect(env.workflow.confirm(scope, confirm(first))).rejects.toThrow('requote_required');
    env.advance(120_001);
    await expect(env.workflow.confirm(scope, confirm(next))).rejects.toThrow('requote_required');
    expect(env.upstream.createCalls).toBe(0);
  });
  test('final price includes discounts and fees, with budget enforced after preview', async () => {
    const env = setup();
    expect((await env.quote([selection], 1150)).terms.total_minor).toBe(1150);
    await expect(env.quote([selection], 1149)).rejects.toThrow('budget exceeded');
    await expect(env.quote([selection, { ...selection, store_id: 'fixture-west' }])).rejects.toThrow('cross_store');
    await expect(env.quote([{ ...selection, options: { invented: 'option' } }])).rejects.toThrow();
    await expect(env.quote([{ ...selection, product_id: 'fixture-soldout', options: {} }])).rejects.toThrow();
  });
});

describe('durable external workflow', () => {
  test('concurrent double confirmation sends once; order creation is pending payment', async () => {
    const env = setup(); const quote = await env.quote();
    const results = await Promise.all([env.workflow.confirm(scope, confirm(quote)), env.workflow.confirm(scope, confirm(quote))]);
    expect(new Set(results.map(row => row.attempt_id)).size).toBe(1); expect(env.upstream.createCalls).toBe(1);
    const attempt = env.workflow.get(scope, results[0]!.attempt_id);
    expect(attempt.order?.payment).toBe('pending'); expect(attempt.order?.pickup_code).toBeUndefined();
    expect((await env.workflow.reconcile(scope, attempt.attempt_id)).order?.payment).toBe('pending');
    await env.upstream.advance(scope, attempt.order!.order_id, 'pay');
    expect((await env.workflow.reconcile(scope, attempt.attempt_id)).order?.fulfillment).toBe('preparing');
    await env.upstream.advance(scope, attempt.order!.order_id, 'ready');
    env.restart(); expect((await env.workflow.reconcile(scope, attempt.attempt_id)).order?.pickup_code).toBe('FIXTURE-001');
  });
  test('lost create response survives restart and cannot be bypassed using a new quote', async () => {
    const env = setup(); const quote = await env.quote(); env.upstream.loseNextCreateResponse = true;
    const attempt = await env.workflow.confirm(scope, confirm(quote)); expect(attempt.state).toBe('unknown');
    env.restart(); const newQuote = await env.quote();
    await expect(env.workflow.confirm(scope, confirm(newQuote))).rejects.toThrow('unresolved_purchase');
    expect((await env.workflow.confirm(scope, confirm(quote))).attempt_id).toBe(attempt.attempt_id);
    expect((await env.workflow.reconcile(scope, attempt.attempt_id)).state).toBe('created');
    expect(env.upstream.createCalls).toBe(1);
  });
  test('crash after upstream accepted but before local save is recovered without resending', async () => {
    const env = setup(); const quote = await env.quote();
    const attemptId = 'crash-attempt';
    env.workflow.db.query("INSERT INTO attempts VALUES(?,?,?,?,?,'sending',NULL)").run(attemptId, quote.terms.quote_id, scope.owner_id, scope.account_id, scope.environment);
    await env.upstream.create(scope, quote.terms, quote.terms_hash, attemptId);
    env.restart(); expect(env.workflow.get(scope, attemptId).state).toBe('unknown');
    expect((await env.workflow.reconcile(scope, attemptId)).state).toBe('created'); expect(env.upstream.createCalls).toBe(1);
  });
  test('without upstream request lookup, unknown remains unknown and account switch cannot bypass it', async () => {
    const env = setup(); env.upstream.canFindByRequestId = false; env.upstream.loseNextCreateResponse = true;
    const quote = await env.quote(); const attempt = await env.workflow.confirm(scope, confirm(quote));
    env.restart(); expect((await env.workflow.reconcile(scope, attempt.attempt_id)).state).toBe('unknown');
    const otherAccount = { ...scope, account_id: 'different-account' };
    expect(() => env.workflow.get(otherAccount, attempt.attempt_id)).toThrow('not_found');
    const newQuote = await env.quote([selection], 10000, otherAccount);
    await expect(env.workflow.confirm(otherAccount, confirm(newQuote))).rejects.toThrow('unresolved_purchase');
    expect(env.upstream.createCalls).toBe(1);
  });
  test('stopping new orders preserves reconciliation and owner isolation', async () => {
    const env = setup(); const quote = await env.quote(); const attempt = await env.workflow.confirm(scope, confirm(quote));
    env.workflow.newOrdersEnabled = false;
    const next = await env.quote(); await expect(env.workflow.confirm(scope, confirm(next))).rejects.toThrow('new_orders_disabled');
    expect((await env.workflow.reconcile(scope, attempt.attempt_id)).state).toBe('created');
    expect(() => env.workflow.get({ ...scope, owner_id: 'b' }, attempt.attempt_id)).toThrow('not_found');
    expect(env.workflow.list({ ...scope, owner_id: 'b' })).toEqual([]);
    expect(() => env.workflow.get({ ...scope, environment: 'live' }, attempt.attempt_id)).toThrow('environment_mismatch');
  });
  test('explicit rejection permits a new confirmed quote; mismatched upstream order is unknown', async () => {
    const env = setup(); env.upstream.rejectNextCreate = true;
    const quote = await env.quote(); expect((await env.workflow.confirm(scope, confirm(quote))).state).toBe('rejected');
    const next = await env.quote(); const original = env.upstream.create.bind(env.upstream);
    env.upstream.create = async (...args) => ({ ...await original(...args), total_minor: 1 });
    expect((await env.workflow.confirm(scope, confirm(next))).state).toBe('unknown');
  });
  test('refuses an unrelated database without modifying it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ocp-luckin-other-')); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'other.sqlite'); const db = new Database(path); db.exec('CREATE TABLE original(value TEXT)'); db.close();
    const port = new FixtureLuckinPort(); cleanups.push(() => port.close());
    expect(() => new LuckinWorkflow(path, port)).toThrow('not a Luckin workflow database');
    const verify = new Database(path); expect(verify.query('PRAGMA user_version').get()).toEqual({ user_version: 0 }); verify.close();
  });
});
