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
    w.indexedDB=store.idb; w.IDBKeyRange=FDBKeyRange; w.print=()=>{}; w.confirm=()=>true;
    w.prompt=()=>'r'; w.scrollTo=()=>{}; w.open=()=>null;
    w.URL.createObjectURL=()=>'b'; w.URL.revokeObjectURL=()=>{};
    w.HTMLElement.prototype.scrollIntoView=function(){};
    w.matchMedia=q=>({media:q,matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});
   }});
  return dom.window;
}
async function ready(w){
  for(let i=0;i<400&&!(w.ERP&&w.ERP.ready);i++)await sleep(25);
  for(let i=0;i<80&&!w.ERP.usersReady;i++)await sleep(25);
  await sleep(200); return w.ERP;
}
const run=async()=>{
  const store={idb:new FDBFactory()};
  let win=boot(store); let ERP=await ready(win);
  const M=win.Money, D=win.document;
  const $=s=>D.querySelector(s), $$=s=>Array.from(D.querySelectorAll(s));
  const click=el=>el&&el.dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true}));
  const change=(el,v)=>{if(el){el.value=v;el.dispatchEvent(new win.Event('change',{bubbles:true}));}};
  const Master=ERP.MasterEdit, Sheet=ERP.MasterSheet, Fields=ERP.Fields;
  const P=win.PRODUCTS, prod=P[2];

  /* every product detail */
  const fields=Fields.of('product').map(f=>f.k);
  check('B1 every product detail is editable, names included',
    ['ur','en','brandEn','brand','cat','unit','kg','sku','description','notes','active']
      .every(k=>fields.indexOf(k)>-1), fields.join(','));
  await Master.update('product',prod.id,{ur:'چاول تاج محل خاص',en:'Taj Mahal Special Sella',
    brandEn:'Taj Mahal',brand:'تاج محل',cat:'چاول',unit:'Bag',kg:25,sku:'TM-25',
    description:'Long grain sella, 25 kg bag',notes:'Best seller'},{reason:'renamed'});
  const after=win.prodOf(prod.id);
  check('B2 the Urdu and English names both change',
    after.ur==='چاول تاج محل خاص' && after.en==='Taj Mahal Special Sella');
  check('B3 brand, category, unit, size, SKU, description and note all change',
    after.brandEn==='Taj Mahal' && after.cat==='چاول' && after.kg===25 &&
    after.sku==='TM-25' && /Long grain/.test(after.description) && after.notes==='Best seller');
  check('B4 the change is on the audit log with what it was',
    ERP.S.audit.some(a=>/Product details changed/.test(a.action) &&
      a.oldValues && a.oldValues.en!==undefined));
  check('B5 a product cannot be left with no name at all',
    await Master.update('product',prod.id,{ur:'',en:''},{}).then(()=>false)
      .catch(e=>/needs a name/.test(e.validation[0])));
  check('B6 an unchanged save reports nothing to do',
    (await Master.update('product',prod.id,{en:'Taj Mahal Special Sella'},{})).unchanged===true);

  /* shops and suppliers */
  const c=win.CUSTOMERS[5];
  await Master.update('customer',c.id,{sh:'Al-Habib Traders',ow:'Habib Ullah',
    ph:'0300-1112223',addr:'Main Bazar, Drosh',route:'Route 4'},{reason:'corrected'});
  check('B7 a shop\'s name, owner, phone, address and route all change',
    win.custBy(c.id).sh==='Al-Habib Traders' && win.custBy(c.id).ow==='Habib Ullah' &&
    win.custBy(c.id).route==='Route 4');
  const sp=win.SUPPLIERS[1];
  await Master.update('supplier',sp.id,{co:'Chitral Flour Mills',cp:'Rahim Khan',lo:'Chitral'},
    {reason:'corrected'});
  check('B8 a supplier is just as editable', win.supOf(sp.id).co==='Chitral Flour Mills');
  const made=await Master.create('product',{ur:'نیا چاول',en:'New Rice',cat:'چاول'});
  check('B9 a new product can be added and gets its own id',
    /^PRD-\d{4}$/.test(made.id) && win.prodOf(made.id).en==='New Rice');

  /* fields the business invents */
  await Fields.add('product',{label:'Shelf code'});
  check('B10 an extra field can be added without touching the code',
    Fields.of('product').some(f=>f.l==='Shelf code'));
  const key=Fields.all('product')[0].k;
  await Master.update('product',prod.id,{[key]:'A-14'},{reason:'shelf'});
  check('B11 it saves like any other field', win.prodOf(prod.id)[key]==='A-14');
  check('B12 it appears in the CSV', /Shelf code/.test(Sheet.toCsv('product')));

  /* many at once */
  const ids=P.slice(10,20).map(p=>p.id);
  check('B13 a bulk change needs a reason',
    await Master.bulk('product',ids,{cat:'وغیرہ'},{}).then(()=>false)
      .catch(e=>/reason/.test(e.validation[0])));
  const bulk=await Master.bulk('product',ids,{cat:'وغیرہ'},{reason:'recategorised'});
  check('B14 ten products change category in one go', bulk.changed>0 &&
    ids.every(id=>win.prodOf(id).cat==='وغیرہ'), String(bulk.changed));
  check('B15 the bulk change is one audit entry naming the count',
    ERP.S.audit.some(a=>/Bulk change to \d+ products/.test(a.action) && a.reason==='recategorised'));
  await Master.bulk('customer',[win.CUSTOMERS[6].id,win.CUSTOMERS[7].id],
    {region:win.REGIONS[2].id},{reason:'route change'});
  check('B16 shops can be moved between areas in bulk',
    win.custBy(win.CUSTOMERS[6].id).region===win.REGIONS[2].id);

  /* prices in bulk */
  const priced=P.slice(20,25).map(p=>p.id);
  for (const id of priced) await ERP.Prices.set(id,{sell:2000},{reason:'base'});
  const preview=Master.previewBulkPrice(priced,{field:'sell',mode:'percent',amount:10});
  check('B17 a bulk price change can be previewed before it runs',
    preview.length===5 && preview[0].to===M.toP(2200), M.fmt(preview[0].to));
  const applied=await Master.bulkPrice(priced,{field:'sell',mode:'percent',amount:10},'Mill rate up');
  check('B18 ten per cent on five products', applied.changed===5 &&
    ERP.Prices.of(priced[0]).sell===M.toP(2200));
  await Master.bulkPrice(priced,{field:'sell',mode:'fixed',amount:-100},'Discount season');
  check('B19 a fixed amount works too', ERP.Prices.of(priced[0]).sell===M.toP(2100));
  await Master.bulkPrice(priced,{field:'sell',mode:'set',amount:2500},'One price for all');
  check('B20 or one price for all', ERP.Prices.of(priced[4]).sell===M.toP(2500));
  check('B21 every one is in the price history',
    ERP.Prices.history(priced[0]).length>=4, String(ERP.Prices.history(priced[0]).length));

  /* spreadsheets */
  const csv=Sheet.toCsv('product');
  check('B22 products export with a header row and every product',
    csv.split('\n').length===win.PRODUCTS.length+1, String(csv.split('\n').length));
  const grid=Sheet.parse(csv);
  const header=grid[0];
  const enCol=header.indexOf('Name (English)');
  const idCol=header.indexOf('ID');
  grid[3][enCol]='Renamed By Spreadsheet';
  const write=g=>'\ufeff'+g.map(r=>r.map(c=>'"'+String(c===undefined?'':c).replace(/"/g,'""')+'"').join(',')).join('\n');
  const edited=write(grid);
  const plan=Sheet.plan('product',edited);
  check('B23 an import says what it would change before doing it',
    plan.updates.length===1 && plan.creates.length===0 && plan.problems.length===0,
    JSON.stringify(plan.updates.map(x=>({id:x.id,f:x.fields}))));
  check('B24 the record it would touch is named, with the fields',
    plan.updates[0].fields.indexOf('Name (English)')>-1);
  const targetId=grid[3][idCol];
  check('B25 nothing has changed yet', win.prodOf(targetId).en!=='Renamed By Spreadsheet');
  const res=await Sheet.apply(plan,'Spreadsheet');
  check('B26 applying it makes exactly that change',
    res.updated===1 && win.prodOf(targetId).en==='Renamed By Spreadsheet');
  const plan2=Sheet.plan('product',write(grid.slice(0,4)));
  check('B27 a partial file never removes the rows it leaves out',
    plan2.updates.length+plan2.creates.length<=3 &&
    win.PRODUCTS.length>=136);
  const bad=Sheet.plan('product','Name,Brand\nx,y');
  check('B28 a file with no ID column is refused with a reason',
    !!bad.error && /ID column/.test(bad.error));
  const blank=header.map(()=>'');
  blank[idCol]='PRD-9001';
  blank[enCol]='Imported Product';
  const plan3=Sheet.plan('product',write([header,blank]));
  check('B29 a row with a new ID is offered as an addition, not an edit',
    plan3.creates.length===1, JSON.stringify({u:plan3.updates.length,c:plan3.creates.length}));

  /* the screen */
  win.go('masterdata'); await sleep(300);
  check('B30 the workbench opens with all three record types',
    $$('[data-wbentity]').length===3 && !!$('table.wb-table'));
  check('B31 rows are editable in place', $$('[data-wbcell]').length>0);
  check('B32 it pages rather than drawing 136 rows at once',
    $$('table.wb-table tbody tr').length<=40, String($$('table.wb-table tbody tr').length));
  const cell=$$('[data-wbcell="en"]')[0];
  const rowId=cell.dataset.id;
  change(cell,'Edited In Place'); await sleep(300);
  check('B33 an inline edit saves straight away',
    win.prodOf(rowId).en==='Edited In Place');
  const box=$('[data-wbsel="'+rowId+'"]');
  box.checked=true; box.dispatchEvent(new win.Event('change',{bubbles:true})); await sleep(300);
  check('B34 selecting a row offers the bulk actions',
    !!$('[data-wbbulk]') && /selected/.test($('.wb-actions')?$('.wb-actions').textContent:''),
    $('.wb-actions')?'bar shown':'no bar');
  click($('[data-wbentity="customer"]')); await sleep(250);
  check('B35 switching to shops shows their own columns',
    /Shop name/.test($('#view').textContent));
  check('B36 an extra field can be added from the screen', !!$('[data-wbfieldadd]'));
  check('B37 CSV in and out are on the screen', !!$('[data-wbexport]') && !!$('[data-wbimport]'));

  /* persistence */
  await ERP.flush(); await sleep(400);
  const state={name:win.prodOf(prod.id).en,shelf:win.prodOf(prod.id)[key],
    cat:win.prodOf(ids[0]).cat,fields:Fields.all('product').length,
    products:win.PRODUCTS.length,sell:ERP.Prices.of(priced[0]).sell};
  win.close();
  win=boot(store); ERP=await ready(win);
  check('B38 the edits survive a restart',
    win.prodOf(prod.id).en===state.name && win.prodOf(ids[0]).cat===state.cat,
    win.prodOf(prod.id).en);
  check('B39 the custom field and its value survive',
    ERP.Fields.all('product').length===state.fields && win.prodOf(prod.id)[key]===state.shelf);
  check('B40 the new product and the bulk prices survive',
    win.PRODUCTS.length===state.products && ERP.Prices.of(priced[0]).sell===state.sell);
  check('B41 nothing threw during the session', errors.length===0, errors.slice(0,2).join(' | '));
  win.close();
  console.log('\n'+out.join('\n')+'\n\n'+pass+' passed, '+fail+' failed\n');
  process.exit(fail?1:0);
};
run().catch(e=>{console.error('HARNESS ERROR:',e);console.log(out.join('\n'));process.exit(2);});
