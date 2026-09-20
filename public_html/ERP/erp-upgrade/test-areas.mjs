import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import FDBKeyRange from 'fake-indexeddb/lib/FDBKeyRange';
/* Areas (regions): add, rename, archive and DELETE — the service rules, the three
   screens that offer them (Areas & salesmen, Settings, Shops), and that a deleted
   area stays deleted after a restart in a browser that has no saved copy of its own. */
const HTML=fs.readFileSync('dist/farooq-co-erp.html','utf8');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0;const out=[];
const check=(n,c,d)=>{if(c){pass++;out.push('  ✔ '+n);}else{fail++;out.push('  ✘ '+n+(d?'   → '+d:''));}};
const errors=[];
function boot(store){
  const vc=new VirtualConsole(); vc.on('jsdomError',e=>errors.push(e.message));
  const dom=new JSDOM(HTML,{runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,
   url:'https://x.local/e',beforeParse(w){
    w.indexedDB=store.idb; w.IDBKeyRange=FDBKeyRange; w.print=()=>{};
    w.confirm=()=>true; w.prompt=()=>'t'; w.scrollTo=()=>{}; w.open=()=>null;
    w.URL.createObjectURL=()=>'b'; w.URL.revokeObjectURL=()=>{};
    w.HTMLElement.prototype.scrollIntoView=function(){};
    w.matchMedia=q=>({media:q,matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});
   }});
  return dom.window;
}
async function up(win){
  for(let i=0;i<400&&!(win.ERP&&win.ERP.ready);i++)await sleep(25);
  await sleep(400);
}
const run=async()=>{
  const store={idb:new FDBFactory()};
  let win=boot(store); await up(win);
  let ERP=win.ERP; const D=win.document;
  const $=s=>D.querySelector(s), $$=s=>Array.from(D.querySelectorAll(s));
  const click=el=>el&&el.dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true}));
  const Areas=ERP.Areas, Staff=ERP.Staff;
  const shopsIn=id=>win.CUSTOMERS.filter(c=>c.region===id).length;
  const rejects=async(p)=>{try{await p;return null;}catch(e){return e&&e.validation?e.validation.join(' '):String(e);}};

  const totalShops=win.CUSTOMERS.length;
  const seeded=win.REGIONS.filter(r=>r.active!==false).length;
  const dir=win.REGIONS.find(r=>/dir/i.test(r.en))||win.REGIONS[3];
  const drosh=win.REGIONS.find(r=>/drosh/i.test(r.en))||win.REGIONS[2];
  const droshShops=shopsIn(drosh.id), dirShops=shopsIn(dir.id);

  /* ══ A · adding ══ */
  const a1=await Areas.save({en:'  Lower   Dir ',ur:'لوئر دیر'});
  check('A1 an area is added, active, with its name tidied (no stray spaces)',
    !!Areas.byId(a1.id) && a1.active===true && a1.en==='Lower Dir', JSON.stringify(a1.en));
  const u1=await Areas.save({ur:'صرف اردو'});
  const u2=await Areas.save({ur:'دوسرا علاقہ'});
  check('A2 two Urdu-only areas get different ids (they used to both become "rg-")',
    u1.id!==u2.id && u1.id!=='rg-' && u2.id!=='rg-' && Areas.byId(u1.id) && Areas.byId(u2.id), u1.id+' / '+u2.id);
  check('A3 the missing English name falls back to the Urdu one', u1.en==='صرف اردو');
  check('A4 the same English name is refused, whatever the capitals',
    /already exists/.test(await rejects(Areas.save({en:'LOWER dir',ur:'کچھ اور'}))||''));
  check('A5 the same Urdu name is refused too (it was only checked in English before)',
    /already exists/.test(await rejects(Areas.save({en:'Something Else',ur:'لوئر دیر'}))||''));
  check('A6 a name with nothing in it is refused',
    /name/.test(await rejects(Areas.save({en:'   ',ur:''}))||''));

  /* ══ B · renaming ══ */
  const shopA=win.CUSTOMERS.find(c=>c.region!==dir.id && c.region!==drosh.id);
  await Areas.moveCustomer(shopA.id,a1.id,'test');
  const r1=await Areas.save({id:a1.id,en:'Lower Dir Bazar'});
  check('B1 renaming keeps the id, the Urdu name and the shops',
    r1.id===a1.id && r1.ur==='لوئر دیر' && Areas.byId(a1.id).en==='Lower Dir Bazar' && shopsIn(a1.id)===1);
  check('B2 renaming to another area\'s name is refused',
    /already exists/.test(await rejects(Areas.save({id:a1.id,en:dir.en}))||''));
  check('B3 saving an area under its own name is fine', !(await rejects(Areas.save({id:a1.id,en:'Lower Dir Bazar'}))));
  const twin={id:'rg-legacy-twin',en:'Twin',ur:'جڑواں',active:true}, twin2={id:'rg-legacy-twin2',en:'Twin',ur:'جڑواں دو',active:true};
  win.REGIONS.push(twin,twin2);
  check('B4 an older duplicate can still have its other name edited',
    !(await rejects(Areas.save({id:twin.id,ur:'جڑواں نیا'}))) && Areas.byId(twin.id).ur==='جڑواں نیا');
  check('B5 the audit log records the rename',
    ERP.S.audit.some(a=>a.action==='Area updated' && /Lower Dir Bazar/.test(JSON.stringify(a))));

  /* ══ C · deleting ══ */
  const blocked=await rejects(Areas.remove(a1.id));
  check('C1 an area with shops is not deleted unless the shops are given somewhere to go',
    /1 shop is in this area/.test(blocked||'') && !!Areas.byId(a1.id) && shopsIn(a1.id)===1, blocked);
  check('C2 the new home must be a different, active area',
    !!(await rejects(Areas.remove(a1.id,{moveTo:a1.id}))) &&
    !!(await rejects(Areas.remove(a1.id,{moveTo:'rg-nope'}))) && shopsIn(a1.id)===1);
  await Areas.archive(u2.id,true);
  check('C3 ...and not an archived one', !!(await rejects(Areas.remove(a1.id,{moveTo:u2.id}))) && shopsIn(a1.id)===1);
  await Areas.archive(u2.id,false);

  const man=await Staff.save({name:'Gul Rahman',phone:'0300'}), man2=await Staff.save({name:'Israr Ali',phone:'0311'});
  await Areas.assignSalesman(a1.id,man.id); await Areas.assignSalesman(dir.id,man2.id);
  /* a sale made to that shop while it was in the area — history must survive */
  const wh=win.WAREHOUSES[1].id, P=win.PRODUCTS.filter(p=>p.active!==false);
  await ERP.Purchases.save({supplierId:win.SUPPLIERS[0].id,warehouseId:wh,items:[{productId:P[0].id,quantity:100,unitPrice:2000}]});
  const inv=await ERP.Invoices.save({customerId:shopA.id,warehouseId:wh,invoiceDate:'2026-09-02',
    items:[{productId:P[0].id,quantity:5,unitPrice:2500}]});
  const label=()=>{const row=ERP.Reports.byRegion('2026-09-01','2026-09-30').find(x=>x.regionId===a1.id);return row&&row.label;};
  check('C4 before the delete, the region report shows the area\'s current name', /Lower Dir Bazar/.test(label()||''), label());

  const res=await Areas.remove(a1.id,{moveTo:dir.id});
  check('C5 deleting moves its shop to the chosen area in the same step',
    res.moved===1 && win.custBy(shopA.id).region===dir.id && win.custBy(shopA.id).regionAssumed===false &&
    shopsIn(dir.id)===dirShops+1);
  check('C6 the area is gone from every list',
    !Areas.byId(a1.id) && !Areas.all().some(r=>r.id===a1.id) && !Areas.active().some(r=>r.id===a1.id));
  check('C7 ...but a hidden marker stays behind so it cannot come back from an old copy',
    win.REGIONS.some(r=>r.id===a1.id && r.deleted===true && r.active===false && r.deletedAt));
  check('C8 the salesman is taken off it; other salesmen are untouched',
    (Staff.byId(man.id).regionIds||[]).indexOf(a1.id)===-1 && (Staff.byId(man2.id).regionIds||[]).indexOf(dir.id)>-1);
  const aud=ERP.S.audit.find(a=>a.action==='Area deleted' && a.entityId===a1.id);
  check('C9 the audit log records it: who, what, where the shops went',
    !!aud && /Lower Dir Bazar/.test(JSON.stringify(aud)) && JSON.stringify(aud).indexOf(dir.id)>-1);
  const invNow=ERP.Invoices.byId(inv.id);
  check('C10 the invoice keeps the area name it was made with',
    /Lower Dir/.test(invNow.regionSnapshot||'') && invNow.regionId===a1.id, invNow.regionSnapshot);
  check('C11 the region report falls back to that name for the deleted area', /Lower Dir/.test(label()||''), label());
  const again=await Areas.save({en:'Lower Dir Bazar',ur:'لوئر دیر بازار'});
  check('C12 the name can be used again afterwards, as a brand-new area',
    again.id!==a1.id && !!Areas.byId(again.id) && !Areas.byId(a1.id));
  check('C13 an empty area deletes with no destination needed',
    (await Areas.remove(again.id)).moved===0 && !Areas.byId(again.id));
  check('C14 deleting the same area twice is refused, not silently repeated',
    /no longer exists/.test(await rejects(Areas.remove(a1.id))||''));

  /* a failed save puts everything back as it was */
  const tmp=await Areas.save({en:'Temp Zone',ur:'عارضی'});
  const tmpShop=win.CUSTOMERS.find(c=>c.region===dir.id);
  await Areas.moveCustomer(tmpShop.id,tmp.id,'test'); await Areas.assignSalesman(tmp.id,man.id);
  const realTx=win.FDB.tx; win.FDB.tx=()=>Promise.reject(new Error('disk full'));
  const failed=await rejects(Areas.remove(tmp.id,{moveTo:dir.id}));
  win.FDB.tx=realTx;
  check('C15 if the save fails nothing is half-done: area, shop and salesman all as before',
    /disk full/.test(failed||'') && !!Areas.byId(tmp.id) && win.custBy(tmpShop.id).region===tmp.id &&
    (Staff.byId(man.id).regionIds||[]).indexOf(tmp.id)>-1, failed);
  await Areas.remove(tmp.id,{moveTo:dir.id});

  /* only the owner or a manager */
  const realRole=ERP.Session.role; ERP.Session.role=()=>'SALES';
  const salesTry=await rejects(Areas.remove(u1.id));
  win.go('areas'); await sleep(250);
  const salesButtons=$$('[data-areadelete]').length;
  ERP.Session.role=realRole;
  check('C16 a Sales user cannot delete an area, and is not offered the button',
    /owner or a manager/.test(salesTry||'') && !!Areas.byId(u1.id) && salesButtons===0, salesTry+' / '+salesButtons);

  /* archive still behaves */
  await Areas.moveCustomer(shopA.id,u1.id,'test');
  check('C17 an area with shops still cannot be archived', !!(await rejects(Areas.archive(u1.id,true))) && Areas.byId(u1.id).active!==false);
  await Areas.moveCustomer(shopA.id,dir.id,'back');
  await Areas.archive(u1.id,true);
  check('C18 an empty one can, and an archived area can then be deleted',
    Areas.byId(u1.id).active===false && (await Areas.remove(u1.id)).moved===0 && !Areas.byId(u1.id));

  /* ══ D · the screens ══ */
  win.go('areas'); await sleep(300);
  const rows=$$('#view table.fcb-list')[0].querySelectorAll('tbody tr').length;
  check('D1 Areas & salesmen has a Delete button on every area',
    rows>0 && $$('[data-areadelete]').length===rows, $$('[data-areadelete]').length+' vs '+rows);

  const del=$('[data-areadelete="'+drosh.id+'"]');
  click(del); await sleep(300);
  check('D2 Delete opens a panel that names the area, says how many shops move, and lists where',
    !!$('#panel.on') && /Delete area/.test($('#panel').textContent) && $('#panel').textContent.indexOf(drosh.en)>-1 &&
    new RegExp('Move its '+droshShops+' shop').test($('#panel').textContent) &&
    !!$('[data-f="moveTo"]') && Array.from($('[data-f="moveTo"]').options).every(o=>o.value!==drosh.id));
  click($('[data-save="1"]')); await sleep(250);
  check('D3 pressing Delete without choosing where the shops go keeps the panel open with a message',
    !!$('#panel.on') && /Choose the area/.test($('#panelErr').textContent) && !!Areas.byId(drosh.id));
  $('[data-f="moveTo"]').value=dir.id;
  click($('[data-save="1"]')); await sleep(500);
  check('D4 choosing one deletes the area and moves every one of its shops',
    !Areas.byId(drosh.id) && shopsIn(drosh.id)===0 && shopsIn(dir.id)===dirShops+1+droshShops &&
    win.CUSTOMERS.length===totalShops,
    'dir '+shopsIn(dir.id)+' expected '+(dirShops+1+droshShops));
  check('D5 the screen refreshes without it',
    !$('[data-areadelete="'+drosh.id+'"]') && !$('[data-areaedit="'+drosh.id+'"]') && !$('#panel.on'));
  check('D6 no shop anywhere points at a deleted area',
    win.CUSTOMERS.every(c=>{const r=win.REGIONS.find(x=>x.id===c.region);return r && !r.deleted;}));

  /* Settings — the card that used to be add-only */
  win.go('settings'); await sleep(400);
  if(!$('[data-regionlist]')){const g=$('[data-stsection="general"]'); if(g){click(g); await sleep(300);}}
  const list=$('[data-regionlist]');
  const live=Areas.all().length;
  check('D7 Settings → Regions lists every area with Rename and Delete, not just an Add button',
    !!list && list.querySelectorAll('[data-areaedit]').length===live && list.querySelectorAll('[data-areadelete]').length===live &&
    !!list.querySelector('[data-panel="region"]') && !!list.querySelector('[data-go="areas"]'),
    list?list.querySelectorAll('[data-areaedit]').length+'/'+live:'card not found');
  check('D8 the deleted area is not listed there', !list || !list.querySelector('[data-areaedit="'+drosh.id+'"]'));
  const target=Areas.active().find(r=>r.id!==dir.id);
  click(list.querySelector('[data-areaedit="'+target.id+'"]')); await sleep(300);
  check('D9 Rename from Settings opens the area panel filled in',
    !!$('#panel.on') && $('[data-f="en"]').value===target.en && $('[data-f="ur"]').value===target.ur);
  $('[data-f="en"]').value='Renamed From Settings';
  click($('[data-save="1"]')); await sleep(500);
  check('D10 saving renames it and Settings shows the new name',
    Areas.byId(target.id).en==='Renamed From Settings' && /Renamed From Settings/.test(($('[data-regionlist]')||{textContent:''}).textContent));

  /* the base app's own "Add region" button */
  click($('[data-regionlist] [data-panel="region"]')); await sleep(300);
  check('D11 Add region (the base button) opens a blank form', !!$('#panel.on') && $('[data-f="en"]').value==='' && $('[data-f="ur"]').value==='');
  $('[data-f="ur"]').value='بغیر انگریزی'; $('[data-f="en"]').value='';
  click($('[data-save="1"]')); await sleep(500);
  const added=Areas.all().find(r=>r.ur==='بغیر انگریزی');
  check('D12 it adds through the same rules (an Urdu-only name works, with a proper id)', !!added && added.id!=='rg-', added&&added.id);
  click($('[data-regionlist] [data-panel="region"]')); await sleep(300);
  $('[data-f="ur"]').value='بغیر انگریزی'; click($('[data-save="1"]')); await sleep(300);
  check('D13 adding the same name again is refused and the panel stays to say why',
    !!$('#panel.on') || /already exists/.test(D.body.textContent));
  if($('#panel.on')) click($('#panel [data-close="1"]'));

  /* Shops page */
  win.go('customers'); await sleep(400);
  const chip=$('[data-go="areas"]');
  check('D14 the Shops page has a "Manage areas" link beside Add region', !!chip && !!$('.rchip[data-panel="region"]'));
  click(chip); await sleep(300);
  check('D15 it opens the Areas & salesmen screen', win.cur==='areas');

  const all=win.REGIONS.filter(r=>r.deleted).length;
  check('D16 deleted areas are kept as hidden markers, not just dropped', all>=3, String(all));

  /* ══ E · a restart in a browser with no saved copy (another device) ══ */
  const state={live:Areas.all().map(r=>r.id).sort().join(','), dirShops:shopsIn(dir.id), renamed:Areas.byId(target.id).en,
    tomb:win.REGIONS.filter(r=>r.deleted).map(r=>r.id).sort().join(',')};
  win.close(); win=boot(store); await up(win);
  for(let i=0;i<60&&!win.ERP.Staff.all().length;i++) await sleep(50);
  await sleep(300);
  ERP=win.ERP;
  const Areas2=ERP.Areas;
  const shops2=id=>win.CUSTOMERS.filter(c=>c.region===id).length;
  check('E1 after a restart the deleted areas are still deleted (a built-in one included)',
    !Areas2.byId(drosh.id) && !Areas2.byId(a1.id) && Areas2.all().map(r=>r.id).sort().join(',')===state.live,
    Areas2.all().map(r=>r.id).sort().join(',')+' vs '+state.live);
  check('E2 the moved shops stayed moved, and the rename stuck',
    shops2(dir.id)===state.dirShops && shops2(drosh.id)===0 && Areas2.byId(target.id).en===state.renamed);
  check('E3 the hidden markers came back too, so nothing can resurrect them',
    win.REGIONS.filter(r=>r.deleted).map(r=>r.id).sort().join(',')===state.tomb);
  /* an out-of-date copy of the list in memory is put right by the database */
  const stale=win.REGIONS.find(r=>r.id===drosh.id); stale.deleted=false; stale.active=true;
  await ERP.refreshMasterFromDb(); await sleep(100);
  check('E4 a stale copy that still has the area is corrected by the database', !ERP.Areas.byId(drosh.id));
  check('E5 nothing threw during the session', errors.length===0, errors.slice(0,2).join(' | '));
  win.close();
  console.log('\n'+out.join('\n')+'\n\n'+pass+' passed, '+fail+' failed\n');
  process.exit(fail?1:0);
};
run().catch(e=>{console.error('HARNESS ERROR:',e);console.log(out.join('\n'));process.exit(2);});
