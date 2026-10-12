import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { LuckinRejected, type LuckinPort } from '@ocp-catalog/luckin-adapter';
import {
  canonicalJson, LUCKIN_TERMS_DOMAIN, luckinScopeSchema, luckinQuoteRequestSchema, luckinTermsSchema, luckinTermsHash,
  luckinConfirmationSchema, luckinOrderSchema, luckinSelectionId, mergeLuckinSelections,
  type LuckinScope, type LuckinTerms, type LuckinOrder,
} from '@ocp-catalog/shopping-contracts';

export class LuckinFlowError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}
export function catalogId(storeId: string): string { return `luckin:${storeId}`; }
interface QuoteRecord { quote_id: string; owner: string; account: string; environment: string; body: string; hash: string; active: number }
interface AttemptRecord { attempt_id: string; quote_id: string; owner: string; account: string; environment: string; state: 'sending' | 'unknown' | 'created' | 'rejected'; body: string | null }
export interface LuckinAttempt {
  attempt_id: string; quote_id: string; state: AttemptRecord['state']; order?: LuckinOrder;
}

/** Dedicated database; never opens or migrates the demo merchant database. */
export class LuckinWorkflow {
  readonly db: Database;
  newOrdersEnabled = true;
  constructor(path: string, readonly port: LuckinPort, private readonly now: () => number = Date.now) {
    if (port.environment !== 'fixture') throw new Error('live transaction mapping is not verified');
    this.db = new Database(path, { create: true });
    const version = this.db.query('PRAGMA user_version').get() as { user_version: number };
    if (version.user_version !== 0 && version.user_version !== 1) { this.db.close(); throw new Error('unsupported Luckin database version'); }
    const application = this.db.query('PRAGMA application_id').get() as { application_id: number };
    const existing = this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    if ((application.application_id !== 0x4c4b4f43 && existing.length) || (application.application_id !== 0 && application.application_id !== 0x4c4b4f43)) {
      this.db.close(); throw new Error('not a Luckin workflow database');
    }
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS quotes (quote_id TEXT PRIMARY KEY, owner TEXT NOT NULL, account TEXT NOT NULL, environment TEXT NOT NULL, body TEXT NOT NULL, hash TEXT NOT NULL, active INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS attempts (attempt_id TEXT PRIMARY KEY, quote_id TEXT NOT NULL UNIQUE, owner TEXT NOT NULL, account TEXT NOT NULL, environment TEXT NOT NULL, state TEXT NOT NULL, body TEXT);
        CREATE UNIQUE INDEX IF NOT EXISTS unresolved_owner ON attempts(owner, environment) WHERE state IN ('sending','unknown');
        CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, attempt_id TEXT NOT NULL, state TEXT NOT NULL, at_ms INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS quote_heads (owner TEXT NOT NULL, environment TEXT NOT NULL, revision TEXT NOT NULL, PRIMARY KEY(owner,environment));
        PRAGMA user_version=1; PRAGMA application_id=1280003907;
      `);
    })();
    // A send committed before a crash might already have reached upstream.
    this.db.transaction(() => {
      const interrupted = this.db.query("SELECT attempt_id FROM attempts WHERE state='sending'").all() as { attempt_id: string }[];
      for (const row of interrupted) this.transition(row.attempt_id, 'unknown');
    })();
  }
  private scope(raw: LuckinScope): LuckinScope {
    const scope = luckinScopeSchema.parse(raw);
    if (scope.environment !== this.port.environment) throw new LuckinFlowError('environment_mismatch');
    return scope;
  }
  private owned<T extends { owner: string; account: string; environment: string }>(row: T | null, scope: LuckinScope): T {
    if (!row || row.owner !== scope.owner_id || row.account !== scope.account_id || row.environment !== scope.environment) throw new LuckinFlowError('not_found', 404);
    return row;
  }
  private quoteRecord(scope: LuckinScope, id: string): QuoteRecord {
    return this.owned(this.db.query('SELECT * FROM quotes WHERE quote_id=?').get(id) as QuoteRecord | null, scope);
  }
  private attemptRecord(scope: LuckinScope, id: string): AttemptRecord {
    return this.owned(this.db.query('SELECT * FROM attempts WHERE attempt_id=?').get(id) as AttemptRecord | null, scope);
  }
  private view(row: AttemptRecord): LuckinAttempt {
    return { attempt_id: row.attempt_id, quote_id: row.quote_id, state: row.state,
      ...(row.body ? { order: luckinOrderSchema.parse(JSON.parse(row.body)) } : {}) };
  }
  private transition(id: string, state: AttemptRecord['state'], order?: LuckinOrder) {
    this.db.query('UPDATE attempts SET state=?, body=? WHERE attempt_id=?').run(state, order ? JSON.stringify(order) : null, id);
    this.db.query('INSERT INTO events(attempt_id,state,at_ms) VALUES(?,?,?)').run(id, state, this.now());
  }
  private verifyOrder(raw: LuckinOrder, quote: QuoteRecord, old?: LuckinOrder): LuckinOrder {
    const order = luckinOrderSchema.parse(raw);
    const terms = luckinTermsSchema.parse(JSON.parse(quote.body));
    if (order.store_id !== terms.store_id || order.terms_hash !== quote.hash || order.total_minor !== terms.total_minor
      || (old && order.order_id !== old.order_id)) throw new LuckinFlowError('upstream_order_mismatch');
    if (terms.scope.environment === 'fixture' && order.payment_action?.type === 'url') throw new LuckinFlowError('fixture_payment_mismatch');
    return order;
  }
  async quote(rawScope: LuckinScope, input: unknown): Promise<{ terms: LuckinTerms; terms_hash: string }> {
    const scope = this.scope(rawScope);
    const request = luckinQuoteRequestSchema.parse(input);
    const selections = mergeLuckinSelections(request.selections);
    if (selections.some(line => line.store_id !== request.store_id)) throw new LuckinFlowError('cross_store');
    const revision = randomUUID();
    // Invalidate before awaiting the preview, including failed re-quotes. A late
    // response must not replace a newer basket's quote.
    this.db.transaction(() => {
      this.db.query('UPDATE quotes SET active=0 WHERE owner=? AND environment=?').run(scope.owner_id, scope.environment);
      this.db.query('INSERT OR REPLACE INTO quote_heads VALUES(?,?,?)').run(scope.owner_id, scope.environment, revision);
    })();
    const preview = await this.port.preview(scope, selections);
    // The upstream preview must correspond exactly to the requested basket.
    const expected = selections.map(line => ({ line_id: luckinSelectionId(line), quantity: line.quantity }));
    const received = preview.items.map(line => ({ line_id: luckinSelectionId(line), quantity: line.quantity })).sort((a, b) => a.line_id < b.line_id ? -1 : 1);
    if (canonicalJson(expected) !== canonicalJson(received)) throw new LuckinFlowError('preview_selection_mismatch');
    const terms = luckinTermsSchema.parse({ ...preview, v: LUCKIN_TERMS_DOMAIN, scope, quote_id: `lq_${randomUUID()}`,
      catalog_id: catalogId(request.store_id), store_id: request.store_id, currency: 'CNY', fulfillment: 'pickup', budget_minor: request.budget_minor });
    if (Date.parse(terms.expires_at) <= this.now()) throw new LuckinFlowError('quote_expired');
    const terms_hash = luckinTermsHash(terms);
    this.db.transaction(() => {
      const head = this.db.query('SELECT revision FROM quote_heads WHERE owner=? AND environment=?').get(scope.owner_id, scope.environment) as { revision: string };
      if (head.revision !== revision) throw new LuckinFlowError('requote_required');
      this.db.query('INSERT INTO quotes VALUES(?,?,?,?,?,?,1)').run(terms.quote_id, scope.owner_id, scope.account_id, scope.environment, JSON.stringify(terms), terms_hash);
    })();
    return { terms, terms_hash };
  }
  /** Called only by the explicit user confirmation route, never by a model tool. */
  async confirm(rawScope: LuckinScope, input: unknown): Promise<LuckinAttempt> {
    const scope = this.scope(rawScope);
    const confirmation = luckinConfirmationSchema.parse(input);
    const prepared = this.db.transaction(() => {
      const quote = this.quoteRecord(scope, confirmation.quote_id);
      if (confirmation.terms_hash !== quote.hash) throw new LuckinFlowError('confirmation_mismatch');
      const previous = this.db.query('SELECT * FROM attempts WHERE quote_id=?').get(quote.quote_id) as AttemptRecord | null;
      if (previous) return { previous: this.owned(previous, scope) };
      if (!this.newOrdersEnabled) throw new LuckinFlowError('new_orders_disabled');
      const terms = luckinTermsSchema.parse(JSON.parse(quote.body));
      if (!quote.active || Date.parse(terms.expires_at) <= this.now()) throw new LuckinFlowError('requote_required');
      if (luckinTermsHash(terms) !== quote.hash) throw new LuckinFlowError('stored_terms_corrupt');
      const unresolved = this.db.query("SELECT attempt_id FROM attempts WHERE owner=? AND environment=? AND state IN ('sending','unknown')").get(scope.owner_id, scope.environment);
      if (unresolved) throw new LuckinFlowError('unresolved_purchase');
      const id = `la_${randomUUID()}`;
      this.db.query("INSERT INTO attempts VALUES(?,?,?,?,?,'sending',NULL)").run(id, quote.quote_id, scope.owner_id, scope.account_id, scope.environment);
      this.db.query('INSERT INTO events(attempt_id,state,at_ms) VALUES(?,?,?)').run(id, 'sending', this.now());
      return { id, terms, quote };
    }).immediate();
    if (prepared.previous) return this.view(prepared.previous);
    const { id, terms, quote } = prepared;
    // No SQLite transaction spans a network call; the stable external key is durable first.
    try {
      const order = this.verifyOrder(await this.port.create(scope, terms!, quote!.hash, id!), quote!);
      this.db.transaction(() => this.transition(id!, 'created', order))();
    } catch (error) {
      this.db.transaction(() => this.transition(id!, error instanceof LuckinRejected ? 'rejected' : 'unknown'))();
    }
    return this.get(scope, id!);
  }
  get(rawScope: LuckinScope, id: string): LuckinAttempt { return this.view(this.attemptRecord(this.scope(rawScope), id)); }
  list(rawScope: LuckinScope): LuckinAttempt[] {
    const scope = this.scope(rawScope);
    return (this.db.query('SELECT * FROM attempts WHERE owner=? AND account=? AND environment=? ORDER BY rowid DESC').all(scope.owner_id, scope.account_id, scope.environment) as AttemptRecord[]).map(row => this.view(row));
  }
  async reconcile(rawScope: LuckinScope, id: string): Promise<LuckinAttempt> {
    const scope = this.scope(rawScope); const row = this.attemptRecord(scope, id);
    if (row.state === 'sending' || row.state === 'rejected') return this.view(row);
    const old = row.body ? luckinOrderSchema.parse(JSON.parse(row.body)) : undefined;
    const order = old ? await this.port.order(scope, old.order_id)
      : this.port.canFindByRequestId && this.port.findByRequestId ? await this.port.findByRequestId(scope, id) : null;
    // Not found is not evidence of non-creation (eventual consistency). Never resend.
    if (order) {
      const verified = this.verifyOrder(order, this.quoteRecord(scope, row.quote_id), old);
      this.db.transaction(() => this.transition(id, 'created', verified))();
    }
    return this.get(scope, id);
  }
  close() { this.db.close(); }
}
