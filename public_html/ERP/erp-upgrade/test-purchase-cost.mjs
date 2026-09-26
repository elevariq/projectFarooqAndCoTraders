import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import FDBKeyRange from 'fake-indexeddb/lib/FDBKeyRange';
/* The purchase screen, in the owner's own words (2026-09-26): "what do I write in Rate? is the discount for each product?
   what is the overall discount? are Delivery / Loading / Other for each bag or the whole purchase? why does 200 show as 40?"
   Answers, as the system really works — and what each bag then costs:
     Rate = price of ONE bag · line Discount = money off that whole line · Overall discount = money off the whole purchase ·
     Delivery / Loading / Other = totals for the whole purchase (spread over the bags: 200 ÷ 5 bags = 40) · Amount paid = for the whole purchase.
   Bug fixed here: the overall discount lowered the bill but NOT the cost of each bag. */
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
  const M=win.Money, D=win.document;
  const $=s=>D.querySelector(s);
  const click=el=>el&&el.dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true}));
  const type=(el,v)=>{if(el){el.value=v;el.dispatchEvent(new win.Event('input',{bubbles:true}));}};
  const wh=win.WAREHOUSES[1].id, P=win.PRODUCTS.filter(p=>p.active!==false);
  const A=P[3], B=P[4], C=P[5];
  const mill=win.SUPPLIERS[0].id;

  /* ── charges are totals for the whole purchase, shared over the bags ── */
  const pC=await ERP.Purchases.save({supplierId:mill,warehouseId:wh,purchaseDate:'2026-09-26',otherCharges:200,items:[{productId:A.id,quantity:5,unitPrice:6000}]});
  const itC=ERP.Purchases.items(pC.id)[0];
  check('C1 200 typed under Other charges for 5 bags is 40 per bag (not 200): each bag costs 6,040',
    itC.chargeShare===M.toP(200) && itC.landedUnitCost===M.toP(6040), M.fmt(itC.landedUnitCost));
  check('C2 the supplier bill is 30,000 + 200 = 30,200 (the charges are on the same bill)', pC.grandTotal===M.toP(30200), M.fmt(pC.grandTotal));

  /* ── the overall discount must lower the cost of every bag (it used to lower only the bill) ── */
  const pD=await ERP.Purchases.save({supplierId:mill,warehouseId:wh,purchaseDate:'2026-09-26',invoiceDiscount:500,otherCharges:200,items:[{productId:B.id,quantity:5,unitPrice:6000}]});
  const itD=ERP.Purchases.items(pD.id)[0];
  check('D1 the bill is 30,000 − 500 + 200 = 29,700', pD.grandTotal===M.toP(29700), M.fmt(pD.grandTotal));
  check('D2 each bag costs 5,940: 6,000 − 100 (500 ÷ 5) + 40 (200 ÷ 5) — the discount is in the cost, not only in the bill',
    itD.goodsUnitCost===M.toP(5900) && itD.landedUnitCost===M.toP(5940), M.fmt(itD.goodsUnitCost)+' / '+M.fmt(itD.landedUnitCost));
  check('D3 the stock\'s recorded cost follows: 5,940', ERP.Inventory.costOf(B.id,wh)===M.toP(5940), M.fmt(ERP.Inventory.costOf(B.id,wh)));

  /* a discount on a LINE is money off that whole line, and is already in the cost */
  const pL=await ERP.Purchases.save({supplierId:mill,warehouseId:wh,purchaseDate:'2026-09-26',items:[{productId:C.id,quantity:5,unitPrice:6000,discount:500}]});
  const itL=ERP.Purchases.items(pL.id)[0];
  check('L1 a line discount of 500 on 5 bags is 100 off each bag (500 for the whole line): bill 29,500, each bag 5,900',
    pL.grandTotal===M.toP(29500) && itL.landedUnitCost===M.toP(5900), M.fmt(pL.grandTotal)+' / '+M.fmt(itL.landedUnitCost));

  /* two products: the charges and the overall discount are shared by value */
  const pT=await ERP.Purchases.save({supplierId:mill,warehouseId:wh,purchaseDate:'2026-09-26',invoiceDiscount:1000,otherCharges:400,
    items:[{productId:P[6].id,quantity:10,unitPrice:5000},{productId:P[7].id,quantity:10,unitPrice:3000}]});
  const [i1,i2]=ERP.Purchases.items(pT.id);
  /* goods 50,000 + 30,000 = 80,000 ; discount 1,000 → 625 / 375 ; charges 400 → 250 / 150 */
  check('T1 two products: the discount (−1,000) and charges (+400) are shared by value — bags cost 4,962.5→4,963 and 2,977.5→2,978 (rounded)',
    Math.abs(i1.landedUnitCost-M.toP(4962.5))<=1 && Math.abs(i2.landedUnitCost-M.toP(2977.5))<=1, M.fmt(i1.landedUnitCost)+' / '+M.fmt(i2.landedUnitCost));

  /* ── the screen explains itself and shows the cost of each bag live ── */
  ERP.Builder.start('purchase'); await sleep(250);
  const view=()=>$('#view').textContent.replace(/\s+/g,' ');
  check('S1 the purchase screen explains Rate, Discount, Overall discount, the three charges and Amount paid in plain words',
    /Rate = the price of ONE bag/.test(view()) && /money off that whole line \(not per bag\)/.test(view()) &&
    /totals for the whole purchase/.test(view()) && /Amount paid = what you hand the supplier now for the whole purchase/.test(view()), view().slice(0,200));
  check('S2 each charge box says it is the TOTAL for the whole purchase, not per bag',
    (view().match(/NOT per bag/g)||[]).length>=3, String((view().match(/NOT per bag/g)||[]).length));
  check('S3 …and where a truck or labour paid separately belongs (the product\'s Extra cost per bag)',
    /Paid a truck or labour separately\?/.test(view()) && /Extra cost per bag/.test(view()));
  /* the explanations sit behind a small round "i": closed until pressed, closed again by a second press */
  const iBtns=Array.from(D.querySelectorAll('#view [data-fcinfo]'));
  check('I1 the purchase screen has an "i" beside the card title and beside each of the six boxes',
    iBtns.length>=6, String(iBtns.length));
  const iBox=b=>D.getElementById(b.getAttribute('data-fcinfo'));
  check('I2 every explanation starts hidden (nothing printed under the boxes)',
    iBtns.every(b=>iBox(b) && !iBox(b).classList.contains('on') && b.getAttribute('aria-expanded')==='false'));
  const chargeI=iBtns.find(b=>/NOT per bag/.test(iBox(b).textContent));
  click(chargeI);
  check('I3 pressing the "i" beside a charge box shows its explanation right there',
    iBox(chargeI).classList.contains('on') && chargeI.getAttribute('aria-expanded')==='true' && /NOT per bag/.test(iBox(chargeI).textContent));
  check('I4 …and only that one: the others stay closed', iBtns.filter(b=>iBox(b).classList.contains('on')).length===1);
  click(chargeI);
  check('I5 pressing it again hides it', !iBox(chargeI).classList.contains('on') && chargeI.getAttribute('aria-expanded')==='false');
  const guideI=iBtns.find(b=>b.title==='How a purchase is worked out');
  click(guideI);
  check('I6 the "i" by "Charges & payment" opens the whole guide (Rate, Discount, Overall discount, charges, Amount paid)',
    !!guideI && /Rate<\/b> = the price of ONE bag|Rate = the price of ONE bag/.test(iBox(guideI).textContent) && iBox(guideI).classList.contains('on'));
  click(guideI);
  check('S4 with no product yet the cost box says to add one', /Add a product to see what each bag will really cost you/.test($('#fcbCpb').textContent));
  const Bd=ERP.Builder.draft; Bd.supplierId=mill; Bd.warehouseId=wh;
  win.ERP.BuilderUI.addLine(P[8].id); await sleep(150);
  Bd.items[0].quantity='5'; Bd.items[0].unitPrice='6000'; Bd.otherCharges='200'; win.ERP.BuilderUI.refreshTotals();
  let box=$('#fcbCpb').textContent.replace(/\s+/g,' ');
  check('S5 typing 200 as Other charges for 5 bags shows: each bag costs 6,040 (charges 40 = 200 ÷ 5 bags)',
    /each bag costs PKR 6,040/.test(box) && /charges PKR 40/.test(box) && /PKR 200 ÷ 5 bags/.test(box), box);
  Bd.invoiceDiscount='500'; win.ERP.BuilderUI.refreshTotals();
  box=$('#fcbCpb').textContent.replace(/\s+/g,' ');
  check('S6 adding an overall discount of 500 lowers it to 5,940 and says the price is 5,900 after discounts',
    /each bag costs PKR 5,940/.test(box) && /PKR 5,900 after discounts/.test(box), box);
  check('S7 the screen\'s figure is exactly what the save then stores (5,940)',
    (await ERP.Purchases.save(Object.assign({},Bd,{id:undefined,clientOpId:undefined})).then(r=>ERP.Purchases.items(r.id)[0].landedUnitCost,()=>0))===M.toP(5940));

  /* ── the product's price screen shows the same cost, with the charges from the purchase in it ── */
  ERP.openPriceEditor(A.id); await sleep(300);
  const rows=$('#pzCalcRows').textContent.replace(/\s+/g,' ');
  check('P1 the price screen lists: purchase price 6,000 + charges on the purchase 40 = total cost per bag 6,040',
    /Purchase price\s*PKR 6,000/.test(rows) && /\+ Charges on the purchase\s*PKR 40/.test(rows) && /= Total cost per bag\s*PKR 6,040/.test(rows), rows);
  type($('#panel [data-f="sell"]'),'6300');
  check('P2 at a selling price of 6,300 it shows the profit a sale will really show: 260 a bag',
    /Profit per bag\s*PKR 260/.test($('#pzCalcRows').textContent.replace(/\s+/g,' ')), $('#pzCalcRows').textContent.replace(/\s+/g,' '));
  check('P3 the banner says the charges are 40 a bag, from the purchase',
    /already carry PKR 40 per bag/.test($('#pzLanded').textContent.replace(/\s+/g,' ')), $('#pzLanded') && $('#pzLanded').textContent);
  check('P4 the Purchase price hint says where the number comes from',
    /reference price/.test($('#panel').textContent) && /each purchase really cost/.test($('#panel').textContent));
  const pI=Array.from(D.querySelectorAll('#panel [data-fcinfo]'));
  check('P5 the price screen\'s explanations are behind "i" buttons too (purchase price, extra cost, selling price, minimum)', pI.length>=4, String(pI.length));
  const buyI=pI.find(b=>/reference price/.test(D.getElementById(b.getAttribute('data-fcinfo')).textContent));
  check('P6 the one for Purchase price is closed, then opens on a press',
    !D.getElementById(buyI.getAttribute('data-fcinfo')).classList.contains('on') && (click(buyI), D.getElementById(buyI.getAttribute('data-fcinfo')).classList.contains('on')));
  check('P7 a warning that matters stays visible without pressing anything (the "counted twice" banner is not behind an i)',
    !!$('#pzLanded') && !$('#pzLanded').closest('.fc-info'));
  check('X nothing threw', errors.length===0, errors.slice(0,2).join(' | '));
  win.close();
  console.log('\n'+out.join('\n')+'\n\n'+pass+' passed, '+fail+' failed\n');
  process.exit(fail?1:0);
};
run().catch(e=>{console.error('HARNESS ERROR:',e);console.log(out.join('\n'));process.exit(2);});
