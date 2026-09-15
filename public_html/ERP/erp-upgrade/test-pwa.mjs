import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import FDBKeyRange from 'fake-indexeddb/lib/FDBKeyRange';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const vc=new VirtualConsole(); const errs=[];
vc.on('jsdomError',e=>errs.push(e.message));
const store={};
function mk(file){
 return new JSDOM(fs.readFileSync(file,'utf8'),{runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,
  url:'https://x.local/e',beforeParse(w){w.indexedDB=new FDBFactory();w.IDBKeyRange=FDBKeyRange;w.print=()=>{};
   w.confirm=()=>true;w.scrollTo=()=>{};w.URL.createObjectURL=()=>'b';w.URL.revokeObjectURL=()=>{};}});
}
// 1. ERP writes the shared localStorage record
const erp=mk('dist/farooq-co-erp.html'); const w=erp.window;
for(let i=0;i<200 && !(w.ERP&&w.ERP.ready);i++) await sleep(25);
const shared=w.localStorage.getItem('farooqco_erp_v1');
console.log('ERP boots:', !!(w.ERP&&w.ERP.ready), '| shared localStorage record written:', !!shared, shared?shared.length+' chars':'');
const rec=JSON.parse(shared);
console.log('shared record carries products/customers/stock:', (rec.products||[]).length, (rec.customers||[]).length, Object.keys(rec.stock||{}).length);
w.close();
// 2. PWA still boots unchanged
const pwa=mk('dist/farooq-co-warehouse-pwa.html'); await sleep(1200);
const pw=pwa.window;
console.log('PWA boots without throwing:', errs.filter(e=>!/Could not load|not implemented/i.test(e)).length===0);
console.log('PWA product catalogue:', (pw.PRODUCTS||[]).length, 'shops:', (pw.CUSTOMERS||[]).length);
if(errs.length) console.log('errors:', errs.slice(0,3));
pw.close();
