/* ===== SOX / SOXL / SPY / SPXL 退避戦略シミュレーター ===== */

/* ---------- market data (bundled + localStorage overrides) ---------- */
const LS_KEY = 'market_override_v2';
let MK = window.MARKET;                         // {gspc:{dates,px}, sox:{dates,px}, ff:{dates,rate}, updated}
(function loadOverride(){
  try{
    const o = JSON.parse(localStorage.getItem(LS_KEY));
    if(o && o.updated >= MK.updated) MK = o;     // use cached-refreshed data if newer
  }catch(e){}
})();

/* asset -> underlying + leverage + expense field */
const ASSET = {
  NDX : {under:'ndx',  L:1, expId:null,    label:'NDX100(Nasdaq-100)'},
  QLD : {under:'ndx',  L:2, expId:'eQLD',  label:'QLD(NDX×2倍・仮想)'},
  TQQQ: {under:'ndx',  L:3, expId:'eTQQQ', label:'TQQQ(NDX×3倍・仮想)'},
  SOX : {under:'sox',  L:1, expId:null,    label:'SOX(半導体指数)'},
  SOXL: {under:'sox',  L:3, expId:'eSOXL', label:'SOXL(SOX×3倍・仮想)'},
  SPY : {under:'gspc', L:1, expId:'eSPY',  label:'SPY(S&P500)'},
  SPXL: {under:'gspc', L:3, expId:'eSPXL', label:'SPXL(S&P500×3倍・仮想)'},
};
const UNDER_NAME = {ndx:'Nasdaq-100', sox:'SOX(半導体)', gspc:'S&P500'};

/* ---------- UI state ---------- */
const S = {asset:'NDX', strat:'hold', logic:'OR', escape:'cash'};

function seg(id, key, cb){
  const g = document.getElementById(id);
  g.addEventListener('click', e=>{
    const b = e.target.closest('button'); if(!b) return;
    [...g.children].forEach(x=>x.classList.remove('on'));
    b.classList.add('on'); S[key] = b.dataset.v; (cb||run)();
  });
}
seg('asset','asset', ()=>{ syncPickerRange(); run(); });
seg('escape','escape');
seg('logic','logic');
seg('strat','strat', ()=>{ toggleStrat(); run(); });

function toggleStrat(){
  document.getElementById('comboBox').style.display = S.strat==='combo' ? '' : 'none';
  document.getElementById('rateCard').style.opacity = (S.strat==='rate'||S.strat==='combo')?1:.45;
  document.getElementById('dmaCard').style.opacity  = (S.strat==='dma' ||S.strat==='combo')?1:.45;
}

['cap','rLo','rHi','dBuy','dSell','eQLD','eTQQQ','eSOXL','eSPXL','eSPY','spread','start','end']
  .forEach(id=>document.getElementById(id).addEventListener('input', run));

const startEl=document.getElementById('start'), endEl=document.getElementById('end');
const ym = d=>d.slice(0,7);

function underSeries(){ return MK[ASSET[S.asset].under]; }

const DEFAULT_START = '2010-01';
function syncPickerRange(){
  const u = underSeries();
  const lo = ym(u.dates[0]), hi = ym(u.dates[u.dates.length-1]);
  startEl.min=endEl.min=lo; startEl.max=endEl.max=hi;
  const want = DEFAULT_START < lo ? lo : DEFAULT_START;   // 既定は2010-01(原資産開始が後ならそれに合わせる)
  if(!startEl.value) startEl.value = want;
  if(startEl.value < lo) startEl.value = lo;
  if(startEl.value > hi) startEl.value = want;
  if(!endEl.value || endEl.value>hi || endEl.value<lo) endEl.value=hi;
}

/* ---------- helpers ---------- */
const num = id=>parseFloat(document.getElementById(id).value);

/* ---------- per-underlying precompute (cached) ---------- */
let CUR=null;   // {under, dates, px, R, SMA, ffA, N}
function buildUnderlying(){
  const u = underSeries();
  const dates=u.dates, px=u.px, N=px.length;
  const R=new Float64Array(N); for(let i=1;i<N;i++) R[i]=px[i]/px[i-1]-1;
  const SMA=new Float64Array(N);
  { let s=0; const W=200;
    for(let i=0;i<N;i++){ s+=px[i]; if(i>=W) s-=px[i-W]; SMA[i]= i>=W-1? s/W : NaN; } }
  // forward-fill FF onto underlying dates
  const ffD=MK.ff.dates, ffR=MK.ff.rate; let di=0, cur=ffR[0];
  const ffA=new Float64Array(N);
  for(let i=0;i<N;i++){
    while(di<ffD.length && ffD[di]<=dates[i]){ cur=ffR[di]; di++; }
    ffA[i]=cur;
  }
  CUR={under:ASSET[S.asset].under, dates,px,R,SMA,ffA,N};
}

function idxFromMonth(mval, fromStart){
  const D=CUR.dates, N=CUR.N;
  const first = mval+'-01';
  if(fromStart){ for(let i=0;i<N;i++) if(D[i]>=first) return i; return 0; }
  const [y,m]=mval.split('-').map(Number);
  const lastDay=new Date(y,m,0).getDate();
  const last=`${mval}-${String(lastDay).padStart(2,'0')}`;
  for(let i=N-1;i>=0;i--) if(D[i]<=last) return i; return N-1;
}

/* asset / escape daily returns over CUR */
function assetReturns(assetKey){
  const {R,ffA,N}=CUR, cfg=ASSET[assetKey];
  const r=new Float64Array(N), L=cfg.L;
  const exp=cfg.expId? num(cfg.expId)/100 : 0;
  const sp=num('spread')/100;
  if(L===1){ for(let i=1;i<N;i++) r[i]=R[i]-exp/252; return r; }
  for(let i=1;i<N;i++){ const fin=(L-1)*(ffA[i]/100+sp); r[i]=L*R[i]-(fin+exp)/252; }
  return r;
}
function escapeReturns(){
  const {R,ffA,N}=CUR, r=new Float64Array(N);
  if(S.escape==='cash') return r;
  if(S.escape==='mmf'){ for(let i=1;i<N;i++) r[i]=(ffA[i]/100)/252; return r; }
  for(let i=1;i<N;i++) r[i]=R[i];   // 1x index (raw underlying)
  return r;
}

/* signal states warmed from series start */
function buildStates(){
  const {px,SMA,ffA,N}=CUR;
  const rLo=num('rLo'), rHi=num('rHi'), dB=num('dBuy')/100, dS=num('dSell')/100;
  const dma=new Uint8Array(N), rate=new Uint8Array(N);
  let d=1, rt=1;
  for(let i=0;i<N;i++){
    if(!isNaN(SMA[i])){
      if(px[i] >= SMA[i]*(1+dB)) d=1;
      else if(px[i] <= SMA[i]*(1-dS)) d=0;
    }
    dma[i]=d;
    if(ffA[i] <= rLo) rt=1; else if(ffA[i] >= rHi) rt=0;
    rate[i]=rt;
  }
  return {dma,rate};
}
function invested(strat,i,st){
  if(strat==='hold') return true;
  if(strat==='rate') return st.rate[i]===1;
  if(strat==='dma')  return st.dma[i]===1;
  return S.logic==='OR' ? (st.dma[i]===1||st.rate[i]===1)
                        : (st.dma[i]===1&&st.rate[i]===1);
}

function simulate(strat,s,e,aRet,eRet,st,cap){
  const eq=new Float64Array(e-s+1); eq[0]=cap;
  let peak=cap,maxdd=0,trades=0,invD=0,tot=0;
  let prev=invested(strat, s-1>=0?s-1:0, st);
  for(let i=s+1;i<=e;i++){
    const on=invested(strat,i-1,st);
    const ret=on?aRet[i]:eRet[i];
    eq[i-s]=eq[i-s-1]*(1+ret);
    if(eq[i-s]>peak) peak=eq[i-s];
    const dd=(eq[i-s]-peak)/peak; if(dd<maxdd) maxdd=dd;
    if(on!==prev) trades++;
    if(on) invD++;
    prev=on; tot++;
  }
  const yrs=(new Date(CUR.dates[e])-new Date(CUR.dates[s]))/(365.25*864e5);
  const fin=eq[e-s];
  return {strat,eq,final:fin,totalRet:fin/cap-1,
    cagr:Math.pow(fin/cap,1/yrs)-1, maxdd,trades,
    invPct: tot?invD/tot:1};
}

/* ---------- rendering ---------- */
const COL={hold:'#8b97b0',rate:'#4f8cff',dma:'#2dd4a7',combo:'#f5a524'};
const LABEL={hold:'ホールド',rate:'金利',dma:'200DMA',combo:'金利+200DMA'};
let LAST=null;

function run(){
  buildUnderlying();
  if(startEl.min==='') syncPickerRange();
  const cap=num('cap')||10000;
  let s=idxFromMonth(startEl.value,true), e=idxFromMonth(endEl.value,false);
  if(e<=s) e=Math.min(CUR.N-1,s+1);
  const aRet=assetReturns(S.asset), eRet=escapeReturns(), st=buildStates();
  const res={};
  ['hold','rate','dma','combo'].forEach(k=> res[k]=simulate(k,s,e,aRet,eRet,st,cap));
  LAST={res,s,e};
  renderStats(res,cap);
  renderYearly(res,s,e,cap);
  draw(res,s,e);

  const sel=S.strat, lastOn=invested(sel,e,st);
  const escName={cash:'現金',mmf:'MMF',index:'1倍指数'}[S.escape];
  document.getElementById('posnote').innerHTML =
    `選択戦略 <b style="color:${COL[sel]}">${LABEL[sel]}</b> 最終時点の判定：`+
    (lastOn?`<b style="color:var(--up)">保有(${S.asset})</b>`:`<b class="warn">退避(${escName})</b>`);
  document.getElementById('rangeNote').textContent =
    `期間 ${CUR.dates[s]} 〜 ${CUR.dates[e]}　／　対象 ${ASSET[S.asset].label}　／　退避先 ${escName}`;
  document.getElementById('assetHint').textContent =
    `原資産: ${UNDER_NAME[ASSET[S.asset].under]}（${CUR.dates[0]}〜）`;
  document.getElementById('upd').textContent = `データ最終日: ${MK.updated}`;
}

const fmtUSD=v=>'$'+Math.round(v).toLocaleString('en-US');
const pct=v=>(v*100).toFixed(1)+'%';
const pctS=v=>(v>=0?'+':'')+(v*100).toFixed(1)+'%';

function renderStats(res,cap){
  const tb=document.querySelector('#stats tbody'); tb.innerHTML='';
  ['hold','rate','dma','combo'].forEach(k=>{
    const r=res[k], sel=k===S.strat;
    const tr=document.createElement('tr'); if(sel) tr.className='sel';
    tr.innerHTML=`<td><span class="swatch" style="background:${COL[k]}"></span>${LABEL[k]}${sel?' ◀':''}</td>
      <td class="pill">${fmtUSD(r.final)}</td><td class="pill">${pct(r.totalRet)}</td>
      <td class="pill">${pct(r.cagr)}</td><td class="pill warn">${pct(r.maxdd)}</td>
      <td class="pill">${r.trades}</td><td class="pill">${pct(r.invPct)}</td>`;
    tb.appendChild(tr);
  });
}

/* yearly returns from each equity curve */
function yearlyReturns(eq,s,e){
  const D=CUR.dates, out=[];
  let curYear=D[s].slice(0,4), startVal=eq[0];
  for(let i=s+1;i<=e;i++){
    const y=D[i].slice(0,4);
    if(y!==curYear){
      out.push([curYear, eq[i-1-s]/startVal-1]);
      startVal=eq[i-1-s]; curYear=y;
    }
  }
  out.push([curYear, eq[e-s]/startVal-1]);
  return out;
}
function cellColor(v){
  const a=Math.min(Math.abs(v)/0.5,1);
  return v>=0 ? `rgba(45,212,167,${0.12+a*0.4})` : `rgba(255,107,122,${0.12+a*0.4})`;
}
function renderYearly(res,s,e){
  const keys=['hold','rate','dma','combo'];
  const yr={}; keys.forEach(k=>{ yearlyReturns(res[k].eq,s,e).forEach(([y,v])=>{ (yr[y]=yr[y]||{})[k]=v; }); });
  const years=Object.keys(yr).sort();
  const tb=document.querySelector('#yearly tbody'); tb.innerHTML='';
  years.forEach(y=>{
    const tr=document.createElement('tr');
    let cells=`<td><b>${y}</b></td>`;
    keys.forEach(k=>{ const v=yr[y][k];
      cells+=`<td class="pill" style="background:${cellColor(v)}">${pctS(v)}</td>`; });
    tr.innerHTML=cells; tb.appendChild(tr);
  });
}

/* ---------- canvas chart (log) ---------- */
const cv=document.getElementById('chart'), cx=cv.getContext('2d');
function draw(res,s,e){
  const dpr=window.devicePixelRatio||1, W=cv.clientWidth, H=400;
  cv.width=W*dpr; cv.height=H*dpr; cx.setTransform(dpr,0,0,dpr,0,0);
  cx.clearRect(0,0,W,H);
  const PL=58,PR=12,PT=12,PB=24, iw=W-PL-PR, ih=H-PT-PB;
  let lo=Infinity,hi=-Infinity; const keys=['hold','rate','dma','combo'];
  keys.forEach(k=>res[k].eq.forEach(v=>{ if(v<lo)lo=v; if(v>hi)hi=v; }));
  if(lo<=0) lo=1;
  const lLo=Math.log10(lo),lHi=Math.log10(hi),lSpan=(lHi-lLo)||1, n=e-s;
  const X=i=>PL+(i/n)*iw, Y=v=>PT+(1-(Math.log10(Math.max(v,lo))-lLo)/lSpan)*ih;
  cx.font='11px -apple-system,sans-serif';
  for(let p=Math.floor(lLo);p<=Math.ceil(lHi);p++) [1,2,5].forEach(m=>{
    const val=m*Math.pow(10,p); if(val<lo*0.95||val>hi*1.05) return;
    const y=Y(val); cx.strokeStyle='#223'; cx.beginPath();
    cx.moveTo(PL,y); cx.lineTo(W-PR,y); cx.stroke();
    cx.fillStyle='#6b7a99'; cx.textAlign='right';
    cx.fillText('$'+val.toLocaleString('en-US'),PL-6,y+3);
  });
  cx.textAlign='center'; cx.fillStyle='#6b7a99'; let last=null;
  for(let i=0;i<=n;i++){ const yr=CUR.dates[s+i].slice(0,4);
    if(yr!==last && (+yr)%5===0){ const x=X(i); cx.strokeStyle='#1b2233';
      cx.beginPath(); cx.moveTo(x,PT); cx.lineTo(x,H-PB); cx.stroke();
      cx.fillText(yr,x,H-7); last=yr; } else if(yr!==last) last=yr; }
  const order=keys.filter(k=>k!==S.strat).concat([S.strat]);
  order.forEach(k=>{ const eq=res[k].eq, seld=k===S.strat;
    cx.strokeStyle=COL[k]; cx.lineWidth=seld?2.4:1.2; cx.globalAlpha=seld?1:.72;
    cx.beginPath(); for(let i=0;i<=n;i++){ const x=X(i),y=Y(eq[i]); i?cx.lineTo(x,y):cx.moveTo(x,y);} cx.stroke(); });
  cx.globalAlpha=1;
  cv._geo={PL,iw,PT,PB,n,s,e,X,Y,res};
}
/* tooltip */
const tip=document.getElementById('tip');
function hover(clientX,clientY){
  const g=cv._geo; if(!g){tip.style.display='none';return;}
  const rect=cv.getBoundingClientRect();
  let i=Math.round(((clientX-rect.left-g.PL)/g.iw)*g.n);
  if(i<0||i>g.n){tip.style.display='none';return;}
  const di=g.s+i; let html=`<b>${CUR.dates[di]}</b><br>`;
  ['hold','rate','dma','combo'].forEach(k=>{
    html+=`<span style="color:${COL[k]}">●</span> ${LABEL[k]}: ${fmtUSD(g.res[k].eq[i])}<br>`; });
  tip.innerHTML=html; tip.style.display='block';
  tip.style.left=Math.min(clientX+14,window.innerWidth-180)+'px';
  tip.style.top=(clientY+14)+'px';
  draw(g.res,g.s,g.e);
  const x=g.X(i); cx.strokeStyle='#ffffff55'; cx.lineWidth=1;
  cx.beginPath(); cx.moveTo(x,g.PT); cx.lineTo(x,400-g.PB); cx.stroke();
}
cv.addEventListener('mousemove',e=>hover(e.clientX,e.clientY));
cv.addEventListener('touchstart',e=>{const t=e.touches[0];hover(t.clientX,t.clientY);},{passive:true});
cv.addEventListener('touchmove',e=>{const t=e.touches[0];hover(t.clientX,t.clientY);},{passive:true});
cv.addEventListener('mouseleave',()=>{tip.style.display='none'; if(LAST)draw(LAST.res,LAST.s,LAST.e);});
window.addEventListener('resize',()=>{ if(LAST)draw(LAST.res,LAST.s,LAST.e); });

/* ---------- refresh to today ---------- */
const PROXIES=[
  u=>'/api/quote?url='+encodeURIComponent(u),        // Vercel serverless (reliable)
  u=>u,                                              // direct (works if CORS ever allowed)
  u=>'https://corsproxy.io/?url='+encodeURIComponent(u),
  u=>'https://api.allorigins.win/raw?url='+encodeURIComponent(u),
  u=>'https://thingproxy.freeboard.io/fetch/'+u,
];
async function fetchJSON(url){
  for(const wrap of PROXIES){
    try{
      const r=await fetch(wrap(url),{cache:'no-store'});
      if(!r.ok) continue;
      const j=await r.json();
      if(j&&j.chart&&j.chart.result) return j;
    }catch(e){}
  }
  throw new Error('全プロキシ失敗');
}
function mergeYahoo(series, j){
  const d=j.chart.result[0], ts=d.timestamp||[], cl=d.indicators.quote[0].close||[];
  const map={}; series.dates.forEach((dt,i)=>map[dt]=series.px[i]);
  let added=0;
  for(let i=0;i<ts.length;i++){ const c=cl[i]; if(c==null) continue;
    const dt=new Date(ts[i]*1000).toISOString().slice(0,10);
    if(!(dt in map)) added++; map[dt]=Math.round(c*1e4)/1e4; }
  const sd=Object.keys(map).sort();
  series.dates=sd; series.px=sd.map(x=>map[x]);
  return added;
}
const rbtn=document.getElementById('refresh');

/* Discord Webhook 経由で Mac常駐Bot に !update を依頼する(設定時のみ) */
async function requestViaDiscord(){
  const hook=(window.DISCORD_WEBHOOK||'').trim();
  if(!hook) return false;
  const r=await fetch(hook,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({content:'!update'})});
  if(!(r.status===204||r.ok)) throw new Error('webhook '+r.status);
  return true;
}

rbtn.addEventListener('click', async()=>{
  rbtn.disabled=true; const old=rbtn.textContent;
  // Webhook が設定されていれば Discord 経由で Mac に依頼
  if((window.DISCORD_WEBHOOK||'').trim()){
    rbtn.textContent='依頼中…';
    try{
      await requestViaDiscord();
      rbtn.textContent='✓ 依頼しました';
      document.getElementById('upd').textContent=
        'Macで更新中… 1〜2分後にページを再読込してください';
      setTimeout(()=>{rbtn.textContent=old;rbtn.disabled=false;},4000);
    }catch(e){
      rbtn.textContent='⚠ 依頼失敗';
      setTimeout(()=>{rbtn.textContent=old;rbtn.disabled=false;},3000);
    }
    return;
  }
  rbtn.textContent='更新中…';
  try{
    const now=Math.floor(Date.now()/1000);
    const jobs=[
      {sym:'%5EGSPC', s:MK.gspc},
      {sym:'%5ESOX',  s:MK.sox},
      {sym:'%5ENDX',  s:MK.ndx},
    ];
    let total=0;
    for(const job of jobs){
      const last=job.s.dates[job.s.dates.length-1];
      const p1=Math.floor(new Date(last).getTime()/1000);
      const url=`https://query1.finance.yahoo.com/v8/finance/chart/${job.sym}?period1=${p1}&period2=${now}&interval=1d`;
      const j=await fetchJSON(url);
      total+=mergeYahoo(job.s,j);
    }
    MK.updated=[MK.gspc.dates[MK.gspc.dates.length-1],MK.sox.dates[MK.sox.dates.length-1],MK.ndx.dates[MK.ndx.dates.length-1]].sort().pop();
    localStorage.setItem(LS_KEY, JSON.stringify(MK));
    rbtn.textContent=`✓ +${total}日 更新`;
    run();
    setTimeout(()=>{rbtn.textContent=old;rbtn.disabled=false;},2500);
  }catch(e){
    rbtn.textContent='⚠ 取得失敗';
    setTimeout(()=>{rbtn.textContent=old;rbtn.disabled=false;},2500);
  }
});

/* ---------- boot ---------- */
syncPickerRange(); toggleStrat(); run();
