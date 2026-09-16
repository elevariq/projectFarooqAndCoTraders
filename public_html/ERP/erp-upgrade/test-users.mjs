import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import FDBKeyRange from 'fake-indexeddb/lib/FDBKeyRange';
const HTML=fs.readFileSync('dist/farooq-co-erp.html','utf8');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
/* polls for an actual settled condition instead of guessing a fixed delay —
   used where a click fires an async signIn() whose resolve time isn't
   guaranteed, so a slow resolve can't leak into and corrupt the next step */
const waitUntil=async(fn,timeoutMs=1500,stepMs=20)=>{const start=Date.now();while(Date.now()-start<timeoutMs){if(fn())return true;await sleep(stepMs);}return fn();};
let pass=0,fail=0;const out=[];
const check=(n,c,d)=>{if(c){pass++;out.push('  ✔ '+n);}else{fail++;out.push('  ✘ '+n+(d?'   → '+d:''));}};
const errors=[];
function boot(store){
  const vc=new VirtualConsole(); vc.on('jsdomError',e=>errors.push(e.message));
  const dom=new JSDOM(HTML,{runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,
   url:'https://x.local/e',beforeParse(w){
    w.indexedDB=store.idb; w.IDBKeyRange=FDBKeyRange; w.print=()=>{}; w.confirm=()=>true;
    w.prompt=()=>'reason'; w.scrollTo=()=>{}; w.open=()=>null;
    w.URL.createObjectURL=()=>'b'; w.URL.revokeObjectURL=()=>{};
    w.HTMLElement.prototype.scrollIntoView=function(){};
    w.matchMedia=q=>({media:q,matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});
   }});
  return dom.window;
}
async function ready(w){
  for(let i=0;i<400&&!(w.ERP&&w.ERP.ready);i++)await sleep(25);
  for(let i=0;i<80&&!w.ERP.usersReady;i++)await sleep(25);
  await sleep(150); return w.ERP;
}
const run=async()=>{
  const store={idb:new FDBFactory()};
  let win=boot(store); let ERP=await ready(win);
  const M=win.Money, D=win.document;
  const $=s=>D.querySelector(s), $$=s=>Array.from(D.querySelectorAll(s));
  const click=el=>el&&el.dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true}));

  /* accounts */
  check('U1 a fresh install has one owner account, signed in',
    ERP.Users.all().length===1 && ERP.Session.role()==='OWNER' && !!ERP.Session.user());
  check('U2 the signed-in name is what the app records as the user',
    win.CURRENT_USER===ERP.Session.name());
  const owner=ERP.Users.all()[0];
  const sales=await ERP.Users.save({name:'Kamran Sales',role:'SALES',pin:'1234'});
  const acct=await ERP.Users.save({name:'Bilal Accounts',role:'ACCOUNTANT'});
  check('U3 people can be added with a role', ERP.Users.all().length===3 && sales.role==='SALES');
  check('U4 two people cannot share a name',
    await ERP.Users.save({name:'Kamran Sales',role:'SALES'}).then(()=>false)
      .catch(e=>/already signed up/i.test(e.validation[0])));
  check('U5 the last owner cannot be demoted',
    await ERP.Users.save({id:owner.id,role:'SALES'}).then(()=>false)
      .catch(e=>/only owner/i.test(e.validation[0])));
  check('U6 nor switched off',
    await ERP.Users.archive(owner.id).then(()=>false)
      .catch(e=>/only owner|signed in/i.test(e.validation[0])));

  /* signing in */
  check('U7 a wrong PIN is refused',
    await ERP.Session.signIn(sales.id,'9999').then(()=>false)
      .catch(e=>/PIN is not right/i.test(e.validation[0])));
  check('U8 the right PIN signs in', !!(await ERP.Session.signIn(sales.id,'1234')));
  check('U9 the role now follows the account, not a setting',
    ERP.Session.role()==='SALES' && ERP.RBAC.role()==='SALES' && win.CURRENT_USER==='Kamran Sales');
  check('U10 an account with no PIN signs in without one',
    !!(await ERP.Session.signIn(acct.id,'')) && ERP.Session.role()==='ACCOUNTANT');
  await ERP.Session.signIn(sales.id,'1234');
  check('U11 a salesman cannot promote himself',
    await (async()=>{ await ERP.RBAC.setRole('OWNER'); return ERP.Session.role()==='SALES'; })());

  /* the point of all this: an approval is by someone else */
  await ERP.Session.signIn(owner.id,'');
  await ERP.Settings.save({priceApproval:true, allowSelfApproval:false});
  const P=win.PRODUCTS.filter(p=>p.active!==false);
  const prod=P[3];
  await ERP.Prices.set(prod.id,{buy:2000,sell:2400},{reason:'opening'});
  await ERP.Session.signIn(sales.id,'1234');
  await ERP.Prices.set(prod.id,{sell:2600},{reason:'market'});
  const pend=ERP.Prices.pending(prod.id)[0];
  check('U12 the request records the account that raised it',
    pend.requestedByUserId===sales.id && pend.requestedBy==='Kamran Sales');
  check('U13 the same person cannot approve their own request',
    await ERP.Prices.approve(pend.id).then(()=>false)
      .catch(e=>/someone else|owner or a manager/i.test(e.validation[0])));
  check('U14 and the price is untouched', ERP.Prices.of(prod.id).sell===M.toP(2400));
  await ERP.Session.signIn(owner.id,'');
  await ERP.Prices.approve(pend.id);
  const h=ERP.Prices.history(prod.id)[0];
  check('U15 approved by the owner, the change goes through',
    ERP.Prices.of(prod.id).sell===M.toP(2600));
  check('U16 the trail names two different people',
    h.changedBy==='Kamran Sales' && h.approvedBy===owner.name && h.changedBy!==h.approvedBy,
    h.changedBy+' / '+h.approvedBy);

  /* a one-person business can still work */
  await ERP.Settings.save({allowSelfApproval:true});
  await ERP.Session.signIn(sales.id,'1234');
  await ERP.Prices.set(prod.id,{sell:2700},{reason:'alone today'});
  const p2=ERP.Prices.pending(prod.id)[0];
  await ERP.Session.signIn(owner.id,'');
  check('U17 self-approval can be allowed deliberately for a one-person shop',
    !!(await ERP.Prices.approve(p2.id)) && ERP.Prices.of(prod.id).sell===M.toP(2700));
  await ERP.Settings.save({allowSelfApproval:false, priceApproval:false});

  /* the audit trail */
  const a=ERP.S.audit[0];
  check('U18 every audited action carries the account, name and role',
    !!a.userId && !!a.userName && !!a.userRole, JSON.stringify({u:a.userName,r:a.userRole}));
  check('U19 signing in and out is itself audited',
    ERP.S.audit.some(x=>x.action==='Signed in'));

  /* the screen */
  win.go('dashboard'); await sleep(200);
  check('U20 the header shows who is signed in',
    !!$('#fcUserChip') && $('#fcUserChip').textContent.includes(ERP.Session.name()));
  click($('#fcUserChip')); await sleep(200);
  check('U21 tapping it offers the other accounts',
    !!$('#fcSignin.on') && $$('[data-siuser]').length===3);
  /* the pre-existing flake this fixes: that earlier no-PIN switch's own
     signIn() can occasionally resolve late, and its closeSignin() callback
     then wipes the PIN dialog the very next step just rendered. Waiting for
     the actual settled state — not a fixed delay — means a late resolve
     here can never leak into and corrupt the next step. */
  click($$('[data-siuser]').find(b=>b.dataset.siuser===acct.id));
  await waitUntil(()=>ERP.Session.id()===acct.id && !$('#fcSignin.on'));
  check('U22 an account without a PIN switches straight over',
    ERP.Session.id()===acct.id && !$('#fcSignin.on'));
  click($('#fcUserChip')); await sleep(150);
  click($$('[data-siuser]').find(b=>b.dataset.siuser===sales.id));
  await waitUntil(()=>!!D.getElementById('siPin'));
  check('U23 an account with a PIN asks for it', !!D.getElementById('siPin'));
  const pinEl=D.getElementById('siPin'); pinEl.value='1234';
  click($('[data-si="go"]')); await sleep(300);
  check('U24 the right PIN switches user', ERP.Session.id()===sales.id);
  await ERP.Session.signIn(owner.id,'');
  win.go('settings'); await sleep(200);
  win.ERP.SettingsUI.section='people'; win.paint(); await sleep(250);
  check('U25 accounts are managed in Settings → Users & roles',
    /User accounts/.test($('#view').textContent) && $$('[data-useredit]').length>=3);

  /* persistence */
  await ERP.flush(); await sleep(400);
  const state={users:ERP.Users.all().length,session:ERP.Session.id(),role:ERP.Session.role()};
  win.close();
  win=boot(store); ERP=await ready(win);
  check('U26 accounts survive a restart', ERP.Users.all().length===state.users);
  check('U27 the session is resumed as the same person',
    ERP.Session.id()===state.session && ERP.Session.role()===state.role &&
    win.CURRENT_USER===ERP.Session.name(),
    ERP.Session.name()+' / '+ERP.Session.role());
  check('U28 the PIN still works after a restart',
    ERP.Users.checkPin(ERP.Users.byId(sales.id),'1234')===true &&
    ERP.Users.checkPin(ERP.Users.byId(sales.id),'0000')===false);
  check('U29 nothing threw during the session', errors.length===0, errors.slice(0,2).join(' | '));
  win.close();
  console.log('\n'+out.join('\n')+'\n\n'+pass+' passed, '+fail+' failed\n');
  process.exit(fail?1:0);
};
run().catch(e=>{console.error('HARNESS ERROR:',e);console.log(out.join('\n'));process.exit(2);});
