-- ═══════════════════════════════════════════════════════════════════════════
-- Farooq & Co Traders ERP — relational schema
-- The same design the client database uses, written for PostgreSQL so the
-- ERP can be lifted onto a server later without being redesigned.
--
-- Money is stored in paisa as integers, exactly as the client does, so no
-- figure can drift through floating point. Divide by 100 for rupees.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TYPE invoice_status   AS ENUM ('DRAFT','CONFIRMED','DISPATCHED','PARTIALLY_PAID','PAID',
                                      'CANCELLED','RETURNED','PARTIALLY_RETURNED');
CREATE TYPE payment_status   AS ENUM ('UNPAID','PARTIAL','PAID');
CREATE TYPE payment_dir      AS ENUM ('IN','OUT');
CREATE TYPE party_type       AS ENUM ('CUSTOMER','SUPPLIER');
CREATE TYPE return_condition AS ENUM ('SELLABLE','DAMAGED','DEFECTIVE','WRONG_ITEM','EXPIRED','OTHER');
CREATE TYPE return_treatment AS ENUM ('ADJUST_OUTSTANDING_BALANCE','CUSTOMER_CREDIT','REFUND','REPLACEMENT');
CREATE TYPE stock_doc_type   AS ENUM ('TRANSFER','RECEIVE','ADJUST','DISPATCH');
CREATE TYPE movement_kind    AS ENUM ('OPENING_STOCK','PURCHASE_IN','SALE_OUT','CUSTOMER_RETURN_IN',
                                      'CUSTOMER_RETURN_DAMAGED_IN','SUPPLIER_RETURN_OUT','TRANSFER_IN',
                                      'TRANSFER_OUT','ADJUSTMENT_IN','ADJUSTMENT_OUT','SALE_REVERSAL_IN',
                                      'PURCHASE_REVERSAL_OUT','REPLACEMENT_OUT','SUPPLIER_REPLACEMENT_IN',
                                      'STOCK_WRITE_OFF','DISPATCH_OUT');

-- ── master data ──────────────────────────────────────────────────────────
CREATE TABLE business_settings (
  id                TEXT PRIMARY KEY DEFAULT 'business',
  business_name     TEXT NOT NULL,
  legal_name        TEXT,
  tagline           TEXT,
  tagline_ur        TEXT,
  slogan            TEXT,
  address           TEXT,
  city              TEXT,
  phone             TEXT,
  shop_phone        TEXT,
  whatsapp          TEXT,
  email             TEXT,
  website           TEXT,
  ntn               TEXT,
  registration_no   TEXT,
  invoice_prefix    TEXT DEFAULT 'INV',
  purchase_prefix   TEXT DEFAULT 'PUR',
  receipt_prefix    TEXT DEFAULT 'REC',
  sales_doc_prefix  TEXT DEFAULT 'SLV',
  currency_label    TEXT DEFAULT 'PKR',
  invoice_template  TEXT DEFAULT 'classic',
  invoice_export_flow TEXT DEFAULT 'ask',
  allow_negative_stock BOOLEAN DEFAULT FALSE,
  tax_enabled       BOOLEAN DEFAULT FALSE,
  default_tax_rate  NUMERIC(6,3) DEFAULT 0,
  invoice_footer    TEXT,
  terms             TEXT,
  bank_details      TEXT,
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE warehouses (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE regions (
  id      TEXT PRIMARY KEY,
  name_ur TEXT,
  name_en TEXT,
  active  BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE products (
  id                     TEXT PRIMARY KEY,          -- PRD-0001 …
  name_ur                TEXT,
  name_en                TEXT,
  brand                  TEXT,
  brand_en               TEXT,
  category               TEXT,                      -- چاول / آٹا / وغیرہ / غیر متعین
  product_type           TEXT,
  bag_kg                 NUMERIC(8,2),
  sku                    TEXT,
  source_folio           TEXT,                      -- Bar-0012 …
  catalogue_listed_value BIGINT,                    -- the "Size !" column, NOT a price
  price_confirmed        BOOLEAN NOT NULL DEFAULT FALSE,
  buy_price              BIGINT,                    -- paisa, null until a real purchase
  sell_price             BIGINT,
  min_level              NUMERIC(12,3),
  active                 BOOLEAN NOT NULL DEFAULT TRUE,
  needs_review           BOOLEAN NOT NULL DEFAULT FALSE,
  duplicate_candidate    BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX products_category_idx ON products (category);
CREATE INDEX products_active_idx   ON products (active);

CREATE TABLE customers (
  id                      TEXT PRIMARY KEY,         -- CUS-0001 …
  legacy_code             TEXT,
  shop_name               TEXT NOT NULL,
  owner_name              TEXT,
  name_ur                 TEXT,
  phone                   TEXT,
  whatsapp                TEXT,
  address                 TEXT,
  area                    TEXT,
  route                   TEXT,
  region_id               TEXT REFERENCES regions(id),
  region_assumed          BOOLEAN NOT NULL DEFAULT FALSE,
  is_cash_counter         BOOLEAN NOT NULL DEFAULT FALSE,
  credit_limit            BIGINT,
  opening_balance         BIGINT NOT NULL DEFAULT 0,
  opening_balance_date    DATE,
  legacy_total_sales      BIGINT,                   -- reference only
  legacy_total_collection BIGINT,
  legacy_balance_signed   BIGINT,
  needs_review            BOOLEAN NOT NULL DEFAULT FALSE,
  active                  BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX customers_region_idx ON customers (region_id);
CREATE INDEX customers_legacy_idx ON customers (legacy_code);

CREATE TABLE suppliers (
  id                      TEXT PRIMARY KEY,         -- SUP-0001 …
  legacy_code             TEXT,
  company                 TEXT NOT NULL,
  contact_person          TEXT,
  phone                   TEXT,
  whatsapp                TEXT,
  location                TEXT,
  opening_balance         BIGINT NOT NULL DEFAULT 0,
  legacy_total_sales      BIGINT,
  legacy_total_collection BIGINT,
  legacy_balance_signed   BIGINT,
  needs_review            BOOLEAN NOT NULL DEFAULT FALSE,
  active                  BOOLEAN NOT NULL DEFAULT TRUE
);

-- ── numbering, issued inside the caller's own transaction ────────────────
CREATE TABLE sequences (
  kind       TEXT NOT NULL,                         -- INV, PUR, REC, CR, SR, TRF, EXP …
  year       INT  NOT NULL,
  n          BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (kind, year)
);

-- one row per logical operation; a repeat is refused here (idempotency)
CREATE TABLE operations (
  op_id      TEXT PRIMARY KEY,
  entity     TEXT,
  entity_id  TEXT,
  ref        TEXT,
  state      TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── sales ────────────────────────────────────────────────────────────────
CREATE TABLE orders (
  id             TEXT PRIMARY KEY,
  order_number   TEXT UNIQUE NOT NULL,              -- SO-2026-000001 / QT-…
  kind           TEXT NOT NULL DEFAULT 'ORDER',     -- ORDER | QUOTATION
  client_op_id   TEXT,
  revision       INT NOT NULL DEFAULT 0,
  customer_id    TEXT NOT NULL REFERENCES customers(id),
  warehouse_id   TEXT NOT NULL REFERENCES warehouses(id),
  order_date     DATE NOT NULL,
  delivery_date  DATE,
  valid_until    DATE,
  salesperson    TEXT,
  subtotal       BIGINT NOT NULL DEFAULT 0,
  discount_amount BIGINT NOT NULL DEFAULT 0,
  tax_amount     BIGINT NOT NULL DEFAULT 0,
  freight_amount BIGINT NOT NULL DEFAULT 0,
  loading_amount BIGINT NOT NULL DEFAULT 0,
  other_charges  BIGINT NOT NULL DEFAULT 0,
  grand_total    BIGINT NOT NULL DEFAULT 0,
  total_qty      NUMERIC(14,3) NOT NULL DEFAULT 0,
  line_count     INT NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'CONFIRMED',
  invoice_id     TEXT,
  notes          TEXT,
  created_by     TEXT,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX orders_customer_idx ON orders (customer_id);
CREATE INDEX orders_date_idx     ON orders (order_date);

CREATE TABLE order_items (
  id                TEXT PRIMARY KEY,
  order_id          TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sort_order        INT  NOT NULL DEFAULT 0,
  product_id        TEXT NOT NULL REFERENCES products(id),
  description_ur    TEXT,
  description_en    TEXT,
  brand             TEXT,
  package           TEXT,
  quantity          NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit              TEXT DEFAULT 'Bag',
  unit_price        BIGINT NOT NULL CHECK (unit_price >= 0),
  discount          BIGINT NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax               BIGINT NOT NULL DEFAULT 0,
  line_total        BIGINT NOT NULL,
  warehouse_id      TEXT REFERENCES warehouses(id),
  delivered_qty     NUMERIC(14,3) NOT NULL DEFAULT 0,
  notes             TEXT
);
CREATE INDEX order_items_order_idx ON order_items (order_id);

CREATE TABLE invoices (
  id                 TEXT PRIMARY KEY,
  invoice_number     TEXT UNIQUE,                   -- null only while a draft
  client_op_id       TEXT,
  revision           INT NOT NULL DEFAULT 0,
  invoice_type       TEXT NOT NULL DEFAULT 'SALE',
  sale_order_id      TEXT REFERENCES orders(id),
  order_number       TEXT,
  dispatch_number    TEXT,
  customer_id        TEXT NOT NULL REFERENCES customers(id),
  -- snapshots, so an old invoice stays true after a rename
  customer_code_snapshot TEXT,
  customer_name_snapshot TEXT,
  shop_name_snapshot     TEXT,
  mobile_snapshot        TEXT,
  address_snapshot       TEXT,
  region_id          TEXT REFERENCES regions(id),
  region_snapshot    TEXT,
  market_snapshot    TEXT,
  warehouse_id       TEXT NOT NULL REFERENCES warehouses(id),
  warehouse_snapshot TEXT,
  salesperson        TEXT,
  invoice_date       DATE NOT NULL,
  due_date           DATE,
  subtotal           BIGINT NOT NULL DEFAULT 0,
  item_discounts     BIGINT NOT NULL DEFAULT 0,
  invoice_discount   BIGINT NOT NULL DEFAULT 0,
  discount_amount    BIGINT NOT NULL DEFAULT 0,
  tax_amount         BIGINT NOT NULL DEFAULT 0,
  freight_amount     BIGINT NOT NULL DEFAULT 0,
  loading_amount     BIGINT NOT NULL DEFAULT 0,
  other_charges      BIGINT NOT NULL DEFAULT 0,
  grand_total        BIGINT NOT NULL DEFAULT 0,
  paid_amount        BIGINT NOT NULL DEFAULT 0,
  balance_amount     BIGINT NOT NULL DEFAULT 0,
  previous_balance   BIGINT NOT NULL DEFAULT 0,
  payment_status     payment_status NOT NULL DEFAULT 'UNPAID',
  payment_method     TEXT,
  reference_no       TEXT,
  status             invoice_status NOT NULL DEFAULT 'CONFIRMED',
  stock_applied      BOOLEAN NOT NULL DEFAULT FALSE,
  total_qty          NUMERIC(14,3) NOT NULL DEFAULT 0,
  line_count         INT NOT NULL DEFAULT 0,
  notes              TEXT,
  created_by         TEXT,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now(),
  confirmed_at       TIMESTAMPTZ,
  cancelled_at       TIMESTAMPTZ,
  cancel_reason      TEXT
);
CREATE INDEX invoices_customer_idx  ON invoices (customer_id);
CREATE INDEX invoices_date_idx      ON invoices (invoice_date);
CREATE INDEX invoices_status_idx    ON invoices (status);
CREATE INDEX invoices_warehouse_idx ON invoices (warehouse_id);
CREATE INDEX invoices_region_idx    ON invoices (region_id);

CREATE TABLE invoice_items (
  id                  TEXT PRIMARY KEY,
  invoice_id          TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  sort_order          INT  NOT NULL DEFAULT 0,
  product_id          TEXT NOT NULL REFERENCES products(id),
  description_ur      TEXT,
  description_en      TEXT,
  brand_snapshot      TEXT,
  category_snapshot   TEXT,
  package_snapshot    TEXT,
  sku_snapshot        TEXT,
  unit                TEXT DEFAULT 'Bag',
  quantity            NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit_price          BIGINT NOT NULL CHECK (unit_price >= 0),
  discount            BIGINT NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax                 BIGINT NOT NULL DEFAULT 0,
  line_total          BIGINT NOT NULL,
  cost_snapshot       BIGINT NOT NULL DEFAULT 0,     -- cost on the day, for profit
  warehouse_id        TEXT NOT NULL REFERENCES warehouses(id),
  batch_no            TEXT,
  returned_qty        NUMERIC(14,3) NOT NULL DEFAULT 0,
  notes               TEXT
);
CREATE INDEX invoice_items_invoice_idx ON invoice_items (invoice_id);
CREATE INDEX invoice_items_product_idx ON invoice_items (product_id);

-- ── purchases ────────────────────────────────────────────────────────────
CREATE TABLE purchases (
  id                  TEXT PRIMARY KEY,
  purchase_number     TEXT UNIQUE NOT NULL,
  client_op_id        TEXT,
  revision            INT NOT NULL DEFAULT 0,
  supplier_id         TEXT NOT NULL REFERENCES suppliers(id),
  supplier_name_snapshot TEXT,
  supplier_invoice_no TEXT,
  warehouse_id        TEXT NOT NULL REFERENCES warehouses(id),
  warehouse_snapshot  TEXT,
  purchase_date       DATE NOT NULL,
  vehicle_no          TEXT,
  driver              TEXT,
  delivery_ref        TEXT,
  subtotal            BIGINT NOT NULL DEFAULT 0,
  discount_amount     BIGINT NOT NULL DEFAULT 0,
  tax_amount          BIGINT NOT NULL DEFAULT 0,
  freight_amount      BIGINT NOT NULL DEFAULT 0,
  loading_amount      BIGINT NOT NULL DEFAULT 0,
  other_charges       BIGINT NOT NULL DEFAULT 0,
  grand_total         BIGINT NOT NULL DEFAULT 0,
  paid_amount         BIGINT NOT NULL DEFAULT 0,
  balance_amount      BIGINT NOT NULL DEFAULT 0,
  payment_status      payment_status NOT NULL DEFAULT 'UNPAID',
  status              TEXT NOT NULL DEFAULT 'RECEIVED', -- ORDERED | PARTIALLY_RECEIVED | RECEIVED
  ordered_qty         NUMERIC(14,3) NOT NULL DEFAULT 0,
  received_qty        NUMERIC(14,3) NOT NULL DEFAULT 0,
  total_qty           NUMERIC(14,3) NOT NULL DEFAULT 0,
  line_count          INT NOT NULL DEFAULT 0,
  stock_applied       BOOLEAN NOT NULL DEFAULT FALSE,
  notes               TEXT,
  created_by          TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX purchases_supplier_idx ON purchases (supplier_id);
CREATE INDEX purchases_date_idx     ON purchases (purchase_date);

CREATE TABLE purchase_items (
  id               TEXT PRIMARY KEY,
  purchase_id      TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  sort_order       INT NOT NULL DEFAULT 0,
  product_id       TEXT NOT NULL REFERENCES products(id),
  description_ur   TEXT,
  description_en   TEXT,
  brand_snapshot   TEXT,
  package_snapshot TEXT,
  quantity         NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  ordered_qty      NUMERIC(14,3) NOT NULL DEFAULT 0,
  received_qty     NUMERIC(14,3) NOT NULL DEFAULT 0,  -- partial receiving
  unit             TEXT DEFAULT 'Bag',
  unit_price       BIGINT NOT NULL CHECK (unit_price >= 0),
  discount         BIGINT NOT NULL DEFAULT 0,
  tax              BIGINT NOT NULL DEFAULT 0,
  line_total       BIGINT NOT NULL,
  warehouse_id     TEXT NOT NULL REFERENCES warehouses(id),
  batch_no         TEXT,
  returned_qty     NUMERIC(14,3) NOT NULL DEFAULT 0,
  notes            TEXT
);
CREATE INDEX purchase_items_purchase_idx ON purchase_items (purchase_id);

-- ── money ────────────────────────────────────────────────────────────────
CREATE TABLE payments (
  id                TEXT PRIMARY KEY,
  receipt_number    TEXT UNIQUE NOT NULL,            -- REC- (in) · PV- (out)
  direction         payment_dir NOT NULL,
  party_type        party_type  NOT NULL,
  party_id          TEXT NOT NULL,
  party_name_snapshot TEXT,
  region_snapshot   TEXT,
  amount            BIGINT NOT NULL CHECK (amount > 0),
  method            TEXT NOT NULL,
  reference         TEXT,
  payment_date      DATE NOT NULL,
  note              TEXT,
  is_refund         BOOLEAN NOT NULL DEFAULT FALSE,
  balance_before    BIGINT,
  balance_after     BIGINT,
  status            TEXT NOT NULL DEFAULT 'POSTED',  -- POSTED | REVERSED
  reversed_at       TIMESTAMPTZ,
  reverse_reason    TEXT,
  received_by       TEXT,
  created_by        TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX payments_party_idx ON payments (party_id);
CREATE INDEX payments_date_idx  ON payments (payment_date);

CREATE TABLE payment_allocations (
  id          TEXT PRIMARY KEY,
  payment_id  TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id  TEXT REFERENCES invoices(id),
  purchase_id TEXT REFERENCES purchases(id),
  amount      BIGINT NOT NULL CHECK (amount > 0),
  created_at  TIMESTAMPTZ DEFAULT now(),
  CHECK (invoice_id IS NOT NULL OR purchase_id IS NOT NULL)
);
CREATE INDEX allocations_payment_idx ON payment_allocations (payment_id);
CREATE INDEX allocations_invoice_idx ON payment_allocations (invoice_id);

CREATE TABLE expenses (
  id             TEXT PRIMARY KEY,
  expense_number TEXT UNIQUE NOT NULL,               -- EXP-2026-000001
  client_op_id   TEXT,
  expense_date   DATE NOT NULL,
  category       TEXT NOT NULL,
  description    TEXT,
  paid_to        TEXT,
  amount         BIGINT NOT NULL CHECK (amount > 0),
  method         TEXT NOT NULL DEFAULT 'Cash',
  reference      TEXT,
  warehouse_id   TEXT REFERENCES warehouses(id),
  created_by     TEXT,
  created_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX expenses_date_idx     ON expenses (expense_date);
CREATE INDEX expenses_category_idx ON expenses (category);

-- ── returns ──────────────────────────────────────────────────────────────
CREATE TABLE customer_returns (
  id                TEXT PRIMARY KEY,
  return_number     TEXT UNIQUE NOT NULL,
  client_op_id      TEXT,
  invoice_id        TEXT NOT NULL REFERENCES invoices(id),
  invoice_number    TEXT,
  customer_id       TEXT NOT NULL REFERENCES customers(id),
  customer_name_snapshot TEXT,
  region_snapshot   TEXT,
  warehouse_id      TEXT NOT NULL REFERENCES warehouses(id),
  return_date       DATE NOT NULL,
  reason            TEXT,
  treatment         return_treatment NOT NULL DEFAULT 'ADJUST_OUTSTANDING_BALANCE',
  credit_amount     BIGINT NOT NULL DEFAULT 0,
  replacement_value BIGINT NOT NULL DEFAULT 0,
  total_qty         NUMERIC(14,3) NOT NULL DEFAULT 0,
  line_count        INT NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'POSTED',
  notes             TEXT,
  created_by        TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX customer_returns_invoice_idx  ON customer_returns (invoice_id);
CREATE INDEX customer_returns_customer_idx ON customer_returns (customer_id);

CREATE TABLE customer_return_items (
  id              TEXT PRIMARY KEY,
  return_id       TEXT NOT NULL REFERENCES customer_returns(id) ON DELETE CASCADE,
  invoice_item_id TEXT NOT NULL REFERENCES invoice_items(id),
  product_id      TEXT NOT NULL REFERENCES products(id),
  description_ur  TEXT,
  description_en  TEXT,
  package_snapshot TEXT,
  quantity        NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit_price      BIGINT NOT NULL,                   -- the rate on the original invoice
  line_total      BIGINT NOT NULL,
  condition       return_condition NOT NULL DEFAULT 'SELLABLE',
  sellable        BOOLEAN NOT NULL DEFAULT TRUE,
  reason          TEXT,
  warehouse_id    TEXT NOT NULL REFERENCES warehouses(id),
  sort_order      INT NOT NULL DEFAULT 0
);
CREATE INDEX customer_return_items_return_idx ON customer_return_items (return_id);

CREATE TABLE supplier_returns (
  id              TEXT PRIMARY KEY,
  return_number   TEXT UNIQUE NOT NULL,
  client_op_id    TEXT,
  supplier_id     TEXT NOT NULL REFERENCES suppliers(id),
  supplier_name_snapshot TEXT,
  purchase_id     TEXT REFERENCES purchases(id),
  purchase_number TEXT,
  warehouse_id    TEXT NOT NULL REFERENCES warehouses(id),
  return_date     DATE NOT NULL,
  reason          TEXT,
  debit_amount    BIGINT NOT NULL DEFAULT 0,
  total_qty       NUMERIC(14,3) NOT NULL DEFAULT 0,
  line_count      INT NOT NULL DEFAULT 0,
  expect_replacement   BOOLEAN NOT NULL DEFAULT FALSE,
  replacement_received BOOLEAN NOT NULL DEFAULT FALSE,
  status          TEXT NOT NULL DEFAULT 'POSTED',
  notes           TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE supplier_return_items (
  id               TEXT PRIMARY KEY,
  return_id        TEXT NOT NULL REFERENCES supplier_returns(id) ON DELETE CASCADE,
  purchase_item_id TEXT REFERENCES purchase_items(id),
  product_id       TEXT NOT NULL REFERENCES products(id),
  description_ur   TEXT,
  description_en   TEXT,
  package_snapshot TEXT,
  quantity         NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit_price       BIGINT NOT NULL,
  line_total       BIGINT NOT NULL,
  from_damaged     BOOLEAN NOT NULL DEFAULT FALSE,
  reason           TEXT,
  warehouse_id     TEXT NOT NULL REFERENCES warehouses(id),
  sort_order       INT NOT NULL DEFAULT 0
);

-- ── stock ────────────────────────────────────────────────────────────────
CREATE TABLE stock_docs (
  id                   TEXT PRIMARY KEY,
  doc_number           TEXT UNIQUE NOT NULL,         -- TRF- RCV- ADJ- DSP-
  type                 stock_doc_type NOT NULL,
  client_op_id         TEXT,
  doc_date             DATE NOT NULL,
  warehouse_id         TEXT NOT NULL REFERENCES warehouses(id),
  to_warehouse_id      TEXT REFERENCES warehouses(id),
  customer_id          TEXT REFERENCES customers(id),
  invoice_id           TEXT REFERENCES invoices(id),
  stock_applied        BOOLEAN NOT NULL DEFAULT TRUE, -- false when the invoice already moved it
  vehicle_no           TEXT,
  driver               TEXT,
  reason               TEXT,
  notes                TEXT,
  total_qty            NUMERIC(14,3) NOT NULL DEFAULT 0,
  line_count           INT NOT NULL DEFAULT 0,
  status               TEXT NOT NULL DEFAULT 'POSTED',
  created_by           TEXT,
  created_at           TIMESTAMPTZ DEFAULT now(),
  CHECK (type <> 'TRANSFER' OR to_warehouse_id IS DISTINCT FROM warehouse_id)
);
CREATE INDEX stock_docs_type_idx ON stock_docs (type);
CREATE INDEX stock_docs_date_idx ON stock_docs (doc_date);

CREATE TABLE stock_doc_items (
  id              TEXT PRIMARY KEY,
  doc_id          TEXT NOT NULL REFERENCES stock_docs(id) ON DELETE CASCADE,
  sort_order      INT NOT NULL DEFAULT 0,
  product_id      TEXT NOT NULL REFERENCES products(id),
  description_ur  TEXT,
  description_en  TEXT,
  package_snapshot TEXT,
  quantity        NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  direction       TEXT NOT NULL DEFAULT 'OUT',       -- IN | OUT (adjustments use both)
  warehouse_id    TEXT NOT NULL REFERENCES warehouses(id),
  to_warehouse_id TEXT REFERENCES warehouses(id),
  from_damaged    BOOLEAN NOT NULL DEFAULT FALSE,
  unit_cost       BIGINT,
  reason          TEXT,
  batch_no        TEXT,
  notes           TEXT
);

CREATE TABLE inventory (
  product_id   TEXT NOT NULL REFERENCES products(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  qty          NUMERIC(14,3) NOT NULL DEFAULT 0,
  damaged_qty  NUMERIC(14,3) NOT NULL DEFAULT 0,
  avg_cost     BIGINT NOT NULL DEFAULT 0,            -- moving average, paisa
  PRIMARY KEY (product_id, warehouse_id)
);

CREATE TABLE stock_movements (
  id             TEXT PRIMARY KEY,
  product_id     TEXT NOT NULL REFERENCES products(id),
  warehouse_id   TEXT NOT NULL REFERENCES warehouses(id),
  kind           movement_kind NOT NULL,
  qty_delta      NUMERIC(14,3) NOT NULL,
  bucket         TEXT NOT NULL DEFAULT 'stock',      -- stock | damaged
  balance_after  NUMERIC(14,3) NOT NULL,
  ref            TEXT,                               -- the document number
  ref_type       TEXT,
  note           TEXT,
  unit_cost      BIGINT,
  movement_date  DATE NOT NULL,
  user_id        TEXT,
  created_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX stock_movements_product_idx ON stock_movements (product_id);
CREATE INDEX stock_movements_wh_idx      ON stock_movements (warehouse_id);
CREATE INDEX stock_movements_date_idx    ON stock_movements (movement_date);
CREATE INDEX stock_movements_ref_idx     ON stock_movements (ref);

-- ── documents, edits, audit, sync ─────────────────────────────────────────
CREATE TABLE document_edits (
  id         TEXT PRIMARY KEY,                       -- INVOICE:<invoice id>
  entity     TEXT NOT NULL,
  entity_id  TEXT NOT NULL,
  fields     JSONB NOT NULL DEFAULT '{}',
  rows       JSONB NOT NULL DEFAULT '{}',
  removed    JSONB NOT NULL DEFAULT '[]',
  extra_rows JSONB NOT NULL DEFAULT '[]',
  charges    JSONB NOT NULL DEFAULT '[]',
  notes      TEXT,
  revisions  JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE documents (
  no         TEXT PRIMARY KEY,
  kind       TEXT,
  entity_id  TEXT,
  payload    JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE audit_log (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  ref        TEXT,
  old_values JSONB,
  new_values JSONB,
  reason     TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX audit_entity_idx ON audit_log (entity, entity_id);
CREATE INDEX audit_date_idx   ON audit_log (created_at);

CREATE TABLE sync_queue (
  op_id      TEXT PRIMARY KEY,
  entity     TEXT,
  entity_id  TEXT,
  state      TEXT NOT NULL DEFAULT 'pending',
  payload    JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
