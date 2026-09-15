# Farooq & Co Traders ERP — Landed Cost & True Profit

**Build:** `2026-09-14-landed-v18`
**Base:** `2026-09-14-options-v17`

Operational costs now land on the bags, profit is measured against what a bag
really cost, and **the supplier's account is untouched**.

---

## 1. The finding that shaped the design

The purchase form already had **Freight**, **Loading** and **Other charges**, and
the ERP already spread them across the lines. But those fields feed the purchase
total:

```
grand = subtotal − discounts + tax + freight + loading + other
```

So entering 6,500 of transport there would have made the supplier's bill
**56,500** — exactly what the brief forbids.

I did **not** repurpose those fields. They are correct for the case they were
built for: when the supplier billed for delivery, the supplier really is owed it.
The new module is for the other case — the business's own truck, its own
labourers, its own fuel.

**The rule for the counter:**

| Who was paid | Where it goes | Supplier balance |
|---|---|---|
| The supplier, on their bill | Freight / Loading / Other on the purchase | Rises — correctly |
| Anyone else | **Landed costs** screen | **Never moves** |

Both raise the landed cost. Only the first raises the payable.

## 2. What already existed

The ERP already had a landed-cost allocator, a `LANDED` / `PURCHASE` profit basis,
and `goodsUnitCost` / `landedUnitCost` on every purchase line. I extended that
engine rather than building a second one beside it, so there is **one costing
path**, not two that can drift apart.

---

## 3. The client's test case, verified

| | |
|---|---|
| Supplier bill | **PKR 50,000** |
| Inventory purchase cost | **2,500 / bag** |
| Transport 5,000 + Loading 1,000 + Other 500 | **6,500** |
| Total inventory cost | **56,500** |
| Landed cost | **2,825 / bag** |
| Selling price | 3,500 |
| **Profit** | **675 / bag** (not 1,000) |
| **Supplier balance** | **50,000 — unchanged** |

The supplier invariant is asserted **five** times: after posting, after a second
entry, after cancelling, after posting through the screen, and after a restart.
Nothing from a landed cost appears on the supplier statement.

---

## 4. Database

Three stores, `DB_VER` 8 → 9. Purely additive — `onupgradeneeded` creates only
what is missing and leaves every existing store alone. The full suite confirms no
regression across the bump.

| Store | Holds |
|---|---|
| `landedCosts` | The entry: reference, purchase, date, total, status |
| `landedCostExpenses` | Each expense: category, description, amount, vendor, payment status, date |
| `inventoryCostAdjust` | Per line: purchase cost, additional cost, landed cost, quantity, cost per unit |

`purchases` and `payments` are **not** in the transaction store list for any write
in this module, so a landed cost cannot alter a supplier balance even by mistake.

Both figures are kept side by side. The supplier's rate is never overwritten.

---

## 5. Two deliberate choices

**Rounding never loses a rupee.** Allocating an amount that does not divide
cleanly assigns the remainder to the largest line rather than dropping it —
otherwise the inventory value would quietly disagree with the expenses.

**Cancelling reverses, it does not delete.** The entry stays on record marked
CANCELLED, the cost comes back out of the average, and a reversal is written to
cost history. Deleting would leave the books unexplainable.

---

## 6. Screens

Three entries under the existing **Finance** group:

**Landed costs** — choose a purchase, add as many expense lines as needed
(category, description, who was paid, paid/unpaid, amount), and watch the effect
before saving:

```
Supplier cost (goods)              PKR 50,000
Operational cost being added now   PKR  6,500
Final inventory cost               PKR 56,500
Cost per unit                      PKR  2,825

🔒 The supplier is owed PKR 50,000 and that does not change.
```

The history lists every entry; each opens to show its expenses and exactly how
the cost landed on each product.

**Expenses** — the existing service, given a screen, with a line explaining when
to use Landed costs instead so the two do not get mixed up.

**Profit analysis** — added *beneath* the existing profit screen rather than
replacing it (see §8).

---

## 7. Reports

**Product profit** — Product · Qty sold · Purchase cost · Additional · Landed cost
· Selling price · Profit per unit · Total profit · Margin. Purchase cost and
landed cost sit side by side, so the Additional column is visibly the difference.

**By warehouse / area** — Purchase value · Operational cost · Qty sold · Revenue ·
Cost of sales · Profit · Margin, grouped by warehouse, which is how this business
thinks about Chitral, Dir and the main godown.

Both honour a date range. Both read cost from the snapshot taken at the moment of
sale, so a later landed cost cannot rewrite the profit on a sale already made.

A banner states which basis is in use, and says where to change it if profit is
being measured against the purchase price only.

---

## 8. Two bugs the tests caught

**A page collision.** My first version of the Profit analysis screen replaced
`PAGES.profit`, which module 17 already owned — silently removing the existing
profit screen and its role messaging. Three `test-profit` checks caught it. The
landed-cost analysis now appends underneath the existing screen.

**Role switching had become one-way.** The owner-only rule added in v17 gated
*every* settings write, including `currentRole`. A warehouse user could switch
role but never switch back. `currentRole` and `lastAutoBackupAt` are now exempt —
they are session and bookkeeping, not business configuration.

---

## 9. Permissions

| Role | Landed costs | Post | Profit analysis |
|---|---|---|---|
| Owner | Yes | Yes | Yes |
| Manager | Yes | Yes | Yes |
| Accountant | Yes | **No** | Yes |
| Sales, Warehouse | No | No | No |

Posting a landed cost changes what every sale appears to have earned, so it sits
with the owner and the manager. Every post and cancel is audited with the total,
the line count and the purchase.

---

## 10. Tests

**1,009 checks, 0 failures** across 17 harnesses. `test-landed` is new: **74
checks** covering the client scenario, the supplier invariant, both costs kept
apart, allocation proportionality and rounding, validation, cancel-and-reverse,
every screen, both reports, permissions by role, and survival across a restart.

---

## 11. Remaining risks and assumptions

1. **Stock transfer costs are not implemented as transfers**, because the ERP has
   no stock-transfer feature — transfers exist only as imported legacy records.
   The store carries a `transferId` ready for it, and the warehouse report shows
   operational cost per warehouse, but moving stock Main → Chitral and costing
   that movement needs a transfer module first. **This is the one part of the
   brief not delivered**, and it needs that groundwork rather than a workaround.
2. **Cost is snapshotted at the moment of sale.** A landed cost entered *after* a
   sale does not retroactively change that sale's profit. This is deliberate —
   restating a sale already invoiced and possibly paid would be worse — but it
   means costs should be entered promptly.
3. **No live-browser visual check.** Browser automation was unavailable; screens
   are verified structurally and by content, not by eye.
4. **Allocation is by line value.** An expensive line carries more of the
   transport than a cheap one. If the business wants transport split by weight or
   by bag count instead, that is a one-line change — tell me which.
5. **Permissions are app-level, not encryption**, consistent with the rest of this
   ERP.
6. Earlier limitations stand: the warehouse PWA uses the older shared record, and
   there is no automatic off-device backup.
