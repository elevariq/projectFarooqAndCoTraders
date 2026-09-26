import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import FDBKeyRange from 'fake-indexeddb/lib/FDBKeyRange';
/* The product's "Extra cost per bag" is an AVERAGE carried by the stock, like the purchase price (2026-09-26).
   Client: "when the extra cost changes, the bags already in stock must keep the old one — new bags bring the
   new one, and a sale uses the average". Each stock row carries `avgExtraP`: bags coming in (purchase, Add stock,
   opening stock) blend in the product's extra of THAT day by quantity; sales do not move it; a transfer or a
   brand conversion carries the source's figure; a purchase / receipt edit does not re-price the bags around it.
   Editing the product's extra pins the rows that were still following it, and the FIRST extra typed on a product
   that had none covers the bags already held. Extra never enters avgCostP / Stock value. */
const HTML=fs.readFileSync('dist/farooq-co-erp.html','utf8');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0;const out=[];
const check=(n,c,d)=>{if(c){pass++;out.push('  ✔ '+n);}else{fail++;out.push('  ✘ '+n+(d?'   → '+d:''));}};
const errors=[];
function boot(store){
  const vc=new VirtualConsole(); vc.on('jsdomError',e=>errors.push(e.message));
  const dom=new JSDOM(HTML,{runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,
   url:'https://x.local/e',beforeParse(w){
    w.indexedDB=store.idb; w.IDBKeyRange=FDBKeyRange; w.print=()=>{}; w.confirm=()=>true;
    w.prompt=()=>'not needed'; w.scrollTo=()=>{}; w.open=()=>null;
    w.URL.createObjectURL=()=>'b'; w.URL.revokeObjectURL=()=>{};
    w.HTMLElement.prototype.scrollIntoView=function(){};
    w.matchMedia=q=>({media:q,matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});
   }});
  return dom.window;
}
async function ready(w){for(let i=0;i<400&&!(w.ERP&&w.ERP.ready);i++)await sleep(25);await sleep(350);return w.ERP;}

const run=async()=>{
  const store={idb:new FDBFactory()};
  const win=boot(store); const ERP=await ready(win);
  const M=win.Money, R=M.toP, SD=ERP.StockDocs;
  const whs=win.WAREHOUSES.filter(x=>x.active!==false), wh=whs[1].id, wh2=whs[2].id;
  const P=win.PRODUCTS.filter(p=>p.active!==false);
  const shop=win.CUSTOMERS[0].id, mill=win.SUPPLIERS[0].id;
  const setExtra=(p,x)=>ERP.Prices.set(p.id,{extra:x},{reason:'transport rate changed'});
  const buy=(p,q,price,date)=>ERP.Purchases.save({supplierId:mill,warehouseId:wh,purchaseDate:date||'2026-09-20',
    items:[{productId:p.id,quantity:q,unitPrice:price}]});
  const sell=(p,q)=>ERP.Invoices.save({customerId:shop,warehouseId:wh,invoiceDate:'2026-09-25',
    items:[{productId:p.id,quantity:q,unitPrice:9000}]});
  const cost=(p,w)=>ERP.Cost.forSale(p.id,w||wh);
  const avgX=(p,w)=>{const r=ERP.S.inventory[p.id+'|'+(w||wh)];return r?r.avgExtraP:undefined;};

  /* ═══ A. the client's own example: 100 bags at 200, the transport goes to 300, 100 more bags ═══ */
  const A=P[5];
  await ERP.Prices.set(A.id,{buy:3000,extra:200,sell:3600},{reason:'setup'});
  await buy(A,100,3000);
  check('A1 100 bags bought with an extra of 200 cost 3,200 to sell', cost(A)===R(3200), M.fmt(cost(A)));
  await setExtra(A,300);
  check('A2 the extra is now 300 on the product — the 100 bags in stock still carry 200 (3,200)',
    cost(A)===R(3200) && ERP.Prices.of(A.id).extra===R(300), M.fmt(cost(A)));
  await buy(A,100,3000);
  check('A3 after 100 more bags at 300 the average extra is 250 → 3,250', cost(A)===R(3250) && avgX(A)===R(250),
    M.fmt(cost(A))+' / '+avgX(A));
  check('A4 stock value and the purchase-price average never carry the extra (3,000)',
    ERP.Inventory.costOf(A.id,wh)===R(3000));

  /* ═══ B. sales use the average and do not move it; later lots blend by the bags LEFT ═══ */
  const inv=await sell(A,60);
  check('B1 60 bags sold: costed at the average 3,250 on the invoice', ERP.Invoices.items(inv.id)[0].costSnapshot===R(3250),
    M.fmt(ERP.Invoices.items(inv.id)[0].costSnapshot));
  check('B2 selling does not move the average extra', avgX(A)===R(250) && cost(A)===R(3250));
  await setExtra(A,400);
  await buy(A,60,3000);
  /* 140 left at 250, 60 new at 400 → (140*250 + 60*400)/200 = 295 */
  check('B3 60 more at 400 blend with the 140 bags left, not with everything ever bought: 295 → 3,295',
    avgX(A)===R(295) && cost(A)===R(3295), avgX(A)+' / '+M.fmt(cost(A)));
  check('B4 the earlier invoice keeps its cost', ERP.Invoices.items(inv.id)[0].costSnapshot===R(3250));

  /* ═══ C. bags that are gone do not drag the new figure ═══ */
  const C=P[6];
  await ERP.Prices.set(C.id,{buy:2000,extra:100,sell:2600},{reason:'setup'});
  await buy(C,10,2000);
  await sell(C,10);
  await setExtra(C,500);
  await buy(C,10,2000);
  check('C1 all the old bags were sold, so the new lot is at exactly 500 → 2,500', avgX(C)===R(500) && cost(C)===R(2500),
    avgX(C)+' / '+M.fmt(cost(C)));

  /* ═══ D. the first extra typed on a product covers the bags already held; 0 later does not un-cost them ═══ */
  const D=P[7];
  await buy(D,50,2000);
  check('D1 no extra yet: cost is the purchase price', cost(D)===R(2000));
  await ERP.Prices.set(D.id,{extra:150},{reason:'first time'});
  check('D2 the first extra (150) covers the 50 bags already held → 2,150', cost(D)===R(2150) && avgX(D)===R(150), M.fmt(cost(D)));
  await setExtra(D,0);
  check('D3 setting the extra to 0 (moving to Landed costs) leaves the bags in stock costed at 150', cost(D)===R(2150));
  await buy(D,50,2000);
  check('D4 100 bags: 50 at 150, 50 at 0 → average 75 → 2,075', avgX(D)===R(75) && cost(D)===R(2075), avgX(D)+' / '+M.fmt(cost(D)));
  await ERP.Prices.set(D.id,{extra:150},{reason:'again'});
  check('D5 a later first-time-style change does not overwrite bags that already carry an extra', avgX(D)===R(75));

  /* ═══ E. a row from before this change follows the product until the extra is edited ═══ */
  const E=P[8];
  await buy(E,20,1000);
  await ERP.Prices.set(E.id,{extra:50},{reason:'setup'});
  const row=ERP.S.inventory[E.id+'|'+wh]; delete row.avgExtraP;                 /* what an old stored row looks like */
  check('E1 an unblended row costs at the product\'s current extra (behaves as before)', cost(E)===R(1050));
  win.prodOf(E.id).extraP=R(80); win.prodOf(E.id).extra=80;
  check('E2 …and follows it when the figure is changed behind its back', cost(E)===R(1080));
  win.prodOf(E.id).extraP=R(50); win.prodOf(E.id).extra=50;
  await setExtra(E,90);
  check('E3 editing the extra through Product prices pins the old row at the OLD figure (50)', avgX(E)===R(50) && cost(E)===R(1050),
    avgX(E)+' / '+M.fmt(cost(E)));

  /* ═══ F. transfers carry the source's extra, not today's ═══ */
  const F=P[9];
  await ERP.Prices.set(F.id,{buy:3000,extra:200,sell:3600},{reason:'setup'});
  await buy(F,100,3000);
  await setExtra(F,400);
  await SD.transfer({warehouseId:wh,toWarehouseId:wh2,date:'2026-09-25',reason:'move',items:[{productId:F.id,quantity:40}]});
  check('F1 40 bags moved to the other warehouse arrive carrying 200, not the new 400',
    avgX(F,wh2)===R(200) && cost(F,wh2)>0 && avgX(F,wh)===R(200), avgX(F,wh2)+' / '+avgX(F,wh));
  await buy(F,10,3000);
  check('F2 the sending warehouse then blends normally: 60 at 200 + 10 at 400 → 229', avgX(F,wh)===Math.round((60*R(200)+10*R(400))/70),
    String(avgX(F,wh)));

  /* ═══ G. editing a purchase does not re-price the bags around it ═══ */
  const G=P[10];
  await ERP.Prices.set(G.id,{buy:3000,extra:200,sell:3600},{reason:'setup'});
  const gA=await buy(G,100,3000,'2026-09-01');
  await setExtra(G,300);
  const gB=await buy(G,100,3000,'2026-09-02');
  check('G0 two lots, 200 and 300, average 250', avgX(G)===R(250));
  const d=ERP.Purchases.toDraft(ERP.Purchases.byId(gA.id)); d.id=gA.id; d.notes='checked';
  await ERP.Purchases.save(d);
  check('G1 editing the FIRST purchase (a note) leaves the average at 250', avgX(G)===R(250) && cost(G)===R(3250),
    avgX(G)+' / '+M.fmt(cost(G)));
  const it=ERP.Purchases.items(gA.id)[0];
  check('G2 that purchase line still remembers the 200 it came in with', it.extraUnitP===R(200), String(it.extraUnitP));
  const d2=ERP.Purchases.toDraft(ERP.Purchases.byId(gA.id)); d2.id=gA.id; d2.items[0].quantity=120;
  await ERP.Purchases.save(d2);
  /* 20 more bags, at the line's own 200: (100*250-?)… the row is 100@200 + 100@300 → after edit 120@200 + 100@300 */
  check('G3 raising its quantity adds the extra bags at ITS extra (200): (120*200+100*300)/220 ≈ 245', avgX(G)===Math.round((120*R(200)+100*R(300))/220),
    String(avgX(G)));

  /* ═══ H. an Add-stock receipt and its edit ═══ */
  const H=P[11];
  await ERP.Prices.set(H.id,{extra:100},{reason:'setup'});
  const rcp=await SD.receive({warehouseId:wh,date:'2026-09-05',reason:'count',items:[{productId:H.id,quantity:30,unitPrice:1500}]});
  check('H1 Add stock brings the bags in at the product\'s extra of the day (100)', avgX(H)===R(100));
  await setExtra(H,300);
  await SD.receive({warehouseId:wh,date:'2026-09-06',reason:'count',items:[{productId:H.id,quantity:30,unitPrice:1500}]});
  check('H2 a second receipt at 300 → average 200', avgX(H)===R(200), String(avgX(H)));
  const dr=SD.toDraft(SD.byId(rcp.id)); dr.items[0].quantity=40;
  await SD.editReceive(dr);
  check('H3 correcting the FIRST receipt to 40 bags keeps its own 100: (40*100+30*300)/70 ≈ 186',
    avgX(H)===Math.round((40*R(100)+30*R(300))/70), String(avgX(H)));

  /* ═══ I. the profit basis ═══ */
  await ERP.Settings.save({profitCostBasis:'PURCHASE'});
  check('I1 on the "purchase price only" basis the extra is left out', cost(A)===R(3000));
  await ERP.Settings.save({profitCostBasis:'LANDED'});
  check('I2 back on landed it is there again, untouched', cost(A)===R(3295));

  /* ═══ J. a later delivery on the same purchase uses that purchase's extra ═══ */
  const J=P[12];
  await ERP.Prices.set(J.id,{buy:1000,extra:60,sell:1400},{reason:'setup'});
  const jp=await ERP.Purchases.save({supplierId:mill,warehouseId:wh,purchaseDate:'2026-09-20',
    items:[{productId:J.id,quantity:100,receivedQty:40,unitPrice:1000}]});
  await setExtra(J,120);
  await ERP.Purchases.receiveMore(jp.id,[{itemId:ERP.Purchases.items(jp.id)[0].id,quantity:60}]);
  check('J1 the 60 bags delivered later still carry the 60 the purchase was made with (no re-price)', avgX(J)===R(60), String(avgX(J)));

  check('Z nothing threw during the session', errors.length===0, errors.slice(0,2).join(' | '));
  win.close();
  console.log('\n'+out.join('\n')+'\n\n'+pass+' passed, '+fail+' failed\n');
  process.exit(fail?1:0);
};
run().catch(e=>{console.error('HARNESS ERROR:',e);console.log(out.join('\n'));process.exit(2);});
