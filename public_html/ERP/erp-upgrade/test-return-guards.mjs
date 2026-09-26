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

  check('R10 nothing threw', errors.length===0, errors.slice(0,2).join(' | '));
  win.close();
  console.log('\n'+out.join('\n')+'\n\n'+pass+' passed, '+fail+' failed\n');
  process.exit(fail?1:0);
};
run().catch(e=>{console.error('HARNESS ERROR:',e);console.log(out.join('\n'));process.exit(2);});
