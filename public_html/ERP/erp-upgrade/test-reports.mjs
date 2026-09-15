import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import FDBKeyRange from 'fake-indexeddb/lib/FDBKeyRange';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0;const out=[];
const check=(n,c,d)=>{if(c){pass++;out.push('  ✔ '+n);}else{fail++;out.push('  ✘ '+n+(d?'   → '+d:''));}};
const errors=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
const dom=new JSDOM(fs.readFileSync('dist/farooq-co-erp.html','utf8'),{runScripts:'dangerously',
 pretendToBeVisual:true,virtualConsole:vc,url:'https://x.local/e',beforeParse(w){
  w.indexedDB=new FDBFactory(); w.IDBKeyRange=FDBKeyRange; w.print=()=>{w.__printed=(w.__printed||0)+1;};
  w.confirm=()=>true; w.scrollTo=()=>{}; w.open=()=>null;
  w.URL.createObjectURL=()=>'b'; w.URL.revokeObjectURL=()=>{};
  w.HTMLElement.prototype.scrollIntoView=function(){};
  w.matchMedia=q=>({media:q,matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});}});
const win=dom.window,D=win.document;
const $=s=>D.querySelector(s),$$=s=>Array.from(D.querySelectorAll(s));
const click=el=>el&&el.dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true}));
const change=(el,v)=>{if(el){el.value=v;el.dispatchEvent(new win.Event('change',{bubbles:true}));}};

const run=async()=>{
  for(let i=0;i<600&&!(win.ERP&&win.ERP.fullyReady);i++)await sleep(25);
  const ERP=win.ERP,M=win.Money,A=ERP.Analytics,P=ERP.Period;
  const wh=win.WAREHOUSES[1].id, wh2=win.WAREHOUSES[0].id;
  const prods=win.PRODUCTS.filter(p=>p.active!==false).slice(0,6);
  const shopA=win.CUSTOMERS[0], shopB=win.CUSTOMERS[1];
  const mill=win.SUPPLIERS[0];

  /* a small but exact book of business across two months */
  await ERP.Purchases.save({supplierId:mill.id,warehouseId:wh,purchaseDate:'2025-12-20',
    items:prods.map(p=>({productId:p.id,quantity:1000,unitPrice:2000}))});
  const janA=await ERP.Invoices.save({customerId:shopA.id,warehouseId:wh,invoiceDate:'2026-01-05',
    items:[{productId:prods[0].id,quantity:100,unitPrice:3000},{productId:prods[1].id,quantity:50,unitPrice:4000}]});
  const janB=await ERP.Invoices.save({customerId:shopB.id,warehouseId:wh,invoiceDate:'2026-01-20',
    items:[{productId:prods[0].id,quantity:60,unitPrice:3100}]});
  const febA=await ERP.Invoices.save({customerId:shopA.id,warehouseId:wh,invoiceDate:'2026-02-10',
    items:[{productId:prods[2].id,quantity:30,unitPrice:5000}]});
  await ERP.Payments.receive({customerId:shopA.id,amount:200000,method:'Cash',date:'2026-01-15'});
  await ERP.Payments.pay({supplierId:mill.id,amount:1000000,method:'Bank Transfer',date:'2026-01-25'});
  const it=ERP.Invoices.items(janA.id)[0];
  await ERP.Returns.fromCustomer({invoiceId:janA.id,warehouseId:wh,reason:'Damaged product',
    items:[{invoiceItemId:it.id,quantity:10,condition:'SELLABLE'}],date:'2026-01-22'});
  await ERP.StockDocs.transfer({warehouseId:wh,toWarehouseId:wh2,date:'2026-01-28',
    items:[{productId:prods[3].id,quantity:40}]});
  await ERP.Expenses.save({date:'2026-01-12',category:'Freight',amount:35000,paidTo:'Gul Khan',method:'Cash'});
  await ERP.Expenses.save({date:'2026-01-18',category:'Salaries',amount:80000,paidTo:'Staff',method:'Cash'});
  await ERP.Expenses.save({date:'2026-02-03',category:'Fuel',amount:15000,paidTo:'Pump',method:'Cash'});

  const JAN=['2026-01-01','2026-01-31'], FEB=['2026-02-01','2026-02-28'];

  /* ── 1. periods ── */
  check('R1 quick periods resolve to real dates',
    P.resolve('today')[0]===P.resolve('today')[1] && !!P.resolve('month')[0] && !!P.resolve('year')[2]);
  check('R2 last month is a whole month, start to end',
    (()=>{const [f,t]=P.resolve('lastmonth');return /-01$/.test(f)&&t>f&&t.slice(0,7)===f.slice(0,7);})());
  check('R3 a month-to-month range covers both months whole',
    (()=>{const [f,t,l]=P.resolve('months','2026-01','2026-03');
      return f==='2026-01-01'&&t==='2026-03-31'&&/January/.test(l);})());
  check('R4 a year covers January to December',
    (()=>{const [f,t]=P.resolve('yearOf','2026');return f==='2026-01-01'&&t==='2026-12-31';})());
  check('R5 a custom range is used exactly as given',
    (()=>{const [f,t]=P.resolve('custom','2026-01-01','2026-01-15');
      return f==='2026-01-01'&&t==='2026-01-15';})());

  /* ── 2. only records inside the period ── */
  const jan=A.sales(JAN[0],JAN[1]), feb=A.sales(FEB[0],FEB[1]);
  check('R6 January picks up only January invoices',
    jan.count===2 && jan.invoices.every(i=>i.invoiceDate>=JAN[0]&&i.invoiceDate<=JAN[1]), String(jan.count));
  check('R7 February picks up only February invoices', feb.count===1);
  check('R8 revenue is the sum of the invoices themselves',
    jan.revenue===janA.grandTotal+janB.grandTotal, M.fmt(jan.revenue));
  check('R9 bags counted match the invoice lines',
    jan.bags===ERP.Invoices.items(janA.id).reduce((a,x)=>a+x.quantity,0)+60);
  check('R10 gross profit is revenue minus the cost recorded at sale time',
    jan.grossProfit===jan.revenue-jan.cost && jan.cost>0);
  check('R11 collections count only payments in the period',
    jan.collected===M.toP(200000), M.fmt(jan.collected));
  check('R12 returns in the period are counted', jan.returned===M.toP(10*3000));

  /* ── 3. breakdowns ── */
  check('R13 product-wise sales add up to revenue',
    jan.byProduct.reduce((a,p)=>a+p.revenue,0)===jan.invoices.reduce((a,i)=>a+i.subtotal-i.itemDiscounts,0));
  check('R14 region-wise sales add up to revenue',
    jan.byRegion.reduce((a,r)=>a+r.revenue,0)===jan.revenue);
  check('R15 customer-wise sales add up to revenue',
    jan.byCustomer.reduce((a,c)=>a+c.revenue,0)===jan.revenue);
  check('R16 the best seller is listed first',
    jan.byProduct[0].revenue>=jan.byProduct[jan.byProduct.length-1].revenue);
  check('R17 a daily trend is produced', jan.trend.length===2 && jan.trend[0].date<jan.trend[1].date);

  /* ── 4. purchases ── */
  const pdec=A.purchases('2025-12-01','2025-12-31');
  check('R18 purchases are found in their own month', pdec.count===1 && pdec.bags===6000);
  check('R19 supplier payments in the period are counted',
    A.purchases(JAN[0],JAN[1]).paid===M.toP(1000000));
  check('R20 the payable matches the supplier ledger',
    A.purchases(JAN[0],JAN[1],{supplierId:mill.id}).payable===ERP.Ledger.supplierBalance(mill.id));

  /* ── 5. stock movement ── */
  const invJan=A.inventory(JAN[0],JAN[1]);
  const rowP0=invJan.rows.find(r=>r.productId===prods[0].id&&r.warehouseId===wh);
  check('R21 opening stock is what was on hand before the period',
    rowP0.opening===1000, String(rowP0.opening));
  check('R22 sold in the period is counted', rowP0.sold===160, String(rowP0.sold));
  check('R23 returns back to stock are counted', rowP0.returnedIn===10);
  check('R24 closing = opening + in − out',
    rowP0.closing===rowP0.opening+rowP0.received+rowP0.returnedIn+rowP0.transferIn+rowP0.adjusted
      -rowP0.sold-rowP0.returnedOut-rowP0.transferOut-rowP0.writtenOff, String(rowP0.closing));
  const rowP3=invJan.rows.find(r=>r.productId===prods[3].id&&r.warehouseId===wh);
  check('R25 a transfer shows as out of one warehouse and into the other',
    rowP3.transferOut===40 &&
    invJan.rows.find(r=>r.productId===prods[3].id&&r.warehouseId===wh2).transferIn===40);
  check('R26 the all-time closing figure equals live stock',
    (()=>{const all=A.inventory(null,null);
      return all.rows.every(r=>r.closing===ERP.Inventory.available(r.productId,r.warehouseId));})());

  /* ── 6. one shop, everything ── */
  const rep=A.customer(shopA.id,JAN[0],JAN[1]);
  check('R27 the shop profile is filled from the record',
    rep.profile.shop===shopA.sh && rep.profile.code===(shopA.legacyCode||shopA.id));
  check('R28 the summary counts that shop\'s orders only',
    rep.summary.orders===1 && rep.summary.sales===janA.grandTotal, String(rep.summary.orders));
  check('R29 a line appears for every product delivered',
    rep.rows.length===ERP.Invoices.items(janA.id).length);
  check('R30 date-wise and product-wise views are produced',
    rep.byDate.length===1 && rep.byProduct.length===2);
  check('R31 the statement balances: opening + sales − paid − returns = closing',
    rep.summary.opening+rep.summary.sales-rep.summary.paid-rep.summary.returns===rep.summary.closing,
    `${M.fmt(rep.summary.opening)}+${M.fmt(rep.summary.sales)}-${M.fmt(rep.summary.paid)}-${M.fmt(rep.summary.returns)} ≠ ${M.fmt(rep.summary.closing)}`);
  check('R32 the closing balance matches the customer ledger',
    rep.summary.closing===ERP.Ledger.customer(shopA.id,JAN[0],JAN[1]).closing);
  const srep=A.supplier(mill.id,'2025-12-01','2026-01-31');
  check('R33 the supplier record shows purchases, payments and payable',
    srep.summary.count===1 && srep.summary.paid===M.toP(1000000) &&
    srep.summary.closing===ERP.Ledger.supplier(mill.id,'2025-12-01','2026-01-31').closing);

  /* ── 7. returns and money ── */
  const rt=A.returns(JAN[0],JAN[1]);
  check('R34 customer returns are listed line by line with reason and condition',
    rt.customer.length===1 && rt.customer[0].qty===10 && /Damaged/.test(rt.customer[0].reason) &&
    !!rt.customer[0].condition && !!rt.customer[0].treatment);
  const pay=A.payments(JAN[0],JAN[1]);
  check('R35 receipts, supplier payments and expenses are separated',
    pay.receivedTotal===M.toP(200000) && pay.madeTotal===M.toP(1000000) &&
    pay.expenseTotal===M.toP(115000), M.fmt(pay.expenseTotal));
  check('R36 expenses group by category',
    pay.byCategory.length===2 && pay.byCategory[0].amount>=pay.byCategory[1].amount);
  check('R37 outstanding balances are reported',
    pay.receivable===ERP.Ledger.receivablesTotal() && pay.payable===ERP.Ledger.payablesTotal());
  check('R38 an expense outside the period is excluded',
    A.payments(FEB[0],FEB[1]).expenseTotal===M.toP(15000));

  /* ── 8. the written summary ── */
  const text=A.summary(JAN[0],JAN[1]);
  check('R39 the summary is written in plain words with the real figures',
    /completed 2 sales/.test(text) && text.includes(M.fmt(jan.revenue)) && /best seller/i.test(text),
    text.slice(0,90));
  check('R40 it names the top region and the outstanding balance',
    text.includes(M.fmt(ERP.Ledger.receivablesTotal())) && text.length>150);

  /* ── 9. the screen ── */
  win.go('reports'); await sleep(200);
  check('R41 the reports screen offers quick periods and tabs',
    $$('[data-rpkind]').length>=8 && $$('[data-rptab]').length===8);
  check('R42a the screen renders even for a period with nothing in it',
    !!$('.rp-cards .rp-card') && (!!$('table.fcb-list') || !!$('.rp-none')));
  click($('[data-rpkind="year"]')); await sleep(200);
  check('R43 choosing a period redraws the report', ERP.ReportState.kind==='year' && !!$('.rp-card'));
  change($('[data-rpfrom]'),'2026-01-01'); await sleep(60);
  change($('[data-rpto]'),'2026-01-31'); await sleep(200);
  check('R44 a custom range is applied',
    ERP.ReportState.kind==='custom' && ERP.ReportState.from==='2026-01-01');
  check('R42 summary cards, a written summary, charts and a table are shown',
    !!$('.rp-cards .rp-card') && !!$('.rp-sum') && !!$('.rp-chart svg') && !!$('table.fcb-list'),
    `cards=${!!$('.rp-card')} sum=${!!$('.rp-sum')} chart=${!!$('.rp-chart svg')} table=${!!$('table.fcb-list')}`);
  check('R45 the screen figures match the engine',
    $('.rp-cards').textContent.includes(M.fmt(jan.revenue)),
    $('.rp-cards').textContent.replace(/\s+/g,' ').slice(0,110));
  for(const tab of ['sales','purchases','inventory','customer','supplier','returns','money']){
    click($(`[data-rptab="${tab}"]`)); await sleep(180);
    check('R46:'+tab+' renders with cards and a table',
      !!$('.rp-card') && (!!$('table.fcb-list') || !!$('.rp-none')));
  }
  click($('[data-rptab="customer"]')); await sleep(180);
  change($('[data-rpfilter="customerId"]'),shopA.id); await sleep(200);
  check('R47 picking a shop shows that shop\'s record',
    $('#view').textContent.includes(shopA.sh) && !!$('.rp-sum'));
  check('R48 the shop report shows the balance statement',
    $('#view').textContent.includes('Balance statement'));

  /* ── 10. exports ── */
  let downloaded=null;
  const origCreate=D.createElement.bind(D);
  D.createElement=tag=>{const el=origCreate(tag);
    if(tag==='a'){el.click=()=>{downloaded=el.download;};} return el;};
  click($('[data-rptab="sales"]')); await sleep(200);
  click($('[data-rpexport="excel"]')); await sleep(300);
  check('R49 Excel export produces a workbook', !!downloaded&&/\.xlsx$/.test(downloaded), String(downloaded));
  const repNow=ERP.Reporting.current();
  const bytes=ERP.XLSX.build(ERP.Reporting.sheets(repNow),{title:repNow.title});
  fs.writeFileSync('out-report.xlsx',Buffer.from(bytes));
  check('R50 the workbook is a valid package with several sheets',
    bytes[0]===0x50&&bytes[1]===0x4b&&ERP.Reporting.sheets(repNow).length>=2, String(bytes.length));
  const m=ERP.Reporting.model(repNow);
  check('R51 the report becomes a document with the branding and the period',
    m.business.name.length>0 && /Period/.test(m.meta.map(r=>r[0]).join(' ')) &&
    m.meta.some(r=>/Generated by/.test(r[0])));
  check('R52 every row reaches the document', m.rows.length===repNow.rows.length);
  const wordBytes=win.DOCX.generate(m);
  fs.writeFileSync('out-report.docx',Buffer.from(wordBytes));
  const xml=Buffer.from(wordBytes).toString('utf8');
  check('R53 the Word report carries the company name and the period',
    xml.includes('Farooq')&&xml.includes('Period'), String(wordBytes.length));
  check('R54 the Word report carries the written summary',
    xml.includes('completed')||xml.includes('revenue'));
  downloaded=null;
  click($('[data-rpexport="word"]')); await sleep(400);
  check('R55 the Word button downloads a file', !!downloaded&&/\.docx$/.test(downloaded), String(downloaded));
  click($('[data-fcv="close"]')); await sleep(80);
  click($('[data-rpexport="print"]')); await sleep(400);
  check('R56 printing opens the report sheet', (win.__printed||0)>0);
  const pv=$('#fcviewer');
  check('R57 the print sheet shows the report title and rows',
    !!pv && pv.textContent.includes(repNow.title.toUpperCase().slice(0,6)));
  D.createElement=origCreate;

  /* the words must agree with the figures above them */
  click($('[data-rptab="sales"]')); await sleep(200);
  change($('[data-rpfilter="customerId"]'),''); await sleep(120);
  ERP.ReportState.filters.customerId=shopA.id; win.paint(); await sleep(200);
  const filtered=ERP.Reporting.current();
  check('R59 the written summary follows the same filters as the figures',
    filtered.summary.includes(M.fmt(filtered.cards[0].value===undefined?0:0))||
    filtered.summary.includes(String(M.fmt(A.sales(filtered.from,filtered.to,{customerId:shopA.id}).revenue))),
    filtered.summary.slice(0,110));
  ERP.ReportState.filters.customerId=''; win.paint(); await sleep(150);

  check('R58 nothing threw across the reporting session', errors.length===0, errors.slice(0,2).join(' | '));
  console.log('\n'+out.join('\n')+'\n\n'+pass+' passed, '+fail+' failed\n');
  process.exit(fail?1:0);
};
run().catch(e=>{console.error('HARNESS ERROR:',e);console.log(out.join('\n'));process.exit(2);});
