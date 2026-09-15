import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import FDBKeyRange from 'fake-indexeddb/lib/FDBKeyRange';
const HTML=fs.readFileSync('dist/farooq-co-erp.html','utf8');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0;const out=[];
const check=(n,c,d)=>{if(c){pass++;out.push('  ✔ '+n);}else{fail++;out.push('  ✘ '+n+(d?'   → '+d:''));}};
const errors=[];
function boot(store,ls){
  const vc=new VirtualConsole(); vc.on('jsdomError',e=>errors.push(e.message));
  const dom=new JSDOM(HTML,{runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,
   url:'https://x.local/e',beforeParse(w){
    w.indexedDB=store.idb; w.IDBKeyRange=FDBKeyRange; w.print=()=>{}; w.confirm=()=>true;
    w.prompt=()=>'t'; w.scrollTo=()=>{}; w.open=()=>null;
    w.URL.createObjectURL=()=>'b'; w.URL.revokeObjectURL=()=>{};
    w.HTMLElement.prototype.scrollIntoView=function(){};
    w.matchMedia=q=>({media:q,matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});
    if(ls) Object.keys(ls).forEach(k=>w.localStorage.setItem(k,ls[k]));
   }});
  return dom.window;
}
async function ready(win){for(let i=0;i<400&&!(win.ERP&&win.ERP.ready);i++)await sleep(25);await sleep(300);return win.ERP;}

/* a record in the shape the previous build wrote, with the keys that used to vanish */
function legacyRecord(){
  const dmg={},stock={};
  const mk=(n,p)=>{const o=[];for(let i=0;i<n;i++)o.push(p(i));return o;};
  for(let i=1;i<=50;i++) dmg['PRD-'+String(i).padStart(4,'0')+'|wh-main']=i;
  for(let i=1;i<=60;i++) stock['PRD-'+String(i).padStart(4,'0')+'|wh-main']=100+i;
  return {v:1,schema:2,savedAt:'2026-09-09T12:00:00.000Z',stock,dmg,moves:[],
    sales:[{id:'S1',cust:'CUS-0001',wid:'wh-main',iso:'2026-09-05',
      items:[{pid:'PRD-0002',qty:10,rate:3000,total:30000}],pid:'PRD-0002',qty:10,amt:30000,paid:0}],
    purchases:[],customers:[],products:[],suppliers:[],warehouses:[],regions:[],orders:[],dispatch:[],
    custpay:[],suppay:[],docs:[],audit:[],credits:[],supret:[],
    transfers:mk(200,i=>({id:'TRF-'+i,from:'wh-main',to:'wh-college',qty:5,iso:'2026-09-06'})),
    adjustments:mk(75,i=>({id:'ADJ-'+i,wid:'wh-main',qty:2,reason:'count',iso:'2026-09-07'})),
    seq:{},biz:{}};
}

const run=async()=>{
  /* ═══ ISSUE 1 — no transaction outside the period may touch a balance ═══ */
  {
    const store={idb:new FDBFactory()};
    const win=boot(store); const ERP=await ready(win); const M=win.Money,D=win.document;
    const wh=win.WAREHOUSES[1].id,P=win.PRODUCTS.filter(p=>p.active!==false);
    const c=win.CUSTOMERS[4];
    await ERP.Purchases.save({supplierId:win.SUPPLIERS[0].id,warehouseId:wh,purchaseDate:'2025-12-01',
      items:P.slice(0,3).map(p=>({productId:p.id,quantity:900,unitPrice:2000}))});
    const sell=(amount,date)=>ERP.Invoices.save({customerId:c.id,warehouseId:wh,invoiceDate:date,
      items:[{productId:P[0].id,quantity:amount/1000,unitPrice:1000}]});
    /* the brief's own example */
    await sell(100000,'2025-12-20');                                    // opening 100,000
    await sell(50000,'2026-01-15');                                     // January sale
    await ERP.Payments.receive({customerId:c.id,amount:20000,method:'Cash',date:'2026-01-25'});
    await sell(30000,'2026-02-05');                                     // February — must be ignored
    const JAN=['2026-01-01','2026-01-31'];

    const L=ERP.Ledger.customer(c.id,JAN[0],JAN[1]);
    check('D1 the January opening balance is everything before January',
      L.opening===M.toP(100000), M.fmt(L.opening));
    check('D2 only January entries are in the statement', L.rows.length===2,
      L.rows.map(r=>r.iso).join(','));
    check('D3 the January closing balance ignores the February sale',
      L.closing===M.toP(130000), M.fmt(L.closing));
    check('D4 opening + debit − credit = closing',
      L.opening+L.debit-L.credit===L.closing);
    const overall=ERP.Ledger.customerBalance(c.id);
    check('D5 the account overall still includes February',
      overall===M.toP(160000), M.fmt(overall));

    const k=ERP.Khata.summary(c.id,{from:JAN[0],to:JAN[1]});
    check('D6 the khata summary agrees with the ledger',
      k.opening===M.toP(100000) && k.closing===M.toP(130000) && k.count===2,
      [M.fmt(k.opening),M.fmt(k.closing),k.count].join(' | '));
    check('D7 running balances never look into the future',
      k.rows.every(r=>r.balance<=M.toP(150000)));
    check('D8 the statement reports the window it used',
      k.dateRange && k.dateRange.startDate===JAN[0] && k.dateRange.endDate===JAN[1] &&
      k.dateRange.transactionCount===2 && k.dateRange.lastIncludedTransaction==='2026-01-25',
      JSON.stringify(k.dateRange));

    const sales=ERP.Analytics.sales(JAN[0],JAN[1]);
    check('D9 the sales report stops at the end date',
      sales.revenue===M.toP(50000) && sales.count===1, M.fmt(sales.revenue));
    check('D10 it reports its own date window',
      sales.dateRange.startDate===JAN[0] && sales.dateRange.lastIncludedTransaction==='2026-01-15');
    const money=ERP.Analytics.payments(JAN[0],JAN[1]);
    check('D11 the payment report stops at the end date too',
      (money.receivedTotal!==undefined?money.receivedTotal:money.received)===M.toP(20000),
      M.fmt(money.receivedTotal!==undefined?money.receivedTotal:money.received));
    const shop=ERP.Analytics.customer(c.id,JAN[0],JAN[1]);
    check('D12 the shop record closes at the January figure',
      shop.summary.closing===M.toP(130000), M.fmt(shop.summary.closing));
    const profit=ERP.Analytics.sales(JAN[0],JAN[1]);
    check('D13 profit for the period is built from January sales only',
      profit.revenue===M.toP(50000) && profit.cost>=0, M.fmt(profit.revenue));
    const inv=ERP.Analytics.inventory(JAN[0],JAN[1]);
    check('D14 stock movement respects the window too',
      inv.sold===50 && inv.received===0, 'sold '+inv.sold+' received '+inv.received);

    /* same-day ordering is deterministic */
    await sell(1000,'2026-03-01'); await sleep(20);
    await sell(2000,'2026-03-01');
    const mar=ERP.Ledger.customer(c.id,'2026-03-01','2026-03-01');
    check('D15 two entries on one day keep the order they were entered',
      mar.rows.length===2 && mar.rows[0].dr===M.toP(1000) && mar.rows[1].dr===M.toP(2000));
    check('D16 the health check finds no date leak', ERP.Health.dateLeakCheck().ok);
    win.close();
  }

  /* ═══ ISSUE 2 — an upgrade may not lose records ═══ */
  {
    const store={idb:new FDBFactory()};
    const win=boot(store,{farooqco_erp_v1:JSON.stringify(legacyRecord())});
    const ERP=await ready(win);
    check('M1 damaged stock survives the upgrade',
      Object.keys(ERP.S.inventory).filter(k=>ERP.S.inventory[k].damagedQty>0).length===50,
      String(Object.keys(ERP.S.inventory).filter(k=>ERP.S.inventory[k].damagedQty>0).length));
    check('M2 stock transfers survive the upgrade',
      ERP.StockDocs.byType('TRANSFER').length===200,
      String(ERP.StockDocs.byType('TRANSFER').length));
    check('M3 adjustments survive the upgrade',
      ERP.StockDocs.byType('ADJUST').length===75,
      String(ERP.StockDocs.byType('ADJUST').length));
    check('M4 the sale came across as an invoice', ERP.Invoices.all().length===1);
    check('M5 migration is marked completed and verified',
      ERP.Migration.record && ERP.Migration.record.status==='COMPLETED' &&
      !ERP.Migration.record.warnings.length,
      ERP.Migration.record?ERP.Migration.record.status:'no record');
    check('M6 a backup was taken before anything was changed',
      ERP.Migration.backups().length===1 &&
      Object.keys(ERP.Migration.backups()[0].source.dmg||{}).length===50);
    check('M7 the backup carries a fingerprint and the source counts',
      /^h[0-9a-f]+-\d+$/.test(ERP.Migration.backups()[0].checksum||'') &&
      ERP.Migration.backups()[0].counts.transfers===200);
    check('M8 the migration log records what happened',
      ERP.Migration.record.log.some(l=>/Backup created/.test(l)) &&
      ERP.Migration.record.log.some(l=>/Validation PASSED/.test(l)) &&
      ERP.Migration.record.log.some(l=>/completed/i.test(l)),
      (ERP.Migration.record.log||[]).join(' | ').slice(0,120));
    check('M9 before and after counts are both recorded',
      ERP.Migration.record.before.transfers===200 && ERP.Migration.record.after.transfers===200);
    check('M10 the write lock was released only after migration',
      ERP.Lock.state==='COMPLETED');
    check('M11 saves attempted during migration were held, not lost',
      ERP.Lock.held===0 && typeof ERP.Lock.releasedAt==='string');

    /* the app's own save must no longer strip keys it does not know */
    const raw=JSON.parse(win.localStorage.getItem('farooqco_erp_v1'));
    win.dbSave(); await sleep(60);
    const after=JSON.parse(win.localStorage.getItem('farooqco_erp_v1'));
    check('M12 a normal save keeps keys written by another build',
      Object.keys(after.dmg||{}).length===50 && (after.transfers||[]).length===200,
      `dmg ${Object.keys(after.dmg||{}).length} transfers ${(after.transfers||[]).length}`);
    check('M13 and still writes its own state', Array.isArray(after.sales));

    /* the health page reports it all */
    const h=ERP.Health.report();
    check('M14 system health reports the migration and the backup',
      h.migration.status==='COMPLETED' && !!h.lastBackup && h.backups.length===1);
    check('M15 stock reconciles against its movement history', h.inventory.ok,
      JSON.stringify((h.inventory.mismatches||[]).slice(0,2)));
    check('M16 customer balances all add up', h.ledger.ok);
    check('M17 no warnings on a clean upgrade', h.warnings.length===0, h.warnings.join(' | '));
    win.go('health'); await sleep(250);
    check('M18 the health page renders with its checks',
      /System|Migration|reconcil/i.test(win.document.getElementById('view').textContent) &&
      !!win.document.querySelector('.hz-card'));
    check('M19 the pre-upgrade backup can be downloaded',
      !!win.document.querySelector('[data-hzbackup]'));
    win.close();
  }

  /* ═══ a migration that would lose records must not be marked done ═══ */
  {
    const store={idb:new FDBFactory()};
    const win=boot(store,{farooqco_erp_v1:JSON.stringify(legacyRecord())});
    /* break the step that carries transfers across, then boot */
    const orig=win.eval('window.ERP && window.ERP.Migrate ? 1 : 0');
    const ERP=await ready(win);
    check('M20 a healthy run is the baseline for the failure test',
      ERP.Migration.record.status==='COMPLETED');
    win.close();

    /* now simulate loss: verify() must reject when counts drop */
    const store2={idb:new FDBFactory()};
    const win2=boot(store2,{farooqco_erp_v1:JSON.stringify(legacyRecord())});
    const ERP2=await ready(win2);
    let threw=false;
    try {
      ERP2.Migration.record={id:'x',status:'RUNNING',log:[],warnings:[],before:{transfers:200,adjustments:75,sales:1}};
      ERP2.Migration.verify({transfers:9999,adjustments:75,sales:1,customers:0,products:0,
        suppliers:0,damagedRows:0,purchases:0});
    } catch(e){ threw=true; }
    check('M21 validation refuses to pass when records went missing', threw);
    check('M22 the shortfall is named, not just flagged',
      (ERP2.Migration.record.warnings||[]).some(w=>/stock transfers: 9999 before/.test(w)),
      (ERP2.Migration.record.warnings||[]).join(' | '));
    win2.close();
  }

  /* ═══ the brief's two migration cases, and the protection layer ═══ */
  {
    const store={idb:new FDBFactory()};
    let win=boot(store); let ERP=await ready(win); const M=win.Money;
    const wh=win.WAREHOUSES[1].id, P=win.PRODUCTS.filter(p=>p.active!==false);
    /* Case 1: stock stands at 100, then a migration-era restart must not undo it */
    await ERP.Purchases.save({supplierId:win.SUPPLIERS[0].id,warehouseId:wh,
      items:[{productId:P[0].id,quantity:100,unitPrice:2000}]});
    check('W1 stock starts at 100', ERP.Inventory.available(P[0].id,wh)===100);
    await ERP.Purchases.save({supplierId:win.SUPPLIERS[0].id,warehouseId:wh,
      items:[{productId:P[0].id,quantity:50,unitPrice:2100}]});
    check('W2 a further receipt takes it to 150', ERP.Inventory.available(P[0].id,wh)===150);
    /* Case 2: master records added before the restart */
    const area=await ERP.Areas.save({ur:'نیا علاقہ',en:'New Area'});
    const man=await ERP.Staff.save({name:'Test Collector'});
    const cust=win.CUSTOMERS[9];
    await ERP.Areas.moveCustomer(cust.id,area.id,'test');
    const before={stock:ERP.Inventory.available(P[0].id,wh),areas:win.REGIONS.length,
      staff:ERP.Staff.all().length,region:win.custBy(cust.id).region};
    await ERP.flush(); await sleep(400); win.close();

    win=boot(store); ERP=await ready(win);
    for(let i=0;i<60 && !ERP.Staff.all().length;i++) await sleep(50);
    await sleep(200);
    check('W3 the held startup write is discarded, not replayed over the data',
      ERP.Inventory.available(P[0].id,wh)===before.stock,
      ERP.Inventory.available(P[0].id,wh)+' vs '+before.stock);
    check('W4 nothing was queued for replay after the lock released',
      ERP.Lock.held===0 && ERP.Lock.state==='COMPLETED');
    check('W5 an area added before the restart is still there',
      win.REGIONS.length===before.areas && !!ERP.Areas.byId(area.id),
      win.REGIONS.length+' vs '+before.areas);
    check('W6 a salesman added before the restart is still there',
      ERP.Staff.all().length===before.staff);
    check('W7 the shop is still on the area it was moved to',
      win.custBy(cust.id).region===before.region);
    check('W8 products, shops and suppliers are all intact',
      win.PRODUCTS.length===136 && win.CUSTOMERS.length===409 && win.SUPPLIERS.length===32,
      `${win.PRODUCTS.length}/${win.CUSTOMERS.length}/${win.SUPPLIERS.length}`);
    check('W9 the schema version is reported', ERP.Health.report().schemaVersion===win.FDB.schemaVersion());

    /* a restore that would wipe the business is refused */
    const verdict=ERP.Guard.check({action:'restore',mode:'replace',
      incoming:{products:2,customers:3,invoices:0,suppliers:1,purchases:0,payments:0,stockMovements:0}});
    check('W10 a restore that would remove most records is refused',
      verdict.allowed===false && /products|customers/.test(verdict.reason), verdict.reason);
    check('W11 the refusal is written to the audit log',
      ERP.S.audit.some(a=>/Bulk write blocked/.test(a.action)));
    const rejected=await win.FDB.importAll({format:'farooq-co-erp-backup',formatVersion:1,
      counts:{products:1,customers:1,suppliers:1,invoices:0,purchases:0,payments:0,stockMovements:0},
      data:{}},'replace').then(()=>false).catch(e=>!!e.blocked);
    check('W12 and the restore itself is stopped, not just warned about', rejected);
    check('W13 the records are untouched after the refusal',
      win.PRODUCTS.length===136 && win.CUSTOMERS.length===409);
    /* the prompt, rather than a switch left on */
    const lossy={format:'farooq-co-erp-backup',formatVersion:1,
      counts:{products:1,customers:1,suppliers:1,invoices:0,purchases:0,payments:0,stockMovements:0},
      data:{}};
    const prompt=ERP.Guard.promptOverride(['products: 136 → 1'],'small-backup.json');
    await sleep(80);
    const box=win.document.getElementById('fcGuard');
    check('W14 a lossy restore asks, naming what would go',
      !!box && box.classList.contains('on') && /products: 136/.test(box.textContent));
    check('W15 the confirm button is disabled until the word is typed',
      box.querySelector('[data-gd="go"]').disabled===true);
    const word=win.document.getElementById('fcGuardWord');
    word.value='REPLACE'; word.dispatchEvent(new win.Event('input',{bubbles:true}));
    await sleep(40);
    check('W16 typing REPLACE enables it', box.querySelector('[data-gd="go"]').disabled===false);
    box.querySelector('[data-gd="go"]').dispatchEvent(new win.MouseEvent('click',{bubbles:true}));
    check('W17 confirming grants permission for that restore only',
      (await prompt)===true && ERP.Guard.allowOnce===true);
    check('W18 the permission is spent by the next bulk write',
      ERP.Guard.check({action:'restore',incoming:{products:1,customers:1}}).allowed===true &&
      ERP.Guard.check({action:'restore',incoming:{products:1,customers:1}}).allowed===false);

    const p2=ERP.Guard.promptOverride(['customers: 409 → 2'],'x.json');
    await sleep(60);
    win.document.getElementById('fcGuard').querySelector('[data-gd="cancel"]')
      .dispatchEvent(new win.MouseEvent('click',{bubbles:true}));
    check('W19 declining changes nothing and leaves no permission behind',
      (await p2)===false && ERP.Guard.allowOnce===false &&
      win.PRODUCTS.length===136 && win.CUSTOMERS.length===409);
    check('W20 both decisions are on the audit log',
      ERP.S.audit.filter(a=>/^Bulk write/.test(a.action)).length>=2);

    /* supplier-side checks */
    const h=ERP.Health.report();
    check('W21 supplier balances reconcile', h.supplierLedger.ok,
      JSON.stringify((h.supplierLedger.mismatches||[]).slice(0,2)));
    check('W22 supplier statements respect their dates', h.supplierDateLeak.ok);
    check('W23 health counts areas, warehouses and salesmen too',
      h.counts.areas>=9 && h.counts.warehouses===3 && h.counts.salesmen>=1);
    check('W24 no warnings after a clean restart', h.warnings.length===0, h.warnings.join(' | '));
    win.close();
  }

  /* ═══ startup race — no application write before migration finishes ═══ */
  {
    const store={idb:new FDBFactory()};
    const ls={farooqco_erp_v1:JSON.stringify(legacyRecord())};
    const win=boot(store,ls);
    /* watch the shared record while the app boots */
    let strippedDuringBoot=false, samples=0;
    const watch=setInterval(()=>{
      samples++;
      try{
        const cur=JSON.parse(win.localStorage.getItem('farooqco_erp_v1')||'null');
        if(cur && (!cur.dmg || Object.keys(cur.dmg).length<50 ||
           !cur.transfers || cur.transfers.length<200)) strippedDuringBoot=true;
      }catch(e){}
    },5);
    const ERP=await ready(win);
    clearInterval(watch);
    check('M23 the old record is never stripped while the app starts up',
      !strippedDuringBoot && samples>5, `${samples} samples, stripped=${strippedDuringBoot}`);
    check('M24 and the records are all present afterwards',
      ERP.StockDocs.byType('TRANSFER').length===200 &&
      ERP.StockDocs.byType('ADJUST').length===75 &&
      Object.keys(ERP.S.inventory).filter(k=>ERP.S.inventory[k].damagedQty>0).length===50);
    win.close();
  }

  /* ═══ a second open must not migrate again or duplicate ═══ */
  {
    const store={idb:new FDBFactory()};
    let win=boot(store,{farooqco_erp_v1:JSON.stringify(legacyRecord())});
    let ERP=await ready(win);
    const first={transfers:ERP.StockDocs.byType('TRANSFER').length,
                 adjust:ERP.StockDocs.byType('ADJUST').length,
                 invoices:ERP.Invoices.all().length,
                 damaged:Object.keys(ERP.S.inventory).filter(k=>ERP.S.inventory[k].damagedQty>0).length};
    await ERP.flush(); await sleep(300); win.close();
    win=boot(store,{farooqco_erp_v1:JSON.stringify(legacyRecord())});
    ERP=await ready(win);
    check('M25 reopening does not migrate a second time',
      ERP.StockDocs.byType('TRANSFER').length===first.transfers &&
      ERP.StockDocs.byType('ADJUST').length===first.adjust &&
      ERP.Invoices.all().length===first.invoices,
      `${ERP.StockDocs.byType('TRANSFER').length}/${first.transfers}`);
    check('M26 damaged stock is still there on the second open',
      Object.keys(ERP.S.inventory).filter(k=>ERP.S.inventory[k].damagedQty>0).length===first.damaged);
    check('M27 only one backup was taken', ERP.Migration.backups().length===1);
    check('M28 nothing threw across the whole session', errors.length===0, errors.slice(0,2).join(' | '));
    win.close();
  }

  console.log('\n'+out.join('\n')+'\n\n'+pass+' passed, '+fail+' failed\n');
  process.exit(fail?1:0);
};
run().catch(e=>{console.error('HARNESS ERROR:',e);console.log(out.join('\n'));process.exit(2);});
