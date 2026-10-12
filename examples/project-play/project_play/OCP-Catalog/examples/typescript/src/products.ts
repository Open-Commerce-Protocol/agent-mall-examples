/**
 * The catalog's data — three hardcoded products living in memory.
 *
 * A real Catalog Node would back this with a database or a live vendor API;
 * a minimal node just needs something to query and resolve.
 */
export type Product = {
  id: string;
  title: string;
  summary: string;
  brand: string;
  category: string;
  currency: string;
  amount: number;
  availability: 'in_stock' | 'low_stock' | 'out_of_stock';
  url: string;
  updated_at: string;
};

export const PRODUCTS: Product[] = [
  {
    id: 'sku-001',
    title: 'Aurora Wireless Headphones',
    summary: 'Over-ear Bluetooth headphones with active noise cancellation.',
    brand: 'Aurora',
    category: 'electronics',
    currency: 'USD',
    amount: 199.0,
    availability: 'in_stock',
    url: 'https://example.com/products/aurora-headphones',
    updated_at: '2026-07-01T00:00:00.000Z',
  },
  {
    id: 'sku-002',
    title: 'Trailhead Running Shoes',
    summary: 'Lightweight trail runners with a grippy all-terrain outsole.',
    brand: 'Trailhead',
    category: 'footwear',
    currency: 'USD',
    amount: 129.0,
    availability: 'low_stock',
    url: 'https://example.com/products/trailhead-shoes',
    updated_at: '2026-07-02T00:00:00.000Z',
  },
  {
    id: 'sku-003',
    title: 'Camp Kettle 1.5L',
    summary: 'Hard-anodized aluminium kettle for backcountry cooking.',
    brand: 'Basecamp',
    category: 'outdoors',
    currency: 'USD',
    amount: 39.0,
    availability: 'in_stock',
    url: 'https://example.com/products/camp-kettle',
    updated_at: '2026-07-03T00:00:00.000Z',
  },
];
