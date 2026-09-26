import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import FDBKeyRange from 'fake-indexeddb/lib/FDBKeyRange';
/* Customer returns, edge cases found 2026-09-26 while checking the client's test day:
   (1) the "Warehouse receiving" box took the FIRST warehouse in the list, not the one the bags were sold from;
   (2) a quantity that is too large was refused only AFTER the panel had closed ("Posting return…" looked like success);
   (3) editing an invoice that has a return rewrote its lines under new ids, orphaning the return — the same
       bags could then be returned again, and the invoice's returned status was lost. */
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
  const whs=(win.activeWh?win.activeWh():win.WAREHOUSES).map(w=>w.id);
  const wh=whs[whs.length-1];                    /* deliberately NOT the first warehouse in the list */
  const X=win.PRODUCTS.filter(p=>p.active!==false)[3];
  const shop=win.CUSTOMERS[0].id, mill=win.SUPPLIERS[0].id;

  await ERP.Purchases.save({supplierId:mill,warehouseId:wh,purchaseDate:'2026-09-20',
    items:[{productId:X.id,quantity:20,unitPrice:6000}]});
  const inv=await ERP.Invoices.save({customerId:shop,warehouseId:wh,invoiceDate:'2026-09-27',
    items:[{productId:X.id,quantity:5,unitPrice:6300}]});
  const inv2=await ERP.Invoices.save({customerId:shop,warehouseId:wh,invoiceDate:'2026-09-26',
    items:[{productId:X.id,quantity:2,unitPrice:6300}]});
  check('R0 setup: the invoice was made in a warehouse that is not first in the list', whs.length>1 && whs[0]!==wh, whs.join(','));

  win.openPanel('creditnote'); await sleep(300);
  const panel=$('#panel');
  check('R1 the Warehouse receiving box opens on the warehouse the invoice was sold from',
    $('#panel [data-f="wid"]').value===wh, $('#panel [data-f="wid"]').value+' vs '+wh);

  /* too many bags: refused INSIDE the panel, which stays open */
  const box=$('#panel [data-fcret="'+ERP.Invoices.items(inv.id)[0].id+'"]');
  type(box,'9'); click($('#panel [data-save]')); await sleep(300);
  check('R2 asking for more bags than were sold says so inside the panel (not after it has closed)',
    /only 5 can still come back/i.test($('#panelErr').textContent), $('#panelErr').textContent);
  check('R3 nothing was posted', ERP.Returns.customerAll().length===0);
  type(box,'1.2.3'); click($('#panel [data-save]')); await sleep(250);
  check('R4 a garbled quantity ("1.2.3") is refused inside the panel too', /not a valid number/i.test($('#panelErr').textContent), $('#panelErr').textContent);

  /* a proper return: 3 of 5 */
  const before=ERP.Inventory.available(X.id,wh);
  type(box,'3'); click($('#panel [data-save]')); await sleep(600);
  check('R5 a good return posts: 3 bags back in the SAME warehouse, credit 3 × 6,300',
    ERP.Returns.customerAll().length===1 && ERP.Inventory.available(X.id,wh)===before+3 &&
    ERP.Returns.customerAll()[0].creditAmount===M.toP(18900) && ERP.Returns.customerAll()[0].warehouseId===wh,
    JSON.stringify(ERP.Returns.customerAll().map(r=>[r.warehouseId,r.creditAmount])));
  check('R6 the invoice is marked partially returned', ERP.Invoices.byId(inv.id).status==='PARTIALLY_RETURNED', ERP.Invoices.byId(inv.id).status);

  /* the edit that used to orphan the return */
  const draft=ERP.Invoices.toDraft(ERP.Invoices.byId(inv.id));
  draft.id=inv.id; draft.clientOpId=inv.clientOpId; draft.revision=ERP.Invoices.byId(inv.id).revision; draft.existing=true;
  draft.items[0].quantity=6;
  const refused=await ERP.Invoices.save(draft,{draft:false}).then(()=>false).catch(e=>/already has a return/i.test((e.validation||[])[0]||''));
  check('R7 editing an invoice that has a return is refused, with the return number', refused===true);
  check('R8 its line, returned quantity and status are untouched',
    ERP.Returns.returnableQty(ERP.Invoices.items(inv.id)[0].id)===2 && ERP.Invoices.byId(inv.id).status==='PARTIALLY_RETURNED');

  /* an invoice WITHOUT a return can still be edited */
  const d2=ERP.Invoices.toDraft(ERP.Invoices.byId(inv2.id));
  d2.id=inv2.id; d2.clientOpId=inv2.clientOpId; d2.revision=ERP.Invoices.byId(inv2.id).revision; d2.existing=true;
  d2.items[0].quantity=3;
  const edited=await ERP.Invoices.save(d2,{draft:false}).then(()=>true).catch(e=>false);
  check('R9 an invoice with no return is still editable', edited===true && ERP.Invoices.items(inv2.id)[0].quantity===3);

  /* "What happens to the money": a REFUND only gives back money that was actually paid */
  const shopB=win.CUSTOMERS[5].id, shopC=win.CUSTOMERS[6].id;
  const unpaid=await ERP.Invoices.save({customerId:shopB,warehouseId:wh,invoiceDate:'2026-09-26',paidAmount:0,
    items:[{productId:X.id,quantity:5,unitPrice:6300}]});
  const uItem=ERP.Invoices.items(unpaid.id)[0];
  const ref1=await ERP.Returns.fromCustomer({invoiceId:unpaid.id,warehouseId:wh,treatment:'REFUND',reason:'Damaged product',
    items:[{invoiceItemId:uItem.id,quantity:3,condition:'SELLABLE'}]}).then(()=>null).catch(e=>(e.validation||[])[0]);
  check('R11 refunding an UNPAID invoice is refused (it would pay out cash never received and leave the shop owing everything)',
    /only give back money the shop has paid/i.test(ref1||''), ref1);
  check('R12 nothing was posted for it: no return, no cash out, balance unchanged',
    !ERP.Returns.customerAll().some(r=>r.invoiceId===unpaid.id) && ERP.Ledger.customerBalance(shopB)===M.toP(31500));
  win.openPanel('creditnote'); await sleep(250);
  $('#panel [data-f="invoice"]').value=unpaid.id; $('#panel [data-f="invoice"]').dispatchEvent(new win.Event('change',{bubbles:true})); await sleep(120);
  $('#panel [data-f="treatment"]').value='REFUND';
  type($('#panel [data-fcret="'+uItem.id+'"]'),'3'); click($('#panel [data-save]')); await sleep(300);
  check('R13 the same refusal shows inside the return screen',
    /only give back money the shop has paid/i.test($('#panelErr').textContent), $('#panelErr').textContent);
  click($('#panel [data-close]')); await sleep(120);
  check('R14 "Reduce what the shop owes" on the same unpaid invoice is fine: 31,500 − 18,900 = 12,600',
    (await ERP.Returns.fromCustomer({invoiceId:unpaid.id,warehouseId:wh,treatment:'ADJUST_OUTSTANDING_BALANCE',reason:'Damaged product',
      items:[{invoiceItemId:uItem.id,quantity:3,condition:'SELLABLE'}]}),
     ERP.Ledger.customerBalance(shopB)===M.toP(12600)), M.fmt(ERP.Ledger.customerBalance(shopB)));

  const paid=await ERP.Invoices.save({customerId:shopC,warehouseId:wh,invoiceDate:'2026-09-26',paidAmount:31500,
    items:[{productId:X.id,quantity:5,unitPrice:6300}]});
  const pItem=ERP.Invoices.items(paid.id)[0];
  await ERP.Returns.fromCustomer({invoiceId:paid.id,warehouseId:wh,treatment:'REFUND',reason:'Damaged product',
    items:[{invoiceItemId:pItem.id,quantity:3,condition:'SELLABLE'}]});
  check('R15 refunding a PAID invoice works: 18,900 cash goes out and the shop\'s balance stays at 0',
    ERP.Payments.refunds().some(p=>p.amount===M.toP(18900)) && ERP.Ledger.customerBalance(shopC)===0, M.fmt(ERP.Ledger.customerBalance(shopC)));
  const ref2=await ERP.Returns.fromCustomer({invoiceId:paid.id,warehouseId:wh,treatment:'REFUND',reason:'Damaged product',
    items:[{invoiceItemId:pItem.id,quantity:2,condition:'SELLABLE'}]}).then(()=>'posted').catch(e=>e.validation[0]);
  check('R16 the remaining 2 bags (12,600) can still be refunded — paid 31,500 covers 18,900 + 12,600',
    ref2==='posted', ref2);
  /* screens after a FULL return: the sale and the profit must not still read as if the bags were kept (client, 2026-09-26) */
  const nowD=new Date(), today=nowD.getFullYear()+'-'+String(nowD.getMonth()+1).padStart(2,'0')+'-'+String(nowD.getDate()).padStart(2,'0');
  const shopD=win.CUSTOMERS[7].id;
  const invD=await ERP.Invoices.save({customerId:shopD,warehouseId:wh,invoiceDate:today,paidAmount:0,items:[{productId:X.id,quantity:5,unitPrice:6300}]});
  const soldOnly=ERP.Reports.sales(today,today);
  const profitBefore=ERP.Profit.report(today,today,{by:'none'}).totals.netProfit;
  await ERP.Returns.fromCustomer({invoiceId:invD.id,warehouseId:wh,treatment:'ADJUST_OUTSTANDING_BALANCE',reason:'Damaged product',
    items:[{invoiceItemId:ERP.Invoices.items(invD.id)[0].id,quantity:5,condition:'SELLABLE'}]});
  const back=ERP.Reports.sales(today,today);
  /* other invoices in this test are dated today too, so compare the CHANGE: this sale earned 5 × (6,300 − 6,000) = 1,500 */
  check('R17 taking all 5 bags back removes exactly that sale\'s profit (1,500) from the Sales report; the gross figure is unchanged',
    soldOnly.netProfit-back.netProfit===M.toP(1500) && back.grossProfit===soldOnly.grossProfit, M.fmt(soldOnly.netProfit)+' → '+M.fmt(back.netProfit));
  check('R18 the Profit screen\'s net figure (which the dashboard table now reads) drops by the same 1,500',
    profitBefore-ERP.Profit.report(today,today,{by:'none'}).totals.netProfit===M.toP(1500));
  check('R19 the shop\'s own account is 0 after a full return (sale and credit note shown as two lines)',
    ERP.Ledger.customerBalance(shopD)===0);
  win.go('dashboard'); await sleep(250);
  const dash=D.querySelector('#view').textContent.replace(/\s+/g,' ');
  const todayKpi=Array.from(D.querySelectorAll('.kpi')).find(k=>/Today's sales/.test(k.textContent));
  check('R20 the dashboard\'s "Today\'s sales" no longer counts a sale that came back in full',
    !!todayKpi && !/31,?500/.test(todayKpi.textContent) && /returned/i.test(todayKpi.textContent), todayKpi&&todayKpi.textContent.replace(/\s+/g,' '));
  check('R21 the dashboard profit table says its sales are after returns', /Sales \(after returns\)/.test(dash));
  /* the same return posted twice at once (a double click): one return, one set of bags back — never 10 where there should be 5 */
  const shopE=win.CUSTOMERS[8].id;
  const invE=await ERP.Invoices.save({customerId:shopE,warehouseId:wh,invoiceDate:'2026-09-26',items:[{productId:X.id,quantity:5,unitPrice:6300}]});
  const stockBeforeE=ERP.Inventory.available(X.id,wh);
  const optsE={invoiceId:invE.id,warehouseId:wh,treatment:'ADJUST_OUTSTANDING_BALANCE',reason:'Damaged product',
    items:[{invoiceItemId:ERP.Invoices.items(invE.id)[0].id,quantity:5,condition:'SELLABLE'}]};
  const twice=await Promise.allSettled([ERP.Returns.fromCustomer(Object.assign({},optsE)),ERP.Returns.fromCustomer(Object.assign({},optsE))]);
  check('R22 a double-pressed return: one is posted, the other is refused with a clear message',
    twice.filter(r=>r.status==='fulfilled').length===1 && twice.filter(r=>r.status==='rejected').length===1 &&
    /already being posted/i.test(((twice.find(r=>r.status==='rejected')||{}).reason||{validation:['']}).validation[0]),
    JSON.stringify(twice.map(r=>r.status)));
  check('R23 the bags came back once: +5, not +10', ERP.Inventory.available(X.id,wh)===stockBeforeE+5,
    ERP.Inventory.available(X.id,wh)+' vs '+(stockBeforeE+5));
  check('R24 one credit note, and the shop\'s account is 0 (not −31,500)',
    ERP.Returns.customerAll().filter(r=>r.invoiceId===invE.id).length===1 && ERP.Ledger.customerBalance(shopE)===0,
    String(ERP.Ledger.customerBalance(shopE)));
  const again=await ERP.Returns.fromCustomer(Object.assign({},optsE)).then(()=>'posted').catch(e=>(e.validation||[''])[0]);
  check('R25 afterwards the lock is released: a genuine second attempt gets the normal "nothing left to return" message',
    /most that can still be returned|Cannot return/i.test(again), again);
  /* the return screen explains the money in plain words, with the shop's real numbers */
  const shopF=win.CUSTOMERS[9].id;
  const invF=await ERP.Invoices.save({customerId:shopF,warehouseId:wh,invoiceDate:'2026-09-26',paidAmount:0,items:[{productId:X.id,quantity:5,unitPrice:6300}]});
  const fItem=ERP.Invoices.items(invF.id)[0];
  win.openPanel('creditnote'); await sleep(250);
  const fire=(el,ev)=>el.dispatchEvent(new win.Event(ev,{bubbles:true}));
  $('#panel [data-f="invoice"]').value=invF.id; fire($('#panel [data-f="invoice"]'),'change'); await sleep(120);
  const opts=Array.from(D.querySelectorAll('#panel [data-f="treatment"] option')).map(o=>o.textContent);
  check('R26 the return screen offers three plain choices (the duplicate "customer credit" is gone)',
    opts.length===3 && /Take it off what the shop owes/.test(opts[0]) && /Give the money back in cash/.test(opts[1]) && /Send the same bags again/.test(opts[2]), opts.join(' | '));
  type($('#panel [data-fcret="'+fItem.id+'"]'),'2');
  const note=()=>$('#fcRetMoney').textContent.replace(/\s+/g,' ');
  check('R27 taking it off: says the bags are worth 12,600, the shop owes 31,500 now and 18,900 after',
    /worth PKR 12,600/.test(note()) && /owes PKR 31,500 now/.test(note()) && /owe PKR 18,900/.test(note()), note());
  $('#panel [data-f="treatment"]').value='REFUND'; fire($('#panel [data-f="treatment"]'),'change');
  check('R28 choosing cash back for a shop that has paid nothing says why it cannot be done', /paid only PKR 0/.test(note()), note());
  $('#panel [data-f="treatment"]').value='REPLACEMENT'; fire($('#panel [data-f="treatment"]'),'change');
  check('R29 choosing replacement says no money changes hands', /no money changes hands/.test(note()), note());
  click($('#panel [data-close]')); await sleep(120);

  /* Receive payment: money for a shop that owes nothing is not quietly turned into credit (the wrong shop was picked) */
  const owesNothing=win.CUSTOMERS[30].id, owesSome=win.CUSTOMERS[31].id;
  await ERP.Invoices.save({customerId:owesSome,warehouseId:wh,invoiceDate:'2026-09-26',paidAmount:0,items:[{productId:X.id,quantity:5,unitPrice:6300}]});
  const incBefore=ERP.Payments.incoming().length;
  win.openPanel('payment'); await sleep(250);
  const sel=$('#fcPayCust'); sel.value=owesNothing; fire(sel,'change'); await sleep(100);
  type($('#panel [data-f="amt"]'),'31000');
  check('R30 typing a payment for a shop that owes nothing warns right away',
    /owes nothing/i.test($('#fcPayBal').textContent), $('#fcPayBal').textContent.replace(/\s+/g,' '));
  click($('#panel [data-save]')); await sleep(250);
  check('R31 Save is refused inside the screen, and says how to keep it as credit on purpose',
    /no unpaid invoice/i.test($('#panelErr').textContent) && /Leave on account/.test($('#panelErr').textContent) && ERP.Payments.incoming().length===incBefore,
    $('#panelErr').textContent);
  sel.value=owesSome; fire(sel,'change'); await sleep(100);
  type($('#panel [data-f="amt"]'),'10000');
  check('R32 for a shop that does owe money it shows the balance after: 31,500 − 10,000 = 21,500',
    /Outstanding balance: PKR 31,500/.test($('#fcPayBal').textContent.replace(/\s+/g,' ')) && /after this payment: PKR 21,500/.test($('#fcPayBal').textContent.replace(/\s+/g,' ')),
    $('#fcPayBal').textContent.replace(/\s+/g,' '));
  click($('#panel [data-save]')); await sleep(500);
  check('R33 and the payment goes onto that shop\'s invoice: Paid 10,000', ERP.Payments.incoming().length===incBefore+1 &&
    ERP.Invoices.all().filter(i=>i.customerId===owesSome).reduce((a,i)=>a+ERP.Invoices.paidFor(i.id),0)===M.toP(10000));
  /* a quick second click on Save (the panel only slides out, its button stays for the animation) must not save twice */
  const shopG=win.CUSTOMERS[11].id;
  await ERP.Purchases.save({supplierId:mill,warehouseId:wh,purchaseDate:'2026-09-26',items:[{productId:X.id,quantity:50,unitPrice:6000}]});
  await ERP.Invoices.save({customerId:shopG,warehouseId:wh,invoiceDate:'2026-09-26',paidAmount:0,items:[{productId:X.id,quantity:5,unitPrice:6300}]});
  const receiptsBefore=ERP.Payments.incoming().length;
  win.openPanel('payment'); await sleep(250);
  const gSel=$('#fcPayCust'); gSel.value=shopG; fire(gSel,'change'); await sleep(100);
  type($('#panel [data-f="amt"]'),'5000');
  const saveBtn=$('#panel [data-save]'); click(saveBtn); click(saveBtn); click(saveBtn); await sleep(600);
  check('R34 pressing Save three times quickly on Receive payment records ONE receipt',
    ERP.Payments.incoming().length===receiptsBefore+1, String(ERP.Payments.incoming().length-receiptsBefore));
  check('R35 the older list filters follow the real calendar (Today / This month are not stuck on 6 Sep 2026)',
    win.PERIODS.today[1]===today && win.PERIODS.month[1]===today.slice(0,8)+'01' && win.PERIODS.year[1]===today.slice(0,4)+'-01-01',
    JSON.stringify(win.PERIODS.today)+JSON.stringify(win.PERIODS.month));
  check('R10 nothing threw', errors.length===0, errors.slice(0,2).join(' | '));
  win.close();
  console.log('\n'+out.join('\n')+'\n\n'+pass+' passed, '+fail+' failed\n');
  process.exit(fail?1:0);
};
run().catch(e=>{console.error('HARNESS ERROR:',e);console.log(out.join('\n'));process.exit(2);});
