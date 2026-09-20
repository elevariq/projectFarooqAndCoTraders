# Milling and the Punjab stock — how it works in real life

This is the business story behind two screens of the ERP — **Milling** and **Stock at mills** (both under *Inventory & supply*) —
who does what on which day, how each form is filled, what the ERP keeps track of for you, and the decisions taken on the open questions.
The code-level notes are in `CLAUDE.md` ("Milling jobs" and "Stock lying at the mill"); this file is the plain-language version.

Where the words come from: two voice notes from the client (Farooq Khan's side), 2026-09-20. In short: *"We give a mill in Punjab raw
material by weight — wheat. It comes back as flour plus two or three by-products, and the weight balances (some loss in grinding).
Often the finished goods stay lying at the mill. We need to see how much weight we gave, what was made, and exactly what is still
lying there — and as loads arrive here, deduct them, so the balance left at the mill is always known and the account settles."*

## The story, start to finish

**1. We have wheat in a warehouse.** Wheat is bought like any other purchase: *Inventory & supply → Purchases → Receive stock*
(supplier = whoever sold the wheat, the warehouse it is booked to, bags and rate). Nothing milling-specific yet. If the wheat is
delivered straight to the mill and never physically touches one of our warehouses, book the purchase to the warehouse you keep
it under anyway; the next step takes it out of that warehouse the same minute. (Decision 1 below.)

**2. We hand the wheat to the Punjab mill — a Milling job.** *Milling → New milling job.* One job = one handover of wheat and what
the mill says it made from it.

| Box on the form | What to enter |
|---|---|
| **Mill** | The mill (it is one of the *Suppliers*; 25 of the 32 suppliers are mills). |
| **Wheat taken from warehouse** | The warehouse the wheat leaves from. |
| **Where are the finished goods?** | **Still at the mill (Punjab)** — the normal case, and the default. Choose *Already in our warehouse* only when the flour comes straight to us. |
| **Date, Settlement** | Date of the handover. *Net off against the mill's account* is the normal case; *Grinding fee only* if the wheat stays ours and the mill only charges for grinding. |
| **Issued — wheat out** | Product, **bags** and **weight (kg)** (the weight fills in from the bag size — 49 kg × bags — and can be overtyped with the weighbridge figure), and the **rate** that values the wheat. |
| **Made at the mill — finished goods** | One line each for the flour and every by-product (chokar, and so on): bags, kg, rate — as the mill reports it. |
| **Milling fee / Notes** | Optional. |

While typing, the form shows **weight issued, weight received and the process loss (kg and %)**, and the net amount owed to or by the mill.
A loss outside roughly 1–8 % is only *flagged*; more weight coming out than went in is refused (grinding cannot create weight).

*What Save does:* the wheat comes out of the warehouse's stock. The mill's own account (*Suppliers → statement*) is updated: wheat
issued on one side, finished goods made on the other (plus the fee), so only the net difference is owed. **The flour and by-products
do not enter any warehouse** — they are recorded as *lying at the mill*.

**3. Anyone can now see what is in Punjab — Stock at mills.** *Inventory & supply → Stock at mills.* Pick one mill or all:
*wheat given (kg)*, *made at the mill (bags, kg, loss)*, *arrived here*, *still at the mill (bags, kg, worth)*, then one line per mill and
product: made / arrived / **at the mill**. This replaces the paper page. Example from the client: 30,000 bags of flour made → the screen
says **30,000 bags at the mill**, none in any warehouse.

**4. A truck leaves the mill for us — Goods arrived.** On *Stock at mills*, **Goods arrived** (the button is greyed out when nothing is
lying anywhere).

| Box | What to enter |
|---|---|
| **Mill** | Only mills that still have goods lying are offered. |
| **Arrived in warehouse** | Where the truck was unloaded (it starts as the warehouse the wheat came from). |
| **Date arrived, Vehicle / bilti no.** | Date and the truck / consignment number, so the load can be traced. |
| **What arrived** | Product (the list shows the full name and **"N bags at the mill"** beside each), bags, weight (auto-filled, editable). |

The form shows *at the mill now → this load → still there after*, and refuses more bags than the mill holds. **Record arrival** adds
the bags to that warehouse's stock and takes them off the mill's balance, and opens a printable **"Goods received from mill"** slip
(signatures: sent by the mill / received by the warehouse). **No money moves on an arrival** — the value was already put on the
mill's account in step 2.

**5. Repeat until the mill is clear.** 12,000 bags arrive → 18,000 still at the mill → more loads → the row shows **All received**.
If a load weighs a little more or less than the mill wrote, the bags reach zero and the leftover is shown as a *weight difference*, not as stock.

**6. The goods are now ordinary stock.** Once arrived they sit in the warehouse like anything else: they can be sold, transferred, and they
appear in *Stock value*. **While they are still at the mill they are shown separately** ("Lying at mills") beside the stock value, never
added to it (Decision 2).

**7. Paying the mill.** The mill's khata already carries the milling job (and the fee). Payments to or from the mill go through the
normal payment screens; *Suppliers → Statement of Account* shows the milling lines ("Wheat issued", "Finished goods made at the mill",
"Milling fee") with the running balance.

**8. Mistakes.** A load entered wrongly → **Cancel** it on *Stock at mills*: the bags leave the warehouse and go back to "at the mill".
A job entered wrongly → **Cancel** it on *Milling* (stock and the mill's account reverse) — but only if none of its goods has arrived yet;
cancel those arrivals first. Nothing is edited in place; everything is corrected by cancelling and re-entering, and every step is in the audit log.

## Where the website helps (versus the paper khata)

* One number for "what is lying in Punjab right now", per mill and per product, instead of adding up a paper page.
* The **weight balance** — wheat given vs. finished goods made vs. loss % — computed and sanity-checked on entry.
* It is **impossible to receive more than the mill holds**, and impossible to lose track of what has come: every load is a numbered record (MAR-…)
  with the vehicle, the date and a printable slip.
* The money and the goods stay consistent: the mill's account is settled from the job; the goods move on arrivals.
* Shared and safe: it works from any phone; two people saving at once cannot double-receive the same bags (the second save is refused and asks to reload).
* Excel and print for the accountant; the owner sees the worth of what is lying in Punjab on the Stock value screen and the dashboard.

## Who does what (decision 3)

| Task | Roles | Why |
|---|---|---|
| Milling job, Goods arrived, cancels | Owner, Manager (and anyone given *purchase* rights) | It is money- and stock-changing, like Purchases. |
| Viewing Stock at mills | Same roles | It shows costs. |
| Warehouse staff | Hand over the printed slip / tell the accountant | They are not given purchase rights today. Splitting a "record arrivals" right for warehouse staff is a small change if the client wants it. |

## Decisions on the open questions (2026-09-21) — recommended answers, taken for now

1. **Where does the wheat come from?** *Decision: from our own books — record the wheat purchase first, then the milling job.* Reason: the notes
   say the wheat is *bought* and *given by weight*; recording the purchase keeps what we owe the wheat seller, the cost per bag and the stock
   honest. The alternative ("wheat did not come from our stock", skipping the stock check) would leave wheat that was never bought on
   paper. If the client finds the extra step heavy, revisit with a "book straight to the mill" option (not built).
2. **Should goods lying at the mill count in the totals?** *Decision: shown beside the stock value, never inside it* — **built** (Stock value
   screen card, dashboard card line, Inventory strip, print and Excel, all "Lying at mills — not in the stock value"). Reason: the owner wants
   to see everything the company owns including Punjab; but the bags cannot be sold from a warehouse shelf until they arrive, so they must not
   inflate the warehouse figure or the available-to-sell quantities.
3. **Who records arrivals?** *Decision: the roles that can record purchases* (table above).
4. **Which rates go on the job?** *Decision: the agreed rates, on the mill's own page, as on the paper khata* (rate per kg or per bag, chosen per line).
   Use *Grinding fee only* if the wheat never changes ownership.
5. **One job per what?** *Decision: one job per handover of wheat* (per batch), so each has its own loss %; several jobs can be lying at the same mill at once — the screen adds them up.
6. **The 1–8 % loss band** is only a warning and is a starting guess — confirm the mill's normal loss with the client and adjust the band if needed.
7. **A running in / out / balance statement per mill** (the top half of the client's paper page — آمد / نکاس / باقی): *recommended next step, not built.*
   Today you get the current balance per product plus the list of loads; a dated running statement (per mill, per product) is the natural addition, with Print/Excel.

**Still to confirm with the client:** the mills' usual loss %; whether warehouse staff should be allowed to record arrivals; whether the printed
arrival slip needs the client's own layout/wording; and whether the wheat is ever supplied by the mill itself (then the purchase is *from* the mill).
