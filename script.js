/* CS2 UNBOX – Full Simulator with Real Prices + Easter Egg */

const API_URL = 'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/crates.json';
const PRICES_URL = 'prices.json';

let allCases=[], currentCase=null, balance=1000, inventory=[], isSpinning=false, audioCtx=null;
let priceDB = null; // Real prices from prices.json
let luckBonus = 0;  // Easter egg luck modifier

const $=id=>document.getElementById(id);
const balanceDisplay=$('balance-display'), loadingCases=$('loading-cases');
const casesGrid=$('cases-grid'), casesView=$('cases-view');
const caseDetailView=$('case-detail-view'), unboxingView=$('unboxing-view');
const inventoryView=$('inventory-view');
const navCases=$('nav-cases'), navInventory=$('nav-inventory'), invBadge=$('inv-badge'), logoHome=$('logo-home');
const detailCaseImage=$('detail-case-image'), detailCaseName=$('detail-case-name');
const detailItemCount=$('detail-item-count'), detailCasePrice=$('detail-case-price');
const oddsBars=$('odds-bars'), possibleItemsGrid=$('possible-items-grid');
const rareItemsGrid=$('rare-items-grid'), rareSection=$('rare-section'), openCaseBtn=$('open-case-btn');
const backToCasesBtn=$('back-to-cases');
const rouletteContainer=$('roulette-container'), rouletteCaseName=$('roulette-case-name');
const rouletteTrack=$('roulette-track'), winOverlay=$('win-overlay');
const winGlow=$('win-glow'), winRarity=$('win-rarity'), winName=$('win-name');
const winWear=$('win-wear'), winImage=$('win-image'), winPrice=$('win-price');
const collectBtn=$('collect-btn'), sellWinBtn=$('sell-win-btn');
const spinAgainBtn=$('spin-again-btn'), backFromUnbox=$('back-from-unbox');
const inventoryGrid=$('inventory-grid'), inventoryCount=$('inventory-count');
const inventoryValue=$('inventory-value'), inventoryEmpty=$('inventory-empty'), sellAllBtn=$('sell-all-btn');
const cheatConsole=$('cheat-console'), cheatInput=$('cheat-input'), cheatLog=$('cheat-log'), cheatClose=$('cheat-close');
const bulkOverlay=$('bulk-overlay'), bulkSummary=$('bulk-summary'), bulkResultsGrid=$('bulk-results-grid');
const bulkSellAll=$('bulk-sell-all'), bulkKeepAll=$('bulk-keep-all');

// ── Constants ──
const WEAR_CONDITIONS = [
    { name:'Factory New', abbr:'FN', prob:0.03, mult:2.5 },
    { name:'Minimal Wear', abbr:'MW', prob:0.24, mult:1.5 },
    { name:'Field-Tested', abbr:'FT', prob:0.33, mult:1.0 },
    { name:'Well-Worn', abbr:'WW', prob:0.24, mult:0.65 },
    { name:'Battle-Scarred', abbr:'BS', prob:0.16, mult:0.4 },
];

const RARITY_ODDS = [
    { tier:'Mil-Spec Grade', prob:79.92, color:'#4b69ff' },
    { tier:'Restricted', prob:15.98, color:'#8847ff' },
    { tier:'Classified', prob:3.20, color:'#d32ce6' },
    { tier:'Covert', prob:0.64, color:'#eb4b4b' },
    { tier:'Rare Special', prob:0.26, color:'#ffd700' },
];

const FALLBACK_PRICES = {
    'Mil-Spec Grade':{min:0.05,max:1.5}, 'Restricted':{min:0.8,max:8},
    'Classified':{min:4,max:45}, 'Covert':{min:15,max:180}, 'Rare Special':{min:80,max:2500}
};

// ── Helpers ──
function getRarityTier(n){ if(!n) return 'Mil-Spec Grade'; n=n.toLowerCase();
    if(n.includes('covert')) return 'Covert'; if(n.includes('classified')) return 'Classified';
    if(n.includes('restricted')) return 'Restricted';
    if(n.includes('extraordinary')||n.includes('contraband')) return 'Rare Special';
    return 'Mil-Spec Grade';
}
function getRarityColor(item){ return item?.rarity?.color||'#4b69ff'; }
function hashCode(s){ let h=0; for(let i=0;i<s.length;i++) h=((h<<5)-h+s.charCodeAt(i))|0; return Math.abs(h); }

function getItemPrice(item, wear, isRare=false) {
    const name = item.name||'';
    const mhnFT = `${name} (Field-Tested)`;
    const mhnFN = `${name} (Factory New)`;
    
    if (priceDB) {
        if (priceDB[mhnFT] != null) {
            // Scale FT price by wear multiplier relative to FT(1.0)
            return +(priceDB[mhnFT] * wear.mult).toFixed(2);
        } else if (priceDB[mhnFN] != null) {
            // Scale FN price relative to FT base (FN mult is 2.5)
            const ftBase = priceDB[mhnFN] / 2.5;
            return +(ftBase * wear.mult).toFixed(2);
        }
    }
    
    // Fallback: estimate from rarity
    const tier = isRare ? 'Rare Special' : getRarityTier(item?.rarity?.name);
    const range = FALLBACK_PRICES[tier]||FALLBACK_PRICES['Mil-Spec Grade'];
    const seed = hashCode(name) / 2147483647;
    const base = range.min + seed * (range.max - range.min);
    return +(base * wear.mult).toFixed(2);
}

function getCaseCost(c) {
    const mhn = c.market_hash_name;
    if (priceDB && mhn && priceDB[mhn] != null) return +(2.49 + priceDB[mhn]).toFixed(2);
    // Fallback by age
    const y = parseInt((c.first_sale_date||'2024/01/01').split('/')[0]);
    if(y<=2014) return 3.99; if(y<=2016) return 2.99; if(y<=2018) return 2.64;
    if(y<=2020) return 2.54; return 2.52;
}

function rollWear(){ const r=Math.random(); let c=0;
    for(const w of WEAR_CONDITIONS){ c+=w.prob; if(r<=c) return w; } return WEAR_CONDITIONS[2];
}

function groupItems(cd){ const g={}; RARITY_ODDS.forEach(r=>g[r.tier]=[]);
    (cd.contains||[]).forEach(i=>{ const t=getRarityTier(i?.rarity?.name); (g[t]||g['Mil-Spec Grade']).push(i); });
    g['Rare Special']=cd.contains_rare||[]; return g;
}

function getLuckyOdds() {
    // With luck, steal probability from blues/purples and give to reds/golds
    if (luckBonus <= 0) return RARITY_ODDS;
    const factor = luckBonus / 100; // 0-0.99
    // Boost covert and rare special massively, classified somewhat
    const boosted = RARITY_ODDS.map(r => ({...r}));
    const steal = boosted[0].prob * factor * 0.9; // Take from Mil-Spec
    boosted[0].prob -= steal;
    boosted[2].prob += steal * 0.15;  // Classified gets 15%
    boosted[3].prob += steal * 0.35;  // Covert gets 35%
    boosted[4].prob += steal * 0.50;  // Rare Special gets 50%
    return boosted;
}

function rollItem(cd) {
    const grouped=groupItems(cd); const odds=getLuckyOdds();
    let roll=Math.random()*100; let cum=0;
    for(const {tier,prob} of odds){ cum+=prob;
        if(roll<=cum){ const pool=grouped[tier];
            if(pool&&pool.length>0){ const item=pool[Math.floor(Math.random()*pool.length)];
                return {item,tier,isRare:tier==='Rare Special'}; } } }
    const all=cd.contains; return {item:all[Math.floor(Math.random()*all.length)],tier:'Mil-Spec Grade',isRare:false};
}

// ── Audio ──
function ensureAudio(){ if(!audioCtx) audioCtx=new(window.AudioContext||window.webkitAudioContext)();
    if(audioCtx.state==='suspended') audioCtx.resume(); }

function playTick(){ ensureAudio(); const o=audioCtx.createOscillator(),g=audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination); o.type='sine'; o.frequency.setValueAtTime(880,audioCtx.currentTime);
    g.gain.setValueAtTime(0.12,audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(0.001,audioCtx.currentTime+0.05);
    o.start(audioCtx.currentTime); o.stop(audioCtx.currentTime+0.05); }

function playWinSound(rare){ ensureAudio();
    const notes=rare?[523.25,659.25,783.99,1046.5,1318.51]:[523.25,659.25,783.99];
    notes.forEach((f,i)=>{ const o=audioCtx.createOscillator(),g=audioCtx.createGain();
        o.connect(g); g.connect(audioCtx.destination); o.type=rare?'triangle':'sine';
        o.frequency.setValueAtTime(f,audioCtx.currentTime+i*0.12);
        g.gain.setValueAtTime(0,audioCtx.currentTime+i*0.12);
        g.gain.linearRampToValueAtTime(0.25,audioCtx.currentTime+i*0.12+0.02);
        g.gain.exponentialRampToValueAtTime(0.001,audioCtx.currentTime+i*0.12+0.5);
        o.start(audioCtx.currentTime+i*0.12); o.stop(audioCtx.currentTime+i*0.12+0.5); }); }

// ── Navigation ──
const views=[casesView,caseDetailView,unboxingView,inventoryView];
function showView(v){ views.forEach(x=>x.classList.add('hidden')); v.classList.remove('hidden');
    navCases.classList.toggle('active',v!==inventoryView);
    navInventory.classList.toggle('active',v===inventoryView); }
navCases.onclick=()=>{ if(!isSpinning) showView(casesView); };
navInventory.onclick=()=>{ if(!isSpinning){ showView(inventoryView); renderInventory(); } };
logoHome.onclick=()=>{ if(!isSpinning) showView(casesView); };

// ── Init ──
async function init(){
    updateBalance();
    // Try loading real prices
    try{ 
        const r=await fetch(PRICES_URL + '?t=' + Date.now()); 
        if(r.ok){ 
            priceDB=await r.json();
            console.log(`Loaded ${Object.keys(priceDB).length} real prices`); 
        } else {
            console.error(`prices.json HTTP Error: ${r.status}`);
        }
    }catch(e){ 
        console.error('No prices.json found, using estimates:', e);
        // Add visual indicator to page so user knows prices are estimated
        const title = document.querySelector('h1');
        if(title) title.innerHTML += ' <span style="color:red;font-size:0.5em">(Estimates Mode - DB Offline)</span>';
    }

    try{ const resp=await fetch(API_URL); if(!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data=await resp.json();
        allCases=data.filter(c=>c.type==='Case'&&c.contains&&c.contains.length>0);
        allCases.sort((a,b)=>(b.first_sale_date||'').localeCompare(a.first_sale_date||''));
        renderCaseCards();
    }catch(err){ console.error(err);
        loadingCases.innerHTML=`<span style="color:#f87171">Failed to load cases. ${err.message}</span>`; }
}

function updateBalance(){ balanceDisplay.innerText=`$${balance.toFixed(2)}`; }

function renderCaseCards(){ loadingCases.classList.add('hidden'); casesGrid.innerHTML='';
    allCases.forEach(c=>{ const cost=getCaseCost(c); const card=document.createElement('div');
        card.className='case-card';
        card.innerHTML=`<img class="case-image" src="${c.image}" alt="${c.name}" loading="lazy">
            <div class="case-name">${c.name}</div>
            <div class="case-price-tag">$${cost.toFixed(2)}</div>`;
        card.onclick=()=>openCaseDetail(c); casesGrid.appendChild(card); }); }

// ── Case Detail ──
function openCaseDetail(cd){ currentCase=cd; const cost=getCaseCost(cd);
    detailCaseImage.src=cd.image; detailCaseImage.alt=cd.name; detailCaseName.innerText=cd.name;
    const total=cd.contains.length+(cd.contains_rare||[]).length;
    detailItemCount.innerText=`${total} items`;
    detailCasePrice.innerText=`Cost: $${cost.toFixed(2)}`;
    openCaseBtn.innerHTML=`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg><span>Open Case – $${cost.toFixed(2)}</span>`;
    renderOdds(cd); renderPossibleItems(cd); renderRareItems(cd); showView(caseDetailView); }

function renderOdds(cd){ oddsBars.innerHTML=''; const grouped=groupItems(cd); const hasRare=(cd.contains_rare||[]).length>0;
    RARITY_ODDS.forEach(({tier,prob,color})=>{
        if(tier==='Rare Special'&&!hasRare) return;
        if(tier!=='Rare Special'&&(!grouped[tier]||grouped[tier].length===0)) return;
        const bw=Math.max(prob*1.0,2); const row=document.createElement('div'); row.className='odds-row';
        row.innerHTML=`<div class="odds-label"><span class="odds-dot" style="background:${color}"></span>${tier}</div>
            <div class="odds-bar-wrap"><div class="odds-bar-fill" style="width:${bw}%;background:${color}"></div></div>
            <div class="odds-pct">${prob}%</div>`;
        oddsBars.appendChild(row); }); }

function renderPossibleItems(cd){ possibleItemsGrid.innerHTML='';
    cd.contains.forEach(item=>{ const color=getRarityColor(item);
        const ftWear=WEAR_CONDITIONS[2]; const bsWear=WEAR_CONDITIONS[4]; const fnWear=WEAR_CONDITIONS[0];
        const pLow=getItemPrice(item,bsWear); const pHigh=getItemPrice(item,fnWear);
        const hasPriceDB=priceDB&&priceDB[`${item.name} (Field-Tested)`]!=null;
        const card=document.createElement('div'); card.className='pitem-card';
        card.style.setProperty('--item-color',color);
        card.innerHTML=`<img src="${item.image}" alt="${item.name}" loading="lazy">
            <div class="pitem-name" title="${item.name}">${item.name}</div>
            <div class="pitem-rarity" style="color:${color}">${item.rarity?.name||'Unknown'}</div>
            <div class="pitem-price ${hasPriceDB?'':'price-estimated'}">$${pLow.toFixed(2)} – $${pHigh.toFixed(2)}</div>`;
        possibleItemsGrid.appendChild(card); }); }

function renderRareItems(cd){ const rares=cd.contains_rare||[];
    if(!rares.length){ rareSection.classList.add('hidden'); return; }
    rareSection.classList.remove('hidden'); rareItemsGrid.innerHTML='';
    rares.forEach(item=>{ const color=item.rarity?.color||'#ffd700';
        const pLow=getItemPrice(item,WEAR_CONDITIONS[4],true); const pHigh=getItemPrice(item,WEAR_CONDITIONS[0],true);
        const hasPriceDB=priceDB&&priceDB[`${item.name} (Field-Tested)`]!=null;
        const card=document.createElement('div'); card.className='pitem-card';
        card.style.setProperty('--item-color',color);
        card.innerHTML=`<img src="${item.image}" alt="${item.name}" loading="lazy">
            <div class="pitem-name" title="${item.name}">${item.name}</div>
            <div class="pitem-rarity" style="color:${color}">★ ${item.rarity?.name||'Rare Special'}</div>
            <div class="pitem-price ${hasPriceDB?'':'price-estimated'}">$${pLow.toFixed(2)} – $${pHigh.toFixed(2)}</div>`;
        rareItemsGrid.appendChild(card); }); }

backToCasesBtn.onclick=()=>{ if(!isSpinning) showView(casesView); };

// ── Bulk Open ──
document.querySelectorAll('.btn-bulk').forEach(btn=>{
    btn.onclick=()=>{ if(isSpinning) return; const qty=parseInt(btn.dataset.qty); bulkOpen(qty); };
});

let pendingBulkItems=[];
function bulkOpen(qty){
    const cost=getCaseCost(currentCase); const totalCost=cost*qty;
    if(balance<totalCost){ alert(`Need $${totalCost.toFixed(2)} to open ${qty} cases!`); return; }
    balance-=totalCost; updateBalance();
    pendingBulkItems=[];
    for(let i=0;i<qty;i++){
        const {item,tier,isRare}=rollItem(currentCase);
        const wear=rollWear(); const price=getItemPrice(item,wear,isRare);
        pendingBulkItems.push({...item,wear,price,tier,isRare,id:Date.now()+Math.random()+i});
    }
    // Sort: rarest first
    const tierOrder={'Rare Special':0,'Covert':1,'Classified':2,'Restricted':3,'Mil-Spec Grade':4};
    pendingBulkItems.sort((a,b)=>(tierOrder[a.tier]??5)-(tierOrder[b.tier]??5));
    const totalValue=pendingBulkItems.reduce((s,i)=>s+i.price,0);
    const profit=totalValue-totalCost;
    bulkSummary.innerHTML=`
        <div class="bulk-stat"><span class="bulk-stat-label">Opened</span><span class="bulk-stat-value">${qty}</span></div>
        <div class="bulk-stat"><span class="bulk-stat-label">Total Cost</span><span class="bulk-stat-value red">-$${totalCost.toFixed(2)}</span></div>
        <div class="bulk-stat"><span class="bulk-stat-label">Total Value</span><span class="bulk-stat-value green">$${totalValue.toFixed(2)}</span></div>
        <div class="bulk-stat"><span class="bulk-stat-label">Profit</span><span class="bulk-stat-value ${profit>=0?'green':'red'}">${profit>=0?'+':''}$${profit.toFixed(2)}</span></div>`;
    bulkResultsGrid.innerHTML='';
    pendingBulkItems.forEach(item=>{
        const color=item.isRare?'#ffd700':getRarityColor(item);
        const el=document.createElement('div'); el.className='bulk-item'; el.style.setProperty('--item-color',color);
        el.innerHTML=`<img src="${item.image}" alt="${item.name}" loading="lazy">
            <div class="bulk-item-name" title="${item.name}">${item.name}</div>
            <div class="bulk-item-wear">${item.wear.name}</div>
            <div class="bulk-item-price">$${item.price.toFixed(2)}</div>`;
        bulkResultsGrid.appendChild(el);
    });
    showView(unboxingView); bulkOverlay.classList.remove('hidden');
}

bulkKeepAll.onclick=()=>{
    pendingBulkItems.forEach(i=>inventory.unshift(i)); updateInvBadge();
    bulkOverlay.classList.add('hidden'); showView(caseDetailView); openCaseDetail(currentCase);
};
bulkSellAll.onclick=()=>{
    const total=pendingBulkItems.reduce((s,i)=>s+i.price,0);
    balance+=total; updateBalance(); pendingBulkItems=[];
    bulkOverlay.classList.add('hidden'); showView(caseDetailView); openCaseDetail(currentCase);
};

// ── Unboxing ──
openCaseBtn.onclick=()=>startUnbox();

function startUnbox(){ if(isSpinning) return;
    const cost=getCaseCost(currentCase);
    if(balance<cost){ alert(`Insufficient balance! Need $${cost.toFixed(2)}`); return; }
    balance-=cost; updateBalance(); isSpinning=true; ensureAudio();
    rouletteCaseName.innerText=currentCase.name;
    winOverlay.classList.add('hidden'); spinAgainBtn.classList.add('hidden'); backFromUnbox.classList.add('hidden');
    showView(unboxingView);
    const {item:winItem,tier:winTier,isRare}=rollItem(currentCase);
    const winnerWear=rollWear();
    const COUNT=80, WIN_IDX=65, IW=200;
    rouletteTrack.innerHTML=''; rouletteTrack.style.transition='none'; rouletteTrack.style.transform='translateX(0)';
    for(let i=0;i<COUNT;i++){ let item,wear,rare=false;
        if(i===WIN_IDX){ item=winItem; wear=winnerWear; rare=isRare; }
        else{ const r=rollItem(currentCase); item=r.item; wear=rollWear(); rare=r.isRare; }
        const el=document.createElement('div'); el.className='roulette-item';
        const c=rare?'#ffd700':getRarityColor(item); el.style.setProperty('--item-color',c);
        el.innerHTML=`<img src="${item.image}" alt="${item.name}"><div class="r-name">${item.name}</div><div class="r-wear">${wear.abbr}</div>`;
        rouletteTrack.appendChild(el); }
    void rouletteTrack.offsetWidth;
    const ww=rouletteContainer.offsetWidth;
    const off=Math.random()*(IW-40)+20; const dist=WIN_IDX*IW+off-ww/2;
    const dur=6500;
    let tickInt=setInterval(()=>{ const elapsed=performance.now()-startT;
        if(elapsed>=dur-200){ clearInterval(tickInt); return; }
        const p=elapsed/dur; if(p<0.3||Math.random()>p*1.2) playTick(); },70);
    const startT=performance.now();
    rouletteTrack.style.transition=`transform ${dur}ms cubic-bezier(0.12,0.88,0.08,1)`;
    rouletteTrack.style.transform=`translateX(-${dist}px)`;
    setTimeout(()=>{ clearInterval(tickInt);
        playWinSound(isRare||winTier==='Covert'||winTier==='Classified');
        showWinOverlay(winItem,winnerWear,winTier,isRare); },dur+300); }

// ── Win Overlay ──
let pendingWin=null;
function showWinOverlay(item,wear,tier,isRare){
    const color=isRare?'#ffd700':getRarityColor(item);
    const price=getItemPrice(item,wear,isRare);
    pendingWin={...item,wear,price,tier,isRare};
    winGlow.style.background=color;
    winRarity.innerText=isRare?'★ Rare Special ★':(item.rarity?.name||tier);
    winRarity.style.color=color; winName.innerText=item.name;
    winWear.innerText=`${wear.name} (${wear.abbr})`;
    winImage.src=item.image; winPrice.innerText=`$${price.toFixed(2)}`;
    winOverlay.classList.remove('hidden'); }

collectBtn.onclick=()=>{ if(!pendingWin) return;
    inventory.unshift({...pendingWin,id:Date.now()+Math.random()}); updateInvBadge(); closeWin(); };
sellWinBtn.onclick=()=>{ if(!pendingWin) return; balance+=pendingWin.price; updateBalance(); closeWin(); };

function closeWin(){ winOverlay.classList.add('hidden'); pendingWin=null; isSpinning=false;
    spinAgainBtn.classList.remove('hidden'); backFromUnbox.classList.remove('hidden');
    const cost=getCaseCost(currentCase);
    spinAgainBtn.innerText=`Open Again – $${cost.toFixed(2)}`; spinAgainBtn.disabled=balance<cost; }

spinAgainBtn.onclick=()=>startUnbox();
backFromUnbox.onclick=()=>{ showView(caseDetailView); openCaseDetail(currentCase); };
function updateInvBadge(){ invBadge.innerText=inventory.length; }

// ── Inventory ──
function renderInventory(){ inventoryCount.innerText=inventory.length;
    const tv=inventory.reduce((s,i)=>s+i.price,0); inventoryValue.innerText=`$${tv.toFixed(2)}`;
    inventoryEmpty.classList.toggle('hidden',inventory.length>0); sellAllBtn.disabled=inventory.length===0;
    inventoryGrid.innerHTML='';
    inventory.forEach((item,idx)=>{ const color=item.isRare?'#ffd700':getRarityColor(item);
        const el=document.createElement('div'); el.className='inv-item'; el.style.setProperty('--item-color',color);
        el.innerHTML=`<img src="${item.image}" alt="${item.name}" loading="lazy">
            <div class="inv-item-name" title="${item.name}">${item.name}</div>
            <div class="inv-item-wear">${item.wear.name}</div>
            <div class="inv-item-price">$${item.price.toFixed(2)}</div>
            <button class="inv-item-sell" data-idx="${idx}">Sell</button>`;
        el.querySelector('.inv-item-sell').onclick=e=>{ e.stopPropagation(); sellItem(idx); };
        inventoryGrid.appendChild(el); }); }

function sellItem(idx){ const item=inventory[idx]; if(!item) return;
    balance+=item.price; updateBalance(); inventory.splice(idx,1); updateInvBadge(); renderInventory(); }

sellAllBtn.onclick=()=>{ if(!inventory.length) return;
    balance+=inventory.reduce((s,i)=>s+i.price,0); updateBalance(); inventory=[]; updateInvBadge(); renderInventory(); };

// ═══════════════════════════════════════════════════════════════
//  EASTER EGG – Developer Console (press backtick ` to toggle)
// ═══════════════════════════════════════════════════════════════
let consoleOpen=false;

function toggleConsole(){ consoleOpen=!consoleOpen;
    cheatConsole.classList.toggle('hidden',!consoleOpen);
    if(consoleOpen){ cheatInput.focus();
        if(!cheatLog.children.length) cLog('info','Type "help" for available commands.'); } }

document.addEventListener('keydown',e=>{
    if(e.key==='`'||e.key==='~'){ e.preventDefault(); toggleConsole(); return; }
    if(e.key==='Escape'&&consoleOpen){ toggleConsole(); } });

cheatClose.onclick=()=>toggleConsole();

cheatInput.addEventListener('keydown',e=>{
    if(e.key==='Enter'){ const cmd=cheatInput.value.trim(); cheatInput.value='';
        if(cmd) processCommand(cmd); e.preventDefault(); e.stopPropagation(); }
    e.stopPropagation(); // Prevent backtick from closing while typing
});

function cLog(type,msg){ const line=document.createElement('div');
    line.className=`log-line ${type}`; line.textContent=msg;
    cheatLog.appendChild(line); cheatLog.scrollTop=cheatLog.scrollHeight; }

function processCommand(raw){
    cLog('','> '+raw);
    const parts=raw.split(/\s+/);
    const cmd=parts[0].toLowerCase();
    const arg=parts[1];

    if(cmd==='-luck'||cmd==='luck'){
        const val=parseFloat(arg);
        if(isNaN(val)){ cLog('error','Usage: -luck <amount>  (e.g. -luck 50)');
            cLog('info',`Current luck bonus: ${luckBonus}%`); return; }
        luckBonus=Math.max(0,Math.min(val,99));
        if(luckBonus>=80) cLog('warn','⚠ INSANE LUCK MODE – knives incoming!');
        else if(luckBonus>=50) cLog('success','🔥 You are VERY lucky now! Reds and knives boosted heavily.');
        else if(luckBonus>0) cLog('success',`Luck set to ${luckBonus}%. Covert and knife odds boosted.`);
        else cLog('info','Luck reset to normal odds.');
    }
    else if(cmd==='-balance'||cmd==='balance'){
        const val=parseFloat(arg);
        if(isNaN(val)||val<0){ cLog('error','Usage: -balance <amount>  (e.g. -balance 10000)'); return; }
        balance=val; updateBalance(); cLog('success',`Balance set to $${balance.toFixed(2)}`);
    }
    else if(cmd==='-reset'){
        luckBonus=0; balance=1000; inventory=[]; updateBalance(); updateInvBadge();
        cLog('success','All stats reset to default.');
    }
    else if(cmd==='help'){
        cLog('info','Available commands:');
        cLog('info','  -luck <0-99>   Boost knife & covert drop rates');
        cLog('info','  -balance <amt> Set your balance');
        cLog('info','  -reset         Reset everything to defaults');
        cLog('info','  clear          Clear console log');
    }
    else if(cmd==='clear'){ cheatLog.innerHTML=''; }
    else { cLog('error',`Unknown command: ${cmd}. Type "help" for commands.`); }
}

// ── Boot ──
init();
