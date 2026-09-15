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
  const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
  const dom=new JSDOM(HTML,{runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,
   url:'https://x.local/e',beforeParse(w){
    w.indexedDB=store.idb; w.IDBKeyRange=FDBKeyRange; w.print=()=>{store.printed=(store.printed||0)+1;};
    w.confirm=()=>true; w.scrollTo=()=>{}; w.open=()=>null;
    w.URL.createObjectURL=()=>'b'; w.URL.revokeObjectURL=()=>{};
    w.HTMLElement.prototype.scrollIntoView=function(){};
    w.matchMedia=q=>({media:q,matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});
   }});
  return dom.window;
}
const run=async()=>{
  const store={idb:new FDBFactory()};
  let win=boot(store);
  for(let i=0;i<600&&!(win.ERP&&win.ERP.fullyReady);i++)await sleep(25);
  const D=win.document,M=win.Money;
  const $=s=>D.querySelector(s),$$=s=>Array.from(D.querySelectorAll(s));
  const click=el=>el&&el.dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true}));
  const type=(el,v)=>{if(el){el.value=v;el.dispatchEvent(new win.Event('input',{bubbles:true}));}};
  let ERP=win.ERP;
  const wh=win.WAREHOUSES[1].id,P=win.PRODUCTS.filter(p=>p.active!==false);
  await ERP.Purchases.save({supplierId:win.SUPPLIERS[0].id,warehouseId:wh,
    items:P.slice(0,4).map(p=>({productId:p.id,quantity:400,unitPrice:2000}))});
  const inv=await ERP.Invoices.save({customerId:win.CUSTOMERS[2].id,warehouseId:wh,invoiceDate:'2026-09-10',
    items:P.slice(0,3).map((p,i)=>({productId:p.id,quantity:10+i,unitPrice:3000}))});
  const items=ERP.Invoices.items(inv.id);

  /* ── the editor is offered at the moment of exporting ── */
  ERP.Viewer.open(ERP.DocModel.invoice(inv.id)); await sleep(150);
  check('X1 the editor is the lead action on the sheet, ahead of the export buttons',
    (()=>{const bar=$('#fcviewer .fcv-bar');const b=bar.querySelector('[data-fcv="edittext"]');
      const p=bar.querySelector('[data-fcv="print"]');
      return !!b && b.className.includes('pri') &&
        (b.compareDocumentPosition(p) & win.Node.DOCUMENT_POSITION_FOLLOWING)>0;})());
  click($('[data-fcv="print"]')); await sleep(150);
  check('X2 pressing Print asks whether to check it over first', !!$('#fcExport.on'));
  check('X3 both choices are offered', !!$('[data-fcx="edit"]') && !!$('[data-fcx="now"]'));
  const printsBefore=store.printed||0;
  click($('[data-fcx="now"]')); await sleep(250);
  check('X4 "Print now" goes straight through', (store.printed||0)>printsBefore && !$('#fcExport.on'));
  click($('[data-fcv="word"]')); await sleep(150);
  check('X5 the same question is asked for Word', !!$('#fcExport.on'));
  click($('[data-fcx="edit"]')); await sleep(300);
  check('X6 choosing to edit opens the editor and closes the sheet',
    !!$('#fceditor.on') && !$('#fcviewer.on'));
  check('X7 the editor carries its own Print, PDF and Word buttons',
    !!$('[data-fce="print"]') && !!$('[data-fce="pdf"]') && !!$('[data-fce="word"]'));
  ERP.Editor.close(true); await sleep(120);

  /* the preference can be made permanent */
  await ERP.ExportFlow.setFlow('direct'); await sleep(120);
  ERP.Viewer.open(ERP.DocModel.invoice(inv.id)); await sleep(150);
  const p2=store.printed||0;
  click($('[data-fcv="print"]')); await sleep(250);
  check('X8 set to export straight away, no question is asked',
    !$('#fcExport.on') && (store.printed||0)>p2);
  await ERP.ExportFlow.setFlow('edit'); await sleep(120);
  ERP.Viewer.open(ERP.DocModel.invoice(inv.id)); await sleep(150);
  click($('[data-fcv="pdf"]')); await sleep(300);
  check('X9 set to always edit, the editor opens instead of exporting', !!$('#fceditor.on'));
  ERP.Editor.close(true); await sleep(100);
  await ERP.ExportFlow.setFlow('ask'); await sleep(120);
  win.go('invoices'); await sleep(150);
  check('X10 the invoice list offers Edit & export directly', !!$('[data-fcinv="editdoc"]'));
  click($('[data-fcinv="editdoc"]')); await sleep(300);
  check('X11 it opens the editor for that invoice',
    !!$('#fceditor.on') && ERP.Editor.invoiceId===inv.id);
  ERP.Editor.close(true); await sleep(120);

  /* open the preview and step into the editor */
  ERP.Viewer.open(ERP.DocModel.invoice(inv.id)); await sleep(150);
  check('E1 the preview offers editing before printing', !!$('[data-fcv="edittext"]'));
  click($('[data-fcv="edittext"]')); await sleep(250);
  check('E2 the editor opens with a form and a live preview',
    !!$('#fceditor.on') && !!$('.fce-form') && !!$('#fcePrev .fcdoc'));
  check('E3 every line is editable', $$('.fce-line').length===3, String($$('.fce-line').length));
  check('E4 header, customer, totals and comments are all editable',
    !!$('[data-fcefield="title"]') && !!$('[data-fcefield="shop"]') &&
    !!$('[data-fcefield="paidAmount"]') && !!$('[data-fcefield="notes"]'));

  /* header edits */
  type($('[data-fcefield="shop"]'),'Al-Habib Traders (Head Office)'); await sleep(60);
  check('E5 a header edit shows in the preview at once',
    $('#fcePrev').textContent.includes('Al-Habib Traders (Head Office)'));
  type($('[data-fcefield="title"]'),'TAX INVOICE'); await sleep(60);
  check('E6 the title can be changed', $('#fcePrev').textContent.includes('TAX INVOICE'));

  /* item edits recalculate */
  const qty=$$('[data-fcerow][data-f="quantity"]')[0];
  type(qty,'25'); await sleep(80);
  let sheet=ERP.buildSheet(inv.id);
  check('E7 changing a quantity recalculates the line', sheet.lines[0].qty===25 &&
    sheet.lines[0].amount===M.toP(25*3000), M.fmt(sheet.lines[0].amount));
  const rate=$$('[data-fcerow][data-f="unitPrice"]')[0];
  type(rate,'3250'); await sleep(80);
  sheet=ERP.buildSheet(inv.id);
  check('E8 changing a rate recalculates the line and the total',
    sheet.lines[0].amount===M.toP(25*3250) &&
    sheet.grand===sheet.lines.reduce((a,l)=>a+l.amount,0), M.fmt(sheet.grand));
  type($$('[data-fcerow][data-f="discount"]')[0],'2000'); await sleep(80);
  sheet=ERP.buildSheet(inv.id);
  check('E9 a line discount comes off the line',
    sheet.lines[0].amount===M.toP(25*3250-2000));
  type($$('[data-fcerow][data-f="description"]')[1],'Sona Chandi Rice — best grade'); await sleep(80);
  check('E10 a product name can be reworded for this invoice only',
    $('#fcePrev').textContent.includes('best grade') &&
    ERP.Invoices.items(inv.id)[1].descriptionEnSnapshot!=='Sona Chandi Rice — best grade');

  /* add and remove lines */
  click($('[data-fce="addline"]')); await sleep(120);
  check('E11 an extra line can be added', $$('.fce-line').length===4);
  const newRow=$$('.fce-line')[3];
  type(newRow.querySelector('[data-f="description"]'),'Loading labour — 3 men');
  type(newRow.querySelector('[data-f="quantity"]'),'1');
  type(newRow.querySelector('[data-f="unitPrice"]'),'4500'); await sleep(120);
  check('E12 the added line prints and counts in the total',
    $('#fcePrev').textContent.includes('Loading labour — 3 men') &&
    ERP.buildSheet(inv.id).grand===ERP.buildSheet(inv.id).lines.reduce((a,l)=>a+l.amount,0));
  click($$('.fce-line')[2].querySelector('[data-fceremove]')); await sleep(150);
  check('E13 a line can be taken off the printed invoice',
    ERP.buildSheet(inv.id).lines.length===3 && ERP.Invoices.items(inv.id).length===3);

  /* extra charges */
  click($('[data-fce="addcharge"]')); await sleep(120);
  type($('[data-fcecharge="0"][data-f="label"]'),'Freight to Chitral');
  type($('[data-fcecharge="0"][data-f="amount"]'),'12000'); await sleep(150);
  sheet=ERP.buildSheet(inv.id);
  check('E14 an extra charge is added to the total and shown on the sheet',
    $('#fcePrev').textContent.includes('Freight to Chitral') &&
    sheet.grand===sheet.lines.reduce((a,l)=>a+l.amount,0)+M.toP(12000), M.fmt(sheet.grand));
  click($('[data-fce="addcharge"]')); await sleep(100);
  type($('[data-fcecharge="1"][data-f="label"]'),'Goodwill discount');
  type($('[data-fcecharge="1"][data-f="amount"]'),'-5000'); await sleep(150);
  check('E15 a negative charge works as a discount',
    ERP.buildSheet(inv.id).grand===sheet.grand-M.toP(5000));

  /* comments */
  type($('[data-fcefield="notes"]'),
    'Special instructions:\nDelivery required before evening.\nPayment will be collected after 15 days.');
  await sleep(150);
  check('E16 a multi-line comment prints on the invoice',
    $('#fcePrev').textContent.includes('Payment will be collected after 15 days'));
  click($('[data-fce="savedefaultnote"]')); await sleep(250);
  check('E17 a comment can be kept as the default',
    /15 days/.test(ERP.Settings.get().defaultInvoiceNotes||''));
  check('E18 previous comments are remembered', (ERP.Settings.get().noteHistory||[]).length>0);

  /* the edited version is what is exported */
  await ERP.Editor.flush(); await sleep(150);
  const model=ERP.DocModel.invoice(inv.id);
  check('E19 the document model carries the edits', model.edited===true &&
    model.party.shop==='Al-Habib Traders (Head Office)' && model.title==='TAX INVOICE');
  check('E20 the printed lines are the edited lines', model.rows.length===3 &&
    model.rows.some(r=>/Loading labour/.test(r.description)));
  const bytes=win.DOCX.generate(model);
  const xml=Buffer.from(bytes).toString('utf8');
  check('E21 the Word file contains the edited wording',
    xml.includes('Loading labour') && xml.includes('Head Office'), String(bytes.length));
  check('E22 the Word file contains the edited total',
    xml.includes(M.fmtPlain(ERP.buildSheet(inv.id).grand)));
  check('E23 the comment reaches the Word file', xml.includes('collected after 15 days'));
  const html=ERP.Paper.html(model);
  check('E24 print and PDF use the same edited sheet',
    html.includes('Loading labour') && html.includes(M.fmtPlain(ERP.buildSheet(inv.id).grand)));

  /* the underlying record is untouched */
  check('E25 the invoice record itself is unchanged',
    ERP.Invoices.byId(inv.id).grandTotal===inv.grandTotal &&
    ERP.Invoices.items(inv.id).length===3 &&
    ERP.Invoices.items(inv.id)[0].quantity===10);
  check('E26 stock and the ledger are not moved by editing the paper',
    ERP.Ledger.customerBalance(inv.customerId)===inv.grandTotal);

  /* revisions — history starts once there is a previous version to keep */
  check('E27a the edits are stored against the invoice',
    !!ERP.Edits.get(inv.id) && ERP.Edits.has(inv.id));
  type($('[data-fcefield="salesperson"]'),'Farooq Jameel'); await sleep(100);
  await ERP.Editor.flush(); await sleep(150);
  check('E27 a revision history is kept once there is an earlier version',
    (ERP.Edits.get(inv.id).revisions||[]).length>0,
    String((ERP.Edits.get(inv.id).revisions||[]).length));
  const beforeTitle=ERP.buildSheet(inv.id).title;
  type($('[data-fcefield="title"]'),'PROFORMA'); await sleep(100);
  await ERP.Editor.flush(); await sleep(150);
  ERP.Editor.render(); await sleep(60);
  const revBtn=$('[data-fcerev]');
  check('E28 earlier versions are listed with a restore button', !!revBtn);
  click(revBtn); await sleep(400);
  check('E29 restoring an earlier version brings the wording back',
    ERP.buildSheet(inv.id).title===beforeTitle, ERP.buildSheet(inv.id).title);

  /* autosave survives the page closing */
  const counts={grand:ERP.buildSheet(inv.id).grand, title:ERP.buildSheet(inv.id).title,
                notes:ERP.buildSheet(inv.id).notes, lines:ERP.buildSheet(inv.id).lines.length};
  await ERP.Editor.flush(); await sleep(300);
  win.close();
  win=boot(store);
  for(let i=0;i<600&&!(win.ERP&&win.ERP.fullyReady);i++)await sleep(25);
  ERP=win.ERP; await sleep(200);
  const after=ERP.buildSheet(inv.id);
  check('E30 the edits are still there after the app is closed and reopened',
    !!after && after.title===counts.title && after.grand===counts.grand &&
    after.lines.length===counts.lines, after?after.title+' / '+win.Money.fmt(after.grand):'gone');
  check('E31 the comment survived too', after.notes===counts.notes);
  check('E32 a reopened invoice still prints the edited version',
    ERP.DocModel.invoice(inv.id).edited===true &&
    ERP.Paper.html(ERP.DocModel.invoice(inv.id)).includes('Loading labour'));
  check('E33 an untouched invoice is not marked as edited', !ERP.Edits.has('no-such-invoice'));

  /* undoing all edits */
  await ERP.Edits.clear(inv.id); await sleep(150);
  const clean=ERP.DocModel.invoice(inv.id);
  check('E34 undoing the edits prints the invoice as recorded',
    !clean.edited && clean.rows.length===3 && !/Loading labour/.test(ERP.Paper.html(clean)));
  check('E35 nothing threw during the editing session', errors.length===0, errors.slice(0,2).join(' | '));
  win.close();
  console.log('\n'+out.join('\n')+'\n\n'+pass+' passed, '+fail+' failed\n');
  process.exit(fail?1:0);
};
run().catch(e=>{console.error('HARNESS ERROR:',e);console.log(out.join('\n'));process.exit(2);});
