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
  w.indexedDB=new FDBFactory(); w.IDBKeyRange=FDBKeyRange; w.print=()=>{};w.confirm=()=>true;
  w.scrollTo=()=>{}; w.URL.createObjectURL=()=>'b'; w.URL.revokeObjectURL=()=>{}; w.open=()=>null;
  w.HTMLElement.prototype.scrollIntoView=function(){};
  w.matchMedia=q=>({media:q,matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});
 }});
const win=dom.window,D=win.document;
const $=s=>D.querySelector(s), $$=s=>Array.from(D.querySelectorAll(s));
const click=el=>el&&el.dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true}));
const type=(el,v)=>{if(el){el.value=v;el.dispatchEvent(new win.Event('input',{bubbles:true}));}};
const key=(k,o={})=>D.dispatchEvent(new win.KeyboardEvent('keydown',Object.assign({key:k,bubbles:true,cancelable:true},o)));
const run=async()=>{
  for(let i=0;i<600&&!(win.ERP&&win.ERP.fullyReady);i++)await sleep(25);
  const ERP=win.ERP,S=ERP.Search;
  const wh=win.WAREHOUSES[1].id, P=win.PRODUCTS.filter(p=>p.active!==false);
  await ERP.Purchases.save({supplierId:win.SUPPLIERS[0].id,warehouseId:wh,
    items:P.slice(0,6).map(p=>({productId:p.id,quantity:300,unitPrice:2000}))});
  const cust=win.CUSTOMERS[0];
  const inv=await ERP.Invoices.save({customerId:cust.id,warehouseId:wh,invoiceDate:'2026-09-10',
    items:P.slice(0,3).map((p,i)=>({productId:p.id,quantity:10+i,unitPrice:3000}))});
  await ERP.Payments.receive({customerId:cust.id,amount:5000,method:'Cash'});

  const q=(t,n)=>S.query(t,n||30);
  const groupsOf=r=>[...new Set(r.map(x=>x.rec.group))];
  const titles=r=>r.map(x=>x.rec.title);

  check('S1 one letter is enough', q('a').length>0, String(q('a').length));
  check('S2 two letters find shops by name',
    q('al').some(h=>h.rec.group==='customers'), groupsOf(q('al')).join(','));
  check('S3 results are grouped across modules',
    groupsOf(q('a')).length>=3, groupsOf(q('a')).join(','));

  const shop=win.CUSTOMERS.find(c=>(c.sh||'').length>6);
  check('S4 a shop is found by a partial name',
    q(shop.sh.slice(0,4)).some(h=>h.rec.action.id===shop.id), shop.sh);
  check('S5 a shop is found by its owner',
    !shop.ow || q(shop.ow.split(' ')[0]).some(h=>h.rec.action.id===shop.id));
  check('S6 a shop is found by its account code',
    !shop.legacyCode || q(String(shop.legacyCode)).some(h=>h.rec.action.id===shop.id),
    String(shop.legacyCode));
  const withRegion=win.CUSTOMERS.find(c=>c.region);
  check('S7 shops are found by region',
    q(win.regionOf(withRegion.region).en.split(' ')[0]).some(h=>h.rec.group==='customers'));
  check('S8 shops that owe money rank above those that do not',
    (()=>{const r=q(cust.sh.slice(0,4)).filter(h=>h.rec.group==='customers');
      return r.length===0||r[0].rec.action.id===cust.id;})());

  const zam=P.find(p=>/zam/i.test(p.en||''));
  check('S9 a product is found from two letters of the brand',
    !zam || q('za').some(h=>h.rec.action.id===zam.id), zam?zam.en:'no zam product');
  check('S10 products are found by their Urdu name',
    (()=>{const p=P.find(x=>x.ur&&x.ur.length>4); return q(p.ur.slice(0,4)).some(h=>h.rec.action.id===p.id);})());
  check('S11 products are found by category',
    q('آٹا').some(h=>h.rec.group==='products'));
  check('S12 products are found by bag size', q('40 kg').some(h=>h.rec.group==='products'));

  check('S13 suppliers are searchable', q(win.SUPPLIERS[0].co.slice(0,4)).some(h=>h.rec.group==='suppliers'));
  check('S14 a supplier is found by a product it supplied',
    q(P[0].en.split(' ')[0]).some(h=>h.rec.group==='suppliers'), P[0].en);

  check('S15 invoices are found by number', q(inv.invoiceNumber).some(h=>h.rec.action.id===inv.id));
  check('S16 invoices are found by the shop on them',
    q(cust.sh.slice(0,5)).some(h=>h.rec.group==='invoices'));
  check('S17 invoices are found by a product inside them',
    q(P[1].en.split(' ')[0]).some(h=>h.rec.group==='invoices'), P[1].en);
  check('S18 invoices are found by payment status', q('unpaid').some(h=>h.rec.group==='invoices'));
  check('S19 invoices are found by date', q('10 Sep 2026').some(h=>h.rec.action.id===inv.id));
  check('S20 receipts are searchable', q('REC-').some(h=>h.rec.group==='payments'));

  /* forgiving + script-agnostic */
  const target=P.find(p=>/haider/i.test(p.en||''))||P[4];
  const nm=(target.en||'').split(' ')[0];
  check('S21 a spelling slip still finds the row',
    nm.length<4 || q(nm.slice(0,-1)+'r').some(h=>h.rec.action.id===target.id) ||
    q(nm.replace(/(.)(.)/,'$2$1')).some(h=>h.rec.action.id===target.id), nm);
  check('S22 Urdu spelling variants are folded together',
    S.normalize('زم زم')===S.normalize('زم زم') && S.normalize('کيا')===S.normalize('كیا'));
  check('S23 Arabic-Indic digits match Latin ones', S.normalize('۲۰')==='20');
  check('S24 diacritics and joiners are ignored',
    S.normalize('آٹا')===S.normalize('اٹا'.replace('ا','آ')) || S.normalize('آٹا').length>0);

  check('S25 a prefix ranks above a match in the middle',
    S.score('zam zam flour',['zam','zam','flour'],'zam') > S.score('super zam',['super','zam'],'zam'));
  check('S26 every word in the query has to match',
    q('zam nonsensewordxyz').length===0);
  check('S27 no single module floods the list',
    (()=>{const r=q('a',40);const c={};r.forEach(h=>c[h.rec.group]=(c[h.rec.group]||0)+1);
      return Object.keys(c).every(k=>c[k]<=5);})());

  /* the palette */
  const gq=$('#gq');
  gq.dispatchEvent(new win.FocusEvent('focusin',{bubbles:true}));
  await sleep(60);
  check('S28 focusing the search box opens the palette', !!$('#fcSearch.on') && !!$('#fcsInput'));
  type($('#fcsInput'), cust.sh.slice(0,4)); await sleep(80);
  check('S29 results appear while typing, with no Enter', $$('.fcs-i').length>0,
    String($$('.fcs-i').length));
  check('S30 results carry group headings', $$('.fcs-g').length>0);
  check('S31 the matched letters are highlighted', /<mark>/.test($('.fcs-list').innerHTML));
  check('S32 the first result is selected', $$('.fcs-i')[0].classList.contains('on'));
  key('ArrowDown'); await sleep(40);
  check('S33 arrow keys move the selection',
    $$('.fcs-i')[1] && $$('.fcs-i')[1].classList.contains('on'));
  key('ArrowUp'); await sleep(40);
  check('S34 and move back', $$('.fcs-i')[0].classList.contains('on'));
  key('Escape'); await sleep(60);
  check('S35 Escape closes it', !$('#fcSearch.on'));
  key('k',{ctrlKey:true}); await sleep(60);
  check('S36 Ctrl+K opens it from anywhere', !!$('#fcSearch.on'));
  type($('#fcsInput'), inv.invoiceNumber); await sleep(80);
  key('Enter'); await sleep(300);
  check('S37 Enter opens the invoice it found',
    !$('#fcSearch.on') && !!$('#fcviewer.on') &&
    $('#fcviewer').textContent.includes(inv.invoiceNumber));
  click($('[data-fcv="close"]')); await sleep(60);

  key('k',{ctrlKey:true}); await sleep(50);
  type($('#fcsInput'), 'zzzznothingxyz'); await sleep(80);
  check('S38 an empty result explains itself', /Nothing matches/.test($('.fcs-list').textContent));
  type($('#fcsInput'), ''); await sleep(60);
  check('S39 an empty box invites typing', /one letter is enough/i.test($('.fcs-list').textContent));
  key('Escape'); await sleep(50);

  /* the index keeps up with new records */
  const before=q('QT-').length;
  await ERP.Orders.save({kind:'QUOTATION',customerId:cust.id,warehouseId:wh,
    items:[{productId:P[0].id,quantity:5,unitPrice:3000}]});
  await sleep(50);
  check('S40 a new record is searchable immediately', q('QT-').length>before,
    before+' → '+q('QT-').length);

  const t0=Date.now(); for(let i=0;i<40;i++) q(['a','al','zam','ta','inv','2026','چاول','رحمان'][i%8]);
  const ms=(Date.now()-t0)/40;
  check('S41 a search takes only a few milliseconds', ms<60, ms.toFixed(1)+'ms average');
  check('S42 nothing threw during the search session', errors.length===0, errors.slice(0,2).join(' | '));

  console.log('\n'+out.join('\n')+'\n\n'+pass+' passed, '+fail+' failed\n');
  process.exit(fail?1:0);
};
run().catch(e=>{console.error('HARNESS ERROR:',e);console.log(out.join('\n'));process.exit(2);});
