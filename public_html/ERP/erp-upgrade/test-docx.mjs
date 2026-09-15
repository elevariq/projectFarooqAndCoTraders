import fs from 'fs';
globalThis.window = undefined;
const src = fs.readFileSync('mod/03-docx.js','utf8');
const g = { TextEncoder, Date, Math, console };
eval(src.replace('typeof window !== \'undefined\' ? window : globalThis','g'));
const DOCX = g.DOCX;
const money = n => 'PKR ' + n.toLocaleString('en-US') + '.00';
const rows = [];
for (let i=1;i<=28;i++){
  rows.push({sr:i, description:'Taj Mahal Sella Rice '+i, descriptionUr:'چاول تاج محل سیلہ '+i,
    brand:'Taj Mahal', pack:'25 KG', qty:'150', rate:'6,830.00', discount:'0.00', amount:'1,024,500.00'});
}
const m = {
  kind:'INVOICE', title:'INVOICE', number:'INV-2026-000123', date:'08 Sep 2026',
  business:{name:'Farooq & Co Traders', tagline:'Rice & Flour Traders & Distributors',
    slogan:'آپ کے اعتماد کا نام', logoText:'F&C', address:'Main Bazar, Dir Bala — مین بازار، دیر بالا',
    city:'Dir Bala, Khyber Pakhtunkhwa', phone:'0321-9535252 / 0345-9535252',
    shopPhone:'0944-881316 / 0944-880316', whatsapp:'0321-9535252', email:'', website:'', ntn:'', registrationNo:''},
  party:{label:'BILL TO', shop:'Waris khan ataliq bazar', owner:'Waris Khan', code:'123',
    contact:'0300-0000000', whatsapp:'', address:'Ataliq Bazar, Chitral', region:'لوئر چترال — Lower Chitral', market:'Ataliq Bazar'},
  metaLabel:'INVOICE DETAILS',
  meta:[['Invoice No', 'INV-2026-000123', true],['Invoice date','08 Sep 2026'],['Due date','22 Sep 2026'],
        ['Order No','SO-2026-000045'],['Warehouse','Main Warehouse'],['Payment status','Partly paid'],['Salesperson','Farooq Ahmed']],
  strip:[['Payment method','Cash'],['Reference','—'],['Region','Lower Chitral'],['Lines','28']],
  columns:[{key:'sr',label:'SR',align:'center',width:0.05},{key:'description',label:'Description',width:0.30},
    {key:'brand',label:'Brand',width:0.13},{key:'pack',label:'Package',align:'center',width:0.09},
    {key:'qty',label:'Qty',align:'right',width:0.08},{key:'rate',label:'Rate',align:'right',width:0.11},
    {key:'discount',label:'Discount',align:'right',width:0.11},{key:'amount',label:'Amount',align:'right',width:0.13}],
  rows,
  itemsFooter:{description:'Total — 28 lines', qty:'4,200', amount:'28,686,000.00'},
  totals:[{label:'Subtotal',value:money(28686000)},{label:'Item discounts',value:'− '+money(5000)},
    {label:'Freight',value:money(12000)},{label:'Grand total',labelUr:'ٹوٹل بل رقم',value:money(28693000),big:true,rule:true},
    {label:'Amount paid',value:money(100000)},{label:'Balance on this invoice',labelUr:'بقایا رقم',value:money(28593000),bold:true}],
  words:'Two Crore Eighty Six Lac Ninety Three Thousand Rupees Only',
  paymentsList:[{date:'08 Sep 2026',method:'Cash',ref:'',amount:money(100000)}],
  notes:'Delivery to Ataliq Bazar godown.',
  ledger:[['Previous balance','PKR 14,474,562.00','سابقہ بقایا رقم'],['This invoice','+ '+money(28693000)],
    ['Payment received','− '+money(100000)],['New outstanding balance',money(43067562),'بقایا رقم']],
  signatures:['Prepared by','Received by (shopkeeper)','Authorised signature'],
  footer:{thanks:'Thank you for your business.', terms:'Goods once sold are the responsibility of the buyer.', bank:''}
};
const bytes = DOCX.generate(m);
fs.writeFileSync('/home/claude/build/test-invoice.docx', Buffer.from(bytes));
console.log('written', bytes.length, 'bytes;', DOCX.filename(m));
