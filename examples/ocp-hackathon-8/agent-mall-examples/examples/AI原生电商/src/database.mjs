import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { enrichLaptopProduct } from './agents.mjs';

const SEED_PRODUCTS = [
  { sku: 'NOVA-AIR-13', title: 'Nova Air 13', brand: 'Nexa', price: 4999, inventory: 18, description: '1.18kg 轻薄金属机身，长续航，适合通勤、学习和移动办公。', image: '/assets/nova-air.png', specs: { 处理器: 'Core Ultra 5', 内存: '16GB', 硬盘: '1TB SSD', 屏幕: '13.5英寸 2.5K', 重量: '1.18kg', 续航: '16小时' } },
  { sku: 'FORGE-X16', title: 'Forge X16', brand: 'Axiom', price: 8999, inventory: 7, description: '高性能游戏本，独立显卡与高刷新率屏幕，适合 3A 游戏和大型工程软件。', image: '/assets/forge-x16.png', specs: { 处理器: 'Ryzen 9', 内存: '32GB', 硬盘: '1TB SSD', 显卡: 'RTX 5070', 屏幕: '16英寸 240Hz', 重量: '2.35kg', 续航: '7小时' } },
  { sku: 'STUDIO-PRO-14', title: 'Studio Pro 14', brand: 'Morrow', price: 10999, inventory: 5, description: '为视频剪辑、摄影和设计打造，拥有高色准 OLED 屏幕与强劲图形性能。', image: '/assets/studio-pro.png', specs: { 处理器: 'Core Ultra 9', 内存: '32GB', 硬盘: '2TB SSD', 显卡: 'RTX 5060', 屏幕: '14.5英寸 OLED', 重量: '1.52kg', 续航: '11小时' } },
  { sku: 'CAMPUS-15', title: 'Campus Book 15', brand: 'Nexa', price: 4299, inventory: 26, description: '高性价比学生笔记本，适合网课、论文、编程入门和日常娱乐。', image: '/assets/campus-book.png', specs: { 处理器: 'Ryzen 7', 内存: '16GB', 硬盘: '512GB SSD', 屏幕: '15.6英寸 护眼屏', 重量: '1.65kg', 续航: '12小时' } },
  { sku: 'SUMMIT-WORK-14', title: 'Summit Work 14', brand: 'Axiom', price: 6799, inventory: 12, description: '商务办公本，静音键盘、丰富接口和企业级安全能力，适合会议与出差。', image: '/assets/summit-work.png', specs: { 处理器: 'Core Ultra 7', 内存: '32GB', 硬盘: '1TB SSD', 屏幕: '14英寸 2.8K', 重量: '1.32kg', 续航: '15小时' } },
  { sku: 'NOMAD-FLEX-14', title: 'Nomad Flex 14', brand: 'Morrow', price: 5999, inventory: 9, description: '可翻转触控二合一笔记本，支持手写，适合差旅展示、课堂笔记与轻创作。', image: '/assets/nomad-flex.png', specs: { 处理器: 'Core Ultra 5', 内存: '16GB', 硬盘: '1TB SSD', 屏幕: '14英寸 触控屏', 重量: '1.39kg', 续航: '13小时' } },
];

/** 初始化本地 SQLite 数据库并返回数据访问对象。 */
export function createStore(databasePath) {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  migrate(db);
  seed(db);

  return {
    listProducts: () => db.prepare('SELECT * FROM products ORDER BY updated_at DESC').all().map(mapProduct),
    searchProductKeywords: (terms) => searchProductKeywords(db, terms),
    getProduct: (id) => mapProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(id)),
    createProduct: (input) => insertProduct(db, input),
    updateInventory: (id, inventory) => updateInventory(db, id, inventory),
    listOrders: () => db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all().map(mapOrder),
    createOrder: (input) => createOrder(db, input),
    updateOrderStatus: (id, status) => updateOrderStatus(db, id, status),
    stats: () => getStats(db),
  };
}

function searchProductKeywords(db, terms) {
  const safeTerms = [...new Set(terms.map((term) => String(term).trim()).filter(Boolean))];
  if (safeTerms.length === 0) return [];
  const query = safeTerms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' OR ');
  return db.prepare('SELECT rowid AS id, bm25(product_fts) AS rank FROM product_fts WHERE product_fts MATCH ? ORDER BY rank LIMIT 50').all(query);
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      brand TEXT NOT NULL,
      category TEXT NOT NULL,
      price REAL NOT NULL,
      inventory INTEGER NOT NULL,
      description TEXT NOT NULL,
      image TEXT NOT NULL,
      specs_json TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      ai_text TEXT NOT NULL,
      ai_profile_json TEXT NOT NULL,
      embedding_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no TEXT NOT NULL UNIQUE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      product_title TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      total REAL NOT NULL,
      customer_need TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS product_fts USING fts5(title, brand, ai_text, content='products', content_rowid='id');
    CREATE TRIGGER IF NOT EXISTS product_ai AFTER INSERT ON products BEGIN
      INSERT INTO product_fts(rowid, title, brand, ai_text) VALUES (new.id, new.title, new.brand, new.ai_text);
    END;
    CREATE TRIGGER IF NOT EXISTS product_au AFTER UPDATE ON products BEGIN
      INSERT INTO product_fts(product_fts, rowid, title, brand, ai_text) VALUES ('delete', old.id, old.title, old.brand, old.ai_text);
      INSERT INTO product_fts(rowid, title, brand, ai_text) VALUES (new.id, new.title, new.brand, new.ai_text);
    END;
  `);
}

function seed(db) {
  const count = db.prepare('SELECT COUNT(*) AS count FROM products').get().count;
  if (count > 0) return;
  for (const product of SEED_PRODUCTS) insertProduct(db, product);
  const firstProduct = db.prepare('SELECT id, title, price FROM products ORDER BY id LIMIT 1').get();
  db.prepare('INSERT INTO orders (order_no, product_id, product_title, quantity, total, customer_need, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('DEMO-20261011-001', firstProduct.id, firstProduct.title, 1, firstProduct.price, '通勤轻薄，续航要长', '待发货');
}

function insertProduct(db, input) {
  const enriched = enrichLaptopProduct(input);
  const result = db.prepare(`
    INSERT INTO products (sku, title, brand, category, price, inventory, description, image, specs_json, raw_json, ai_text, ai_profile_json, embedding_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    enriched.sku.trim(), enriched.title.trim(), enriched.brand.trim(), enriched.category,
    Number(enriched.price), Number(enriched.inventory), enriched.description.trim(), enriched.image || '/assets/default-laptop.png',
    JSON.stringify(enriched.specs), JSON.stringify(input), enriched.aiText,
    JSON.stringify(enriched.aiProfile), JSON.stringify(enriched.embedding),
  );
  return mapProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid));
}

function updateInventory(db, id, inventory) {
  db.prepare("UPDATE products SET inventory = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(Number(inventory), Number(id));
  return mapProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(Number(id)));
}

function createOrder(db, input) {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(input.productId));
  if (!product) throw new Error('商品不存在');
  const quantity = Math.max(1, Number(input.quantity) || 1);
  if (product.inventory < quantity) throw new Error('库存不足');
  const orderNo = `NX${Date.now().toString().slice(-10)}`;
  const transaction = db.prepare('UPDATE products SET inventory = inventory - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND inventory >= ?');
  const updated = transaction.run(quantity, product.id, quantity);
  if (updated.changes !== 1) throw new Error('库存不足');
  const result = db.prepare('INSERT INTO orders (order_no, product_id, product_title, quantity, total, customer_need, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(orderNo, product.id, product.title, quantity, product.price * quantity, String(input.customerNeed ?? ''), '待确认');
  return mapOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(result.lastInsertRowid));
}

function updateOrderStatus(db, id, status) {
  const allowed = new Set(['待确认', '待发货', '已发货', '已完成', '已取消']);
  if (!allowed.has(status)) throw new Error('订单状态无效');
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, Number(id));
  return mapOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(id)));
}

function getStats(db) {
  const product = db.prepare('SELECT COUNT(*) AS products, COALESCE(SUM(inventory), 0) AS inventory, COALESCE(SUM(price * inventory), 0) AS stock_value FROM products').get();
  const order = db.prepare("SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue FROM orders WHERE status != '已取消'").get();
  return { ...product, ...order };
}

function mapProduct(row) {
  if (!row) return null;
  return { ...row, specs: JSON.parse(row.specs_json), raw: JSON.parse(row.raw_json), aiProfile: JSON.parse(row.ai_profile_json), embedding: JSON.parse(row.embedding_json) };
}

function mapOrder(row) {
  return row ? { ...row } : null;
}
