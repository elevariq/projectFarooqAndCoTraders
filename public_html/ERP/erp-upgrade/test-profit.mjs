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
  await sleep(400);
  let ERP=win.ERP; const M=win.Money, D=win.document;
  const $=s=>D.querySelector(s), $$=s=>Array.from(D.querySelectorAll(s));
  const click=el=>el&&el.dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true}));
  const change=(el,v)=>{if(el){el.value=v;el.dispatchEvent(new win.Event('change',{bubbles:true}));}};
  const wh=win.WAREHOUSES[1].id, P=win.PRODUCTS.filter(p=>p.active!==false);
  const mill=win.SUPPLIERS[0], mill2=win.SUPPLIERS[1];
  const A=P[0], B=P[1], Cp=P[2];

  /* ── acceptance test 75: simple profit ── */
  await ERP.Purchases.save({supplierId:mill.id,warehouseId:wh,purchaseDate:'2026-09-01',
    items:[{productId:A.id,quantity:100,unitPrice:2000}]});
  check('P1 purchase cost is stored on the line and on stock',
    ERP.Inventory.costOf(A.id,wh)===M.toP(2000), M.fmt(ERP.Inventory.costOf(A.id,wh)));
  const s1=await ERP.Invoices.save({customerId:win.CUSTOMERS[0].id,warehouseId:wh,invoiceDate:'2026-09-02',
    items:[{productId:A.id,quantity:10,unitPrice:2500}]});
  const pf=ERP.Profit.invoice(s1.id);
  check('P2 revenue 25,000 · COGS 20,000 · gross profit 5,000',
    pf.revenue===M.toP(25000)&&pf.cost===M.toP(20000)&&pf.profit===M.toP(5000),
    [pf.revenue,pf.cost,pf.profit].map(M.fmt).join(' | '));
  check('P3 margin 20% and markup 25% are told apart',
    Math.round(pf.margin)===20 && Math.round(pf.markup)===25,
    pf.margin.toFixed(1)+'% / '+pf.markup.toFixed(1)+'%');
  const rep1=ERP.Profit.report('2026-09-01','2026-09-30',{by:'product'});
  check('P4 the profit report agrees with the invoice',
    rep1.totals.revenue===M.toP(25000)&&rep1.totals.profit===M.toP(5000));
  check('P5 the product row carries the same figures',
    rep1.rows[0].qty===10 && rep1.rows[0].profit===M.toP(5000));

  /* ── acceptance test 76: weighted average across two costs ── */
  await ERP.Purchases.save({supplierId:mill.id,warehouseId:wh,purchaseDate:'2026-09-03',
    items:[{productId:B.id,quantity:100,unitPrice:2000}]});
  await ERP.Purchases.save({supplierId:mill.id,warehouseId:wh,purchaseDate:'2026-09-04',
    items:[{productId:B.id,quantity:100,unitPrice:2200}]});
  check('P6 two purchases average to 2,100 a bag',
    ERP.Inventory.costOf(B.id,wh)===M.toP(2100), M.fmt(ERP.Inventory.costOf(B.id,wh)));
  const s2=await ERP.Invoices.save({customerId:win.CUSTOMERS[1].id,warehouseId:wh,invoiceDate:'2026-09-05',
    items:[{productId:B.id,quantity:10,unitPrice:2500}]});
  const pf2=ERP.Profit.invoice(s2.id);
  check('P7 COGS uses the average, not the latest price',
    pf2.cost===M.toP(21000) && pf2.profit===M.toP(4000) && Math.round(pf2.margin)===16,
    M.fmt(pf2.cost)+' / '+M.fmt(pf2.profit)+' / '+pf2.margin.toFixed(1)+'%');

  /* ── landed cost ── */
  const land=await ERP.Purchases.save({supplierId:mill.id,warehouseId:wh,purchaseDate:'2026-09-06',
    freight:20000, loading:5000,
    items:[{productId:Cp.id,quantity:500,unitPrice:2000}]});
  const li=ERP.Purchases.items(land.id)[0];
  check('P8 freight and loading are spread onto the bags',
    li.goodsUnitCost===M.toP(2000) && li.landedUnitCost===M.toP(2050),
    M.fmt(li.goodsUnitCost)+' → '+M.fmt(li.landedUnitCost));
  check('P9 stock is costed at the landed figure',
    ERP.Inventory.costOf(Cp.id,wh)===M.toP(2050), M.fmt(ERP.Inventory.costOf(Cp.id,wh)));
  const twoLine=await ERP.Purchases.save({supplierId:mill.id,warehouseId:wh,purchaseDate:'2026-09-07',
    freight:30000,
    items:[{productId:A.id,quantity:100,unitPrice:2000},{productId:B.id,quantity:100,unitPrice:4000}]});
  const tl=ERP.Purchases.items(twoLine.id);
  check('P10 charges are split by value, not evenly',
    tl[0].chargeShare===M.toP(10000) && tl[1].chargeShare===M.toP(20000),
    M.fmt(tl[0].chargeShare)+' / '+M.fmt(tl[1].chargeShare));
  check('P11 cost history records the change with the supplier and date',
    ERP.Cost.history(Cp.id).some(h=>h.purchaseNumber===land.purchaseNumber &&
      h.landedCost===M.toP(2050) && h.supplierId===mill.id));

  /* ── discounts move profit ── */
  const s3=await ERP.Invoices.save({customerId:win.CUSTOMERS[2].id,warehouseId:wh,invoiceDate:'2026-09-08',
    items:[{productId:A.id,quantity:10,unitPrice:2500,discount:1000}]});
  const pf3=ERP.Profit.invoice(s3.id);
  check('P12 a discount comes off the profit, not the cost',
    pf3.revenue===M.toP(24000) && pf3.profit===pf3.revenue-pf3.cost,
    M.fmt(pf3.revenue)+' / '+M.fmt(pf3.profit));

  /* ── acceptance test 77: returns reverse profit ── */
  const s4=await ERP.Invoices.save({customerId:win.CUSTOMERS[3].id,warehouseId:wh,invoiceDate:'2026-09-09',
    items:[{productId:A.id,quantity:10,unitPrice:2500}]});
  const it4=ERP.Invoices.items(s4.id)[0];
  const before=ERP.Profit.report('2026-09-09','2026-09-09',{by:'none'}).totals;
  await ERP.Returns.fromCustomer({invoiceId:s4.id,warehouseId:wh,reason:'Damaged product',
    items:[{invoiceItemId:it4.id,quantity:2,condition:'SELLABLE'}],date:'2026-09-09'});
  const after=ERP.Profit.report('2026-09-09','2026-09-09',{by:'none'}).totals;
  check('P13 a return takes its revenue and its cost back out',
    after.returnedQty===2 && after.netRevenue===before.revenue-M.toP(5000) &&
    after.netProfit<after.profit,
    'net '+M.fmt(after.netRevenue)+' vs gross '+M.fmt(after.revenue));
  check('P14 returned goods are not counted as extra profit',
    after.netProfit===after.netRevenue-after.netCost);

  /* ── gross is not net ── */
  await ERP.Expenses.save({date:'2026-09-09',category:'Freight',amount:3000,description:'Delivery'});
  const withExp=ERP.Profit.report('2026-09-09','2026-09-09',{by:'none'}).totals;
  check('P15 expenses are shown separately as net, never as gross profit',
    withExp.expenses===M.toP(3000) && withExp.netAfterExpenses===withExp.netProfit-M.toP(3000));

  /* ── grouping ── */
  const byProd=ERP.Profit.report('2026-09-01','2026-09-30',{by:'product'});
  const byCat=ERP.Profit.report('2026-09-01','2026-09-30',{by:'category'});
  const byCust=ERP.Profit.report('2026-09-01','2026-09-30',{by:'customer'});
  const byArea=ERP.Profit.report('2026-09-01','2026-09-30',{by:'region'});
  check('P16 profit groups by product, category, customer and area',
    byProd.rows.length>=2 && byCat.rows.length>=1 && byCust.rows.length>=3 && byArea.rows.length>=1,
    [byProd.rows.length,byCat.rows.length,byCust.rows.length,byArea.rows.length].join('/'));
  check('P17 every grouping totals to the same profit',
    byProd.totals.profit===byCat.totals.profit && byCat.totals.profit===byCust.totals.profit);
  check('P18 sorting by lowest margin works',
    (()=>{const r=ERP.Profit.report('2026-09-01','2026-09-30',{by:'product',sort:'lowmargin'});
      return r.rows.length<2||r.rows[0].margin<=r.rows[r.rows.length-1].margin;})());

  /* ── supplier mapping (acceptance test 79) ── */
  await ERP.Mapping.add(mill2.id,A.id);
  await ERP.Mapping.add(mill2.id,P.find(p=>p.cat==='آٹا').id);
  check('P19 a mill can supply rice and flour at once',
    ERP.Mapping.forSupplier(mill2.id).length===2);
  check('P20 its label is worked out from what is mapped',
    /supplier/.test(ERP.Mapping.label(mill2.id)) && ERP.Mapping.categoriesOf(mill2.id).length===2,
    ERP.Mapping.label(mill2.id));
  await ERP.Mapping.add(mill2.id,A.id);
  check('P21 the same product cannot be mapped twice',
    ERP.Mapping.forSupplier(mill2.id).length===2);
  check('P22 recording a purchase remembers the product for that mill',
    ERP.Mapping.forSupplier(mill.id).length>=3, String(ERP.Mapping.forSupplier(mill.id).length));
  const m1=ERP.Mapping.forProduct(A.id)[0];
  await ERP.Mapping.setPreferred(m1.id);
  check('P23 a preferred mill can be chosen and drives supplier profit',
    ERP.Mapping.supplierOf(A.id)===m1.supplierId);
  const bySup=ERP.Profit.report('2026-09-01','2026-09-30',{by:'supplier'});
  check('P24 profit can be read by mill', bySup.rows.length>=1 && bySup.totals.profit===byProd.totals.profit);
  await ERP.Mapping.remove(m1.id);
  check('P25 a mapping can be removed', !ERP.Mapping.forProduct(A.id).some(m=>m.id===m1.id));

  /* ── areas and salesmen (acceptance test 78) ── */
  const sm=await ERP.Staff.save({name:'Nasir Khan',phone:'0300-1112222',employeeId:'SM-01',
    regionIds:[win.REGIONS[3].id]});
  check('P26 a salesman can be added and given areas',
    !!sm.id && sm.regionIds.length===1);
  const areaId=win.REGIONS[3].id;
  const inArea=ERP.Areas.customers(areaId);
  check('P27 the salesman covers every shop in that area',
    inArea.length>0 && ERP.Staff.forCustomer(inArea[0].id)===sm.id, String(inArea.length));
  const custA=inArea[0], custB=inArea[1];
  const other=win.CUSTOMERS.find(c=>c.region && c.region!==areaId);
  await ERP.Purchases.save({supplierId:mill.id,warehouseId:wh,items:[{productId:A.id,quantity:200,unitPrice:2000}]});
  await ERP.Invoices.save({customerId:custA.id,warehouseId:wh,items:[{productId:A.id,quantity:20,unitPrice:2500}]});
  await ERP.Invoices.save({customerId:custB.id,warehouseId:wh,items:[{productId:A.id,quantity:12,unitPrice:2500}]});
  await ERP.Invoices.save({customerId:other.id,warehouseId:wh,items:[{productId:A.id,quantity:40,unitPrice:2500}]});
  ERP.CollectionState.regionId=areaId; ERP.CollectionState.salesmanId='all';
  ERP.CollectionState.outstandingOnly=true; ERP.CollectionState.minBalance='';
  let rows=ERP.Collection.rows();
  check('P28 the collection list shows only that area',
    rows.every(r=>r.region===win.regionOf(areaId).en) && rows.length>=2, String(rows.length));
  const total1=ERP.Collection.summary(rows).outstanding;
  check('P29 the area total is the sum of what those shops owe',
    total1===rows.reduce((a,r)=>a+Math.max(0,r.balance),0), M.fmt(total1));
  await ERP.Payments.receive({customerId:custA.id,amount:20000,method:'Cash'});
  rows=ERP.Collection.rows();
  const total2=ERP.Collection.summary(rows).outstanding;
  check('P30 receiving a payment lowers the area total by that amount',
    total2===total1-M.toP(20000), M.fmt(total1)+' → '+M.fmt(total2));
  check('P31 and the shop statement shows it too',
    ERP.Khata.entries(custA.id).some(e=>e.type==='PAYMENT'&&e.credit===M.toP(20000)));
  ERP.CollectionState.regionId='all'; ERP.CollectionState.salesmanId=sm.id;
  check('P32 the list can be filtered by salesman instead',
    ERP.Collection.rows().every(r=>r.salesman==='Nasir Khan'));
  const sheet=ERP.Collection.sheetHtml(ERP.Collection.rows());
  check('P33 the printed sheet has blank columns to write in',
    /Amount collected/.test(sheet) && /Signature \/ notes/.test(sheet) && /cs-write/.test(sheet));
  check('P34 it names the business, area, salesman and date',
    sheet.includes(ERP.Settings.get().businessName) && /Collection date/.test(sheet) &&
    /Nasir Khan/.test(sheet));
  check('P35 it carries an area summary before the list',
    /Outstanding/.test(sheet) && /Over 30 days/.test(sheet));
  ERP.CollectionState.salesmanId='all';

  /* ── moving a shop between areas ── */
  const movedFrom=custB.region;
  await ERP.Areas.moveCustomer(custB.id, win.REGIONS[0].id, 'Route changed');
  check('P36 a shop can be reassigned to another area, with the reason logged',
    win.custBy(custB.id).region===win.REGIONS[0].id &&
    ERP.S.audit.some(a=>a.action==='Shop moved to another area'&&a.reason==='Route changed'));
  await ERP.Areas.moveCustomer(custB.id, movedFrom, 'Put back');

  /* ── editable master data, archive not delete (acceptance test 80) ── */
  await ERP.Master.update('supplier',mill.id,{ph:'0345-9999999'});
  check('P37 a supplier phone edit saves with an audit entry',
    win.supOf(mill.id).ph==='0345-9999999' &&
    ERP.S.audit.some(a=>a.action==='Supplier edited'));
  check('P38 deleting a supplier with purchases is refused',
    await ERP.Master.remove('supplier',mill.id).then(()=>false)
      .catch(e=>/cannot be deleted/.test(e.validation[0])));
  await ERP.Master.archive('supplier',mill.id,true,'No longer trading');
  check('P39 archiving is offered instead, and history still reads',
    win.supOf(mill.id).active===false &&
    ERP.Purchases.all().some(p=>p.supplierId===mill.id));
  await ERP.Master.archive('supplier',mill.id,false);
  const fresh=win.SUPPLIERS.find(s=>ERP.Master.references('supplier',s.id)===0);
  check('P40 a record with no transactions can be deleted outright',
    !!fresh && await ERP.Master.remove('supplier',fresh.id).then(()=>true).catch(()=>false));
  await ERP.Master.update('product',B.id,{min:2400,minSellP:M.toP(2400)});
  const warn=ERP.Profit.preview(B.id,wh,10,2300,0);
  check('P41 selling below the minimum price is detected',
    warn.belowMin===true && warn.minPrice===M.toP(2400));
  const loss=ERP.Profit.preview(B.id,wh,10,1500,0);
  check('P42 selling below cost is detected with the loss figure',
    loss.belowCost===true && loss.profit<0, M.fmt(loss.profit));

  /* ── roles ── */
  check('P43 the owner sees everything', ERP.Can('PROFIT_VIEW') && ERP.Can('MASTER_DATA_EDIT'));
  /* roles belong to accounts now, so this signs in as different people */
  const ownerAcct=ERP.Users.all()[0];
  const godown=await ERP.Users.save({name:'Godown Hand',role:'INVENTORY'});
  const books=await ERP.Users.save({name:'Book Keeper',role:'ACCOUNTANT'});
  await ERP.Session.signIn(godown.id,''); await sleep(60);
  check('P44 warehouse staff cannot see profit',
    !ERP.Can('PROFIT_VIEW') && !ERP.Can('COLLECTION_VIEW') && ERP.Can('STOCK_MANAGE'));
  win.go('profit'); await sleep(120);
  check('P45 the profit screen is closed to them, with a reason',
    /not shown for the Warehouse role/.test($('#view').textContent));
  await ERP.Session.signIn(books.id,''); await sleep(60);
  check('P46 accounts staff see profit and collections but not stock work',
    ERP.Can('PROFIT_VIEW') && ERP.Can('COLLECTION_VIEW') && !ERP.Can('STOCK_MANAGE'));
  await ERP.Session.signIn(ownerAcct.id,''); await sleep(60);

  /* ── the screens ── */
  win.go('profit'); await sleep(200);
  check('P47 the profit screen shows sales, cost, gross profit and margin',
    /Gross profit/.test($('#view').textContent) && /Cost of goods sold/.test($('#view').textContent) &&
    !!$('table.fcb-list'));
  check('P48 it can be regrouped and exported', !!$('[data-prfil="by"]') && !!$('[data-prexport="excel"]'));
  win.go('collection'); await sleep(200);
  check('P49 the collection screen lists shops with balances and a Receive button',
    !!$('[data-khpay]') && /Outstanding/.test($('#view').textContent));
  win.go('areas'); await sleep(200);
  check('P50 areas and salesmen can be managed on screen',
    /Areas/.test($('#view').textContent) && !!$('[data-areaassign]') && !!$('[data-smedit]'));
  win.go('mapping'); await sleep(200);
  check('P51 the supplier mapping screen has all three columns',
    !!$('[data-mapsup]') && $$('.md-list').length===3);
  const p0=store.printed||0;
  win.go('collection'); await sleep(150);
  click($('[data-csprintopen]')); await sleep(300);
  check('P52 the collection sheet opens ready to print', !!$('#fcviewer.on') && /cs-sheet/.test($('#fcviewer').innerHTML));
  click($('[data-csprint="1"]')); await sleep(300);
  check('P53 and prints', (store.printed||0)>p0);
  click($('[data-fcv="close"]')); await sleep(100);

  /* ── persistence ── */
  await ERP.flush(); await sleep(500);
  const keep={cost:ERP.Inventory.costOf(Cp.id,wh), maps:ERP.Mapping.all().length,
              staff:ERP.Staff.all().length, hist:ERP.Cost.history(Cp.id).length};
  win.close();
  win=boot(store);
  for(let i=0;i<400&&!(win.ERP&&win.ERP.ready);i++)await sleep(25);
  await sleep(500);
  ERP=win.ERP;
  check('P54 landed cost, mappings, salesmen and cost history survive a restart',
    ERP.Inventory.costOf(Cp.id,wh)===keep.cost && ERP.Mapping.all().length===keep.maps &&
    ERP.Staff.all().length===keep.staff && ERP.Cost.history(Cp.id).length===keep.hist,
    [ERP.Mapping.all().length,ERP.Staff.all().length,ERP.Cost.history(Cp.id).length].join('/')+
    ' vs '+[keep.maps,keep.staff,keep.hist].join('/'));
  check('P55 nothing threw during the session', errors.length===0, errors.slice(0,2).join(' | '));
  win.close();
  console.log('\n'+out.join('\n')+'\n\n'+pass+' passed, '+fail+' failed\n');
  process.exit(fail?1:0);
};
run().catch(e=>{console.error('HARNESS ERROR:',e);console.log(out.join('\n'));process.exit(2);});
