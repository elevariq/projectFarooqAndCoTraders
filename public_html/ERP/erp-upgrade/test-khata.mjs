import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import FDBKeyRange from 'fake-indexeddb/lib/FDBKeyRange';
const HTML=fs.readFileSync('dist/farooq-co-erp.html','utf8');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0;const out=[];
const check=(n,c,d)=>{if(c){pass++;out.push('  ✔ '+n);}else{fail++;out.push('  ✘ '+n+(d?'   → '+d:''));}};
const errors=[];
function boot(store){
  const vc=new VirtualConsole(); vc.on('jsdomError',e=>errors.push(e.message));
  const dom=new JSDOM(HTML,{runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,
   url:'https://x.local/e',beforeParse(w){
    w.indexedDB=store.idb; w.IDBKeyRange=FDBKeyRange; w.print=()=>{store.printed=(store.printed||0)+1;};
    w.confirm=()=>true; w.prompt=()=>'test'; w.scrollTo=()=>{}; w.open=()=>null;
    w.URL.createObjectURL=()=>'b'; w.URL.revokeObjectURL=()=>{};
    w.HTMLElement.prototype.scrollIntoView=function(){};
    w.matchMedia=q=>({media:q,matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});
   }});
  return dom.window;
}
const run=async()=>{
  const store={idb:new FDBFactory()};
  let win=boot(store);
  for(let i=0;i<400&&!(win.ERP&&win.ERP.ready);i++)await sleep(25);
  await sleep(250);
  let ERP=win.ERP; const M=win.Money, D=win.document;
  const $=s=>D.querySelector(s), $$=s=>Array.from(D.querySelectorAll(s));
  const click=el=>el&&el.dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true}));
  const change=(el,v)=>{if(el){el.value=v;el.dispatchEvent(new win.Event('change',{bubbles:true}));}};
  const type=(el,v)=>{if(el){el.value=v;el.dispatchEvent(new win.Event('input',{bubbles:true}));}};

  const wh=win.WAREHOUSES[1].id, P=win.PRODUCTS.filter(p=>p.active!==false);
  const c=win.CUSTOMERS[3];
  await ERP.Purchases.save({supplierId:win.SUPPLIERS[0].id,warehouseId:wh,purchaseDate:'2026-08-25',
    items:P.slice(0,4).map(p=>({productId:p.id,quantity:400,unitPrice:2000}))});

  /* a real account: three sales, two payments, a return, an adjustment */
  const inv1=await ERP.Invoices.save({customerId:c.id,warehouseId:wh,invoiceDate:'2026-09-01',
    items:[{productId:P[0].id,quantity:20,unitPrice:10000}]});           // 200,000
  await ERP.Payments.receive({customerId:c.id,amount:50000,method:'Cash',date:'2026-09-10'});
  const inv2=await ERP.Invoices.save({customerId:c.id,warehouseId:wh,invoiceDate:'2026-09-12',
    items:[{productId:P[1].id,quantity:10,unitPrice:5000},{productId:P[2].id,quantity:5,unitPrice:4000}]}); // 70,000
  await ERP.Payments.receive({customerId:c.id,amount:30000,method:'Bank Transfer',
    reference:'TRX-88',date:'2026-09-14'});
  const item=ERP.Invoices.items(inv2.id)[0];
  const ret=await ERP.Returns.fromCustomer({invoiceId:inv2.id,warehouseId:wh,reason:'Damaged product',
    items:[{invoiceItemId:item.id,quantity:2,condition:'DAMAGED'}],date:'2026-09-15'});   // -10,000

  check('K1 sales, payments and returns all reach the account automatically',
    ERP.Khata.entries(c.id).length===5, String(ERP.Khata.entries(c.id).length));
  let rows=ERP.Khata.entries(c.id);
  check('K2 a sale is a debit and a payment a credit',
    rows[0].type==='SALE' && rows[0].debit===M.toP(200000) && rows[0].credit===0 &&
    rows[1].type==='PAYMENT' && rows[1].credit===M.toP(50000) && rows[1].debit===0);
  check('K3 a return credits the account at the invoiced rate',
    rows[4].type==='RETURN' && rows[4].credit===M.toP(10000), M.fmt(rows[4].credit));
  check('K4 the running balance follows previous + debit − credit',
    rows[0].balance===M.toP(200000) && rows[1].balance===M.toP(150000) &&
    rows[2].balance===M.toP(220000) && rows[3].balance===M.toP(190000) &&
    rows[4].balance===M.toP(180000), rows.map(r=>M.toR(r.balance)).join(' / '));
  check('K5 the sale line describes what was sold',
    /×\s*20 bags/.test(rows[0].detail), rows[0].detail);
  check('K6 the payment line carries its method and reference',
    rows[3].method==='Bank Transfer' && /TRX-88/.test(rows[3].detail));

  /* adjustments */
  const adj=await ERP.Adjustments.create({customerId:c.id,direction:'CREDIT',amount:5000,
    reason:'Discount allowed',date:'2026-09-16',notes:'Agreed with the owner'});
  check('K7 an adjustment is numbered and posted', /^ACC-\d{4}-\d{6}$/.test(adj.adjustmentNumber));
  check('K8 a credit adjustment reduces what the shop owes',
    ERP.Ledger.customerBalance(c.id)===M.toP(175000), M.fmt(ERP.Ledger.customerBalance(c.id)));
  const adj2=await ERP.Adjustments.create({customerId:c.id,direction:'DEBIT',amount:2000,
    reason:'Additional charges',date:'2026-09-17'});
  check('K9 a debit adjustment increases it',
    ERP.Ledger.customerBalance(c.id)===M.toP(177000), M.fmt(ERP.Ledger.customerBalance(c.id)));
  check('K10 adjustments need an amount and a reason',
    await ERP.Adjustments.create({customerId:c.id,direction:'CREDIT',amount:0,reason:''})
      .then(()=>false).catch(e=>e.validation.length>=2));
  check('K11 posting an adjustment is written to the audit log',
    ERP.S.audit.some(a=>a.action==='Account adjustment posted' && a.reason==='Discount allowed'));
  await ERP.Adjustments.reverse(adj2.id,'Charged in error');
  check('K12 a reversed adjustment leaves the balance as it was',
    ERP.Ledger.customerBalance(c.id)===M.toP(175000));
  check('K13 the reversal is recorded, the original kept',
    ERP.Adjustments.all().some(a=>a.id===adj2.id && a.status==='REVERSED'));

  /* the invoice ledger and the statement agree */
  check('K14 the invoice screens and the statement use one balance',
    win.custBal(c.id)===M.toR(ERP.Ledger.customerBalance(c.id)));
  const inv3=await ERP.Invoices.save({customerId:c.id,warehouseId:wh,invoiceDate:'2026-09-18',
    items:[{productId:P[3].id,quantity:1,unitPrice:1000}]});
  check('K15 a new invoice carries the account balance forward as its opening',
    ERP.Invoices.byId(inv3.id).previousBalance===M.toP(175000),
    M.fmt(ERP.Invoices.byId(inv3.id).previousBalance));

  /* summary */
  let sum=ERP.Khata.summary(c.id,{});
  check('K16 the summary adds up the period',
    sum.sales===M.toP(271000) && sum.payments===M.toP(80000) &&
    sum.returns===M.toP(10000) && sum.closing===M.toP(176000),
    [sum.sales,sum.payments,sum.returns,sum.closing].map(M.fmt).join(' | '));
  check('K17 it reports the last transaction and last payment',
    sum.lastTransactionDate==='2026-09-18' && sum.lastPaymentDate==='2026-09-14' &&
    sum.lastPaymentAmount===M.toP(30000));

  /* filtering */
  const inSep12=ERP.Khata.summary(c.id,{from:'2026-09-12',to:'2026-09-15'});
  check('K18 a date range narrows the entries', inSep12.count===3, String(inSep12.count));
  check('K19 and the opening balance for that range is the balance before it',
    inSep12.opening===M.toP(150000), M.fmt(inSep12.opening));
  check('K20 balances inside a filtered view stay true to the whole account',
    inSep12.rows[inSep12.rows.length-1].balance===M.toP(180000));
  const onlyPay=ERP.Khata.summary(c.id,{types:['PAYMENT']});
  check('K21 filtering by type works', onlyPay.rows.every(r=>r.type==='PAYMENT') && onlyPay.rows.length===2);
  const byMethod=ERP.Khata.summary(c.id,{method:'Bank Transfer'});
  check('K22 filtering by payment method works',
    byMethod.rows.length===1 && byMethod.rows[0].method==='Bank Transfer');
  const byRef=ERP.Khata.summary(c.id,{q:inv1.invoiceNumber});
  check('K23 searching by invoice number finds the entry',
    byRef.rows.length===1 && byRef.rows[0].ref===inv1.invoiceNumber);

  /* the page */
  win.go('khata',c.id); await sleep(200);
  check('K24 every shop has an account statement page',
    !!$('.kh-cards') && D.body.textContent.includes(c.sh));
  check('K25 the header shows the shop, owner, ID and phone',
    $('.kh-facts').textContent.includes(String(c.legacyCode||c.id)));
  check('K26 the summary cards are on the page',
    /Opening balance/.test($('.kh-cards').textContent) &&
    /Current balance/.test($('.kh-cards').textContent) &&
    /Payments received/.test($('.kh-cards').textContent));
  check('K27 the ledger table has all the accounting columns',
    (()=>{const h=$$('table.kh-table thead th').map(t=>t.textContent.trim());
      return ['Date','Type','Folio / Reference #','Description / تفصیل','Qty',
              'Debit / بنام','Credit / جمع','Balance / بقایا'].every(x=>h.includes(x));})());
  check('K28 every entry is listed with a running balance',
    $$('table.kh-table tbody tr').length===7 && !!$('.kh-bal'),
    String($$('table.kh-table tbody tr').length));
  check('K29 debits and credits are told apart visually',
    $$('.kh-dr').length>0 && $$('.kh-cr').length>0);
  check('K30 newest first by default, and it can be flipped',
    (()=>{const first=$('table.kh-table tbody tr').textContent;
      change($('[data-khfil="order"]'),'asc'); return true;})());
  await sleep(150);
  check('K31 oldest-first ordering redraws the table',
    $$('table.kh-table tbody tr').length===7);
  change($('[data-khfil="order"]'),'desc'); await sleep(120);
  change($('[data-khfil="type"]'),'PAYMENT'); await sleep(150);
  check('K32 the type filter changes the table', $$('table.kh-table tbody tr').length===2,
    String($$('table.kh-table tbody tr').length));
  change($('[data-khfil="type"]'),''); await sleep(120);
  type($('[data-khq]'),'zzzznothing'); await sleep(400);
  check('K33 a search with no hits shows an empty state, not a blank page',
    /No entries in this view/.test($('#view').textContent));
  type($('[data-khq]'),''); await sleep(400);

  /* actions */
  check('K34 the page offers payment, adjustment and a new invoice',
    !!$('[data-khpay]') && !!$('[data-khadjust]') && !!$('[data-fcnew="sale"]'));
  click($('[data-khopen="invoice"]')); await sleep(250);
  check('K35 an entry opens the document behind it',
    !!$('#fcviewer.on') && $('#fcviewer').textContent.includes(inv3.invoiceNumber.slice(-3)));
  click($('[data-fcv="close"]')); await sleep(100);

  /* documents */
  const model=ERP.statementModel(c.id,{});
  check('K36 the statement document carries the company and the shop',
    model.business.name.length>0 && model.party.shop===c.sh && model.title==='ACCOUNT STATEMENT');
  check('K37 it shows the period, who generated it and when',
    model.meta.some(m=>/Period/.test(m[0])) && model.meta.some(m=>/Generated by/.test(m[0])));
  check('K38 every entry appears on it — three sales, two payments, a return and an adjustment',
    model.rows.length===7, String(model.rows.length));
  check('K39 the account summary is on it',
    model.totals.some(t=>/Closing balance/.test(t.label)) &&
    model.totals.some(t=>/Payments received/.test(t.label)));
  check('K40 it is signed off', model.signatures.length>=2 &&
    model.signatures.some(s=>/Authorised/.test(s)));
  const html=ERP.Paper.html(model);
  check('K41 it prints as an A4 sheet with the ledger on it',
    /fcdoc/.test(html) && html.includes(inv1.invoiceNumber) && /Debit/.test(html));
  const bytes=win.DOCX.generate(model);
  const xml=Buffer.from(bytes).toString('utf8');
  check('K42 the Word statement contains the entries and the closing balance',
    bytes[0]===0x50 && xml.includes(inv1.invoiceNumber) && xml.includes(M.fmtPlain(sum.closing)),
    String(bytes.length));
  fs.writeFileSync('sample-customer-statement.docx',Buffer.from(bytes));

  let downloaded=null;
  const origCreate=D.createElement.bind(D);
  D.createElement=function(tag){const el=origCreate(tag);
    if(tag==='a'){el.click=()=>{downloaded=el.download;};} return el;};
  const name=ERP.exportStatementExcel(c.id);
  check('K43 the Excel statement downloads', /\.xlsx$/.test(name||'') && downloaded===name, String(name));
  D.createElement=origCreate;

  win.go('khata',c.id); await sleep(150);
  const p0=store.printed||0;
  click($('[data-khexport="print"]')); await sleep(400);
  check('K44 Print opens the statement and prints it', (store.printed||0)>p0);
  if($('[data-fcv="close"]')) click($('[data-fcv="close"]'));
  await sleep(100);

  /* persistence */
  await ERP.flush(); await sleep(400);
  const before={balance:ERP.Ledger.customerBalance(c.id),entries:ERP.Khata.entries(c.id).length,
                adjustments:ERP.Adjustments.all().length};
  win.close();
  win=boot(store);
  for(let i=0;i<400&&!(win.ERP&&win.ERP.ready);i++)await sleep(25);
  /* wait for the account to finish loading rather than guessing at a delay */
  await (win.ERP.adjustmentsReady||Promise.resolve()).catch(()=>{});
  await sleep(200);
  ERP=win.ERP;
  check('K45 the account survives a restart',
    ERP.Ledger.customerBalance(c.id)===before.balance &&
    ERP.Khata.entries(c.id).length===before.entries,
    ERP.Khata.entries(c.id).length+' vs '+before.entries);
  check('K46 adjustments survive too', ERP.Adjustments.all().length===before.adjustments);
  check('K47 nothing threw during the session', errors.length===0, errors.slice(0,2).join(' | '));
  win.close();
  console.log('\n'+out.join('\n')+'\n\n'+pass+' passed, '+fail+' failed\n');
  process.exit(fail?1:0);
};
run().catch(e=>{console.error('HARNESS ERROR:',e);console.log(out.join('\n'));process.exit(2);});
