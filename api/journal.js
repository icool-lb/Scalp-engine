const clean = x => typeof x === 'string' ? x.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,1800) : x;
function env(){ return {url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY}; }
function available(){ const e=env(); return !!(e.url&&e.key); }
async function readBody(req){
  if(req.body&&typeof req.body==='object') return req.body;
  if(typeof req.body==='string') return JSON.parse(req.body||'{}');
  return new Promise((resolve,reject)=>{let d='';req.on('data',c=>d+=c);req.on('end',()=>{try{resolve(JSON.parse(d||'{}'))}catch(e){reject(e)}})});
}
async function sb(path,{method='GET',body,prefer='return=representation'}={}){
  const e=env();
  if(!available()) throw Object.assign(new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'),{disabled:true});
  const r=await fetch(`${e.url.replace(/\/$/,'')}/rest/v1/${path}`,{
    method,
    headers:{apikey:e.key,Authorization:`Bearer ${e.key}`,'Content-Type':'application/json',Prefer:prefer},
    body:body?JSON.stringify(body):undefined
  });
  const txt=await r.text();
  let j; try{j=txt?JSON.parse(txt):null}catch(_){j=txt}
  if(!r.ok) throw new Error(typeof j==='string'?j:(j?.message||j?.hint||`Supabase ${r.status}`));
  return j;
}
const num = v => Number.isFinite(Number(v)) ? Number(v) : null;
const now = () => new Date().toISOString();
function resultFromStatus(status){ return status==='SL HIT'?'LOSS':(String(status||'').includes('TP')?'WIN':'OPEN'); }
function releaseRank(x){ x=String(x||'TP2').toUpperCase(); return x.includes('TP3')?3:x.includes('TP2')?2:x.includes('TP1')?1:2; }
function statusRank(x){ x=String(x||'').toUpperCase(); return x.includes('TP3')?3:x.includes('TP2')?2:x.includes('TP1')?1:0; }
function shouldClose(status,release){ if(status==='SL HIT') return true; return statusRank(status)>=releaseRank(release); }
function analyzeReview(rec,status,resultAnalysis){
  if(resultAnalysis) return resultAnalysis;
  const res=resultFromStatus(status);
  const snap=rec.snapshot||rec.snapshot_json||{};
  const tags=[];
  const text=[rec.reason, rec.failure, snap?.candle?.reason, snap?.targetGuard?.message, snap?.opportunity?.reason, snap?.liquidity?.reason].filter(Boolean).join(' ');
  if(/SWEEP|LIQUIDITY|سيولة|أخذ/.test(text)) tags.push('liquidity_sweep');
  if(/NO CHASE|chase|ملاحقة/.test(text)) tags.push('late_entry');
  if(/Target Guard|nearest|قريب|عائق/.test(text)) tags.push('target_guard');
  let cause='Still active', fix='';
  if(res==='LOSS'){
    cause = tags.includes('liquidity_sweep') ? 'Sweep/liquidity entry without enough retest'
      : tags.includes('target_guard') ? 'Entry too close to obstacle / target guard'
      : tags.includes('late_entry') ? 'Late entry / no-chase ignored'
      : 'SL hit after invalidation';
    fix = tags.includes('liquidity_sweep') ? 'Convert sweep to WATCH until retest/confirmation candle.'
      : tags.includes('target_guard') ? 'Hard-block entries with roomR too low; move TP1 before obstacle.'
      : tags.includes('late_entry') ? 'Reduce chase distance and require entry near trigger candle.'
      : 'Raise min quality or reduce hold time for this session.';
  } else if(res==='WIN'){
    cause = 'Planned target reached';
    fix = 'Keep rule; compare same setup by session and timeframe.';
  }
  return {result:res,resultCause:cause,suggestedFix:fix,ruleToAdjust:tags[0]||'',confidence:0.72,tags};
}
async function health(req,res){
  if(!available()) return res.status(200).json({ok:false,disabled:true,message:'Supabase env missing'});
  const r = await sb('trades?select=id&limit=1').catch(e=>{throw new Error('Supabase connected but schema/env issue: '+e.message)});
  return res.status(200).json({ok:true,message:'Supabase connected + schema reachable',sample:Array.isArray(r)?r.length:0});
}
async function create(req,res){
  const b=await readBody(req),t=b.trade||{},rec=b.record||{};
  const snap=t.analysisSnapshot||rec.snapshot||{};
  const row={
    client_trade_id:String(t.createdAt||rec.id||Date.now()),
    strategy_version:b.version||'V12.4.1_DNA_FIX12',
    symbol:t.symbol||rec.symbol,
    source:(snap.source&&snap.source.source)||t.source||'',
    timeframe:t.tf||rec.tf,
    mode:t.mode||rec.mode,
    direction:t.dir||rec.dir,
    quality:num(t.q||rec.q),
    grade:t.grade||rec.grade,
    entry:num(t.entry), sl:num(t.sl), tp1:num(t.tp1), tp2:num(t.tp2), tp3:num(t.tp3),
    release_at:t.releaseAt||rec.releaseAt||'TP2',
    status:'ACTIVE', result:'OPEN',
    opened_at:new Date(t.createdAt||Date.now()).toISOString(),
    reason:clean(t.reason||rec.reason),
    snapshot_json:snap||{},
    report_text:t.reportText||rec.reportText||''
  };
  const inserted=await sb('trades?on_conflict=client_trade_id',{method:'POST',body:row,prefer:'resolution=merge-duplicates,return=representation'});
  const trade=Array.isArray(inserted)?inserted[0]:inserted;
  if(trade?.id) await sb('trade_events',{method:'POST',body:{trade_id:trade.id,event_type:'LOCKED',price:row.entry,note:row.reason}}).catch(()=>null);
  res.status(200).json({ok:true,trade_id:trade?.id,trade});
}
async function update(req,res){
  const b=await readBody(req),id=String(b.client_trade_id||b.record?.id||b.trade?.createdAt||'');
  if(!id) return res.status(400).json({ok:false,error:'missing client_trade_id'});
  const rows=await sb(`trades?client_trade_id=eq.${encodeURIComponent(id)}&select=*`);
  const tr=rows?.[0]; if(!tr) return res.status(404).json({ok:false,error:'trade not found'});
  const rec=b.record||{}, status=b.status||rec.status||'ACTIVE', price=num(b.price??rec.lastPrice??rec.exit);
  const closed=shouldClose(status,tr.release_at||rec.releaseAt||'TP2');
  const upd={
    status, updated_at:now(), exit_price:closed?price:null,
    mfe:num(rec.mfe)||tr.mfe||0, mae:num(rec.mae)||tr.mae||0,
    max_favorable_r:num(rec.maxFavorableR)||tr.max_favorable_r||0,
    max_adverse_r:num(rec.maxAdverseR)||tr.max_adverse_r||0
  };
  let rv=null;
  if(closed){
    rv=analyzeReview(rec,status,b.resultAnalysis);
    upd.result=rv.result||resultFromStatus(status);
    upd.closed_at=rv.closedAt||now();
    upd.result_cause=clean(rv.resultCause);
    upd.suggested_fix=clean(rv.suggestedFix);
  }
  await sb(`trades?client_trade_id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:upd});
  if(price!=null) await sb('trade_price_path',{method:'POST',body:{trade_id:tr.id,price,mfe:upd.mfe,mae:upd.mae,r_value:upd.max_favorable_r,status}}).catch(()=>null);
  await sb('trade_events',{method:'POST',body:{trade_id:tr.id,event_type:status,price,note:closed?upd.result_cause:'update'}}).catch(()=>null);
  if(closed&&rv){
    await sb('trade_reviews?on_conflict=trade_id',{
      method:'POST',prefer:'resolution=merge-duplicates,return=representation',
      body:{trade_id:tr.id,result:upd.result,result_cause:clean(rv.resultCause),failure_reason:upd.result==='LOSS'?clean(rv.resultCause):'',success_reason:upd.result==='WIN'?clean(rv.resultCause):'',suggested_fix:clean(rv.suggestedFix),rule_to_adjust:clean(rv.ruleToAdjust||''),confidence:rv.confidence||0.72,metrics_json:rv||{}}
    }).catch(()=>null);
    await addSuggestion('trade_review',tr.symbol,tr.timeframe,tr.mode,rv.resultCause,rv.suggestedFix,rv.ruleToAdjust,rv.confidence,rv).catch(()=>null);
  }
  res.status(200).json({ok:true,trade_id:tr.id,status,result:upd.result||'OPEN',closed});
}
async function addSuggestion(source,symbol,timeframe,mode,issue,change,rule,confidence,evidence){
  if(!issue||!change) return null;
  return sb('strategy_rule_suggestions',{method:'POST',body:{source,symbol,timeframe,mode,issue:clean(issue),suggested_change:clean(change),affected_rule:clean(rule||''),confidence:confidence||0.65,evidence_json:evidence||{},status:'OPEN'},prefer:'return=minimal'});
}
async function open(req,res){
  const open=await sb('trades?status=eq.ACTIVE&select=*&order=opened_at.desc&limit=50');
  res.status(200).json({ok:true,open});
}
async function review(req,res){
  const trades=await sb('trades?select=*&order=created_at.desc&limit=250');
  const closed=trades.filter(x=>x.result==='WIN'||x.result==='LOSS'),wins=closed.filter(x=>x.result==='WIN').length,losses=closed.filter(x=>x.result==='LOSS').length,open=trades.filter(x=>x.result==='OPEN'||x.status==='ACTIVE').length,wr=closed.length?wins/closed.length*100:0;
  const causes={}; closed.filter(x=>x.result==='LOSS').forEach(x=>{const k=x.result_cause||'Unknown';causes[k]=(causes[k]||0)+1});
  const top=Object.entries(causes).sort((a,b)=>b[1]-a[1]).slice(0,7);
  const html=`<div class=sourceNote>☁️ Supabase Server Journal</div><div class=journalGrid><div class=jstat><b>${trades.length}</b><span>Total</span></div><div class=jstat><b>${open}</b><span>Open</span></div><div class=jstat><b>${wins}/${losses}</b><span>Win/Loss</span></div><div class=jstat><b>${wr.toFixed(1)}%</b><span>WR Closed</span></div></div><h3>Top Loss Causes</h3>${top.map(([k,v])=>`<div class=suggestionBox>${v}× ${clean(k)}</div>`).join('')||'<p>No losses yet.</p>'}<h3>Recent Server Trades</h3>${trades.slice(0,15).map(x=>`<div class="journalRow ${x.result==='WIN'?'win':x.result==='LOSS'?'loss':'open'}"><h4>${x.result||x.status} | ${x.symbol} ${x.timeframe} ${x.direction} q${x.quality||''}%</h4><small>${x.opened_at||''} → ${x.closed_at||'OPEN'} | Entry ${x.entry} SL ${x.sl} TP1 ${x.tp1}</small><p>${clean(x.result_cause||x.reason||'قيد المتابعة')}</p><div class=suggestionBox>اقتراح: ${clean(x.suggested_fix||'بانتظار النتيجة')}</div></div>`).join('')}`;
  res.status(200).json({ok:true,stats:{total:trades.length,open,wins,losses,win_rate:wr},top_loss_causes:top,html});
}
function parse(v){const n=Number(String(v??'').replace(/,/g,''));return Number.isFinite(n)?n:null}
function analyzeBacktestSuggestions(summary,trades){
  const lossCauses={}; trades.filter(t=>t.res==='LOSS'||t.result==='LOSS').forEach(t=>{const k=t.failure||t.failure_cause||'Unknown';lossCauses[k]=(lossCauses[k]||0)+1});
  const top=Object.entries(lossCauses).sort((a,b)=>b[1]-a[1])[0];
  const suggestions=[];
  if(Number(summary.winRate||0)<55) suggestions.push({issue:'Win rate below 55%',suggested_change:`Raise min quality or reduce session/time window. Current WR ${Number(summary.winRate||0).toFixed(1)}%`,affected_rule:'min_quality',confidence:.7});
  if(top&&/Sweep|liquidity/i.test(top[0])) suggestions.push({issue:top[0],suggested_change:'Require retest/confirmation after liquidity sweep before entry.',affected_rule:'sweep_retest',confidence:.78});
  if(top&&/Target Guard/i.test(top[0])) suggestions.push({issue:top[0],suggested_change:'Keep Target Guard as hard block and move TP1 before nearest obstacle.',affected_rule:'target_guard',confidence:.75});
  if(!suggestions.length && top) suggestions.push({issue:top[0],suggested_change:'Compare this loss cause by session and timeframe, then tighten the most affected rule only.',affected_rule:'diagnostic',confidence:.62});
  return {lossCauses,suggestions};
}
async function backtest(req,res){
  const b=await readBody(req),s=b.summary||{},trades=b.trades||[];
  const losses=Number(s.losses||0),wins=Number(s.wins||0),total=Number(s.totalTrades||trades.length||0),wr=Number(s.winRate||0);
  const a=analyzeBacktestSuggestions(s,trades);
  const runRow={strategy_version:b.version||'V12.4.1_DNA_FIX12',symbol:s.symbol,source:s.source,timeframe:s.tf,mode:s.mode,from_date:s.from,to_date:s.to,settings_json:s.settings||{},total_trades:total,wins,losses,open_trades:Number(s.openTrades||0),win_rate:wr,avg_r:num(s.avgR),profit_factor:num(s.profitFactor),max_drawdown:num(s.maxDrawdown),analysis_json:{lossCauses:a.lossCauses,summary:s,suggestions:a.suggestions,skipCauses:s.skipCauses||{}}};
  const ins=await sb('backtest_runs',{method:'POST',body:runRow});
  const run=Array.isArray(ins)?ins[0]:ins;
  if(run?.id&&trades.length){
    const rows=trades.slice(0,7000).map((t,i)=>({run_id:run.id,sequence:i+1,symbol:t.symbol||s.symbol,timeframe:t.tf||s.tf,mode:t.mode||s.mode,entry_time:t.time,session:t.session||'',direction:t.dir,grade:t.grade,quality:parse(t.q),entry:parse(t.entry),sl:parse(t.sl),tp1:parse(t.tp1),tp2:parse(t.tp2),tp3:parse(t.tp3),result:t.res||t.result,exit_price:parse(t.exit),exit_time:t.etime,mfe:parse(t.mfe),mae:parse(t.mae),final_r:parse(t.finalR),cost:parse(t.cost),candle:clean(t.candle),target_guard:clean(t.targetGuard),gann:clean(t.gann),failure_cause:clean(t.failure),reason:clean(t.reason),snapshot_json:t.snapshot||{}}));
    for(let i=0;i<rows.length;i+=500){ await sb('backtest_trades',{method:'POST',body:rows.slice(i,i+500),prefer:'return=minimal'}); }
    for(const sg of a.suggestions){
      await addSuggestion('backtest',s.symbol,s.tf,s.mode,sg.issue,sg.suggested_change,sg.affected_rule,sg.confidence,{run_id:run.id,summary:s,lossCauses:a.lossCauses}).catch(()=>null);
    }
  }
  res.status(200).json({ok:true,run_id:run?.id,total_saved:trades.length,lossCauses:a.lossCauses,suggestions:a.suggestions});
}
async function recommendations(req,res){
  let rows=[];
  try{ rows=await sb('strategy_rule_suggestions?select=*&order=created_at.desc&limit=50'); }catch(e){ rows=[]; }
  const html=rows.length?rows.map(x=>`<div class=suggestionBox><b>${clean(x.affected_rule||'rule')}</b> — ${clean(x.issue)}<br>تعديل مقترح: ${clean(x.suggested_change)}<br><small>${x.symbol||''} ${x.timeframe||''} ${x.mode||''} | confidence ${Math.round((x.confidence||0)*100)}%</small></div>`).join(''):'<p>No rule suggestions yet. Run backtests or close trades first.</p>';
  res.status(200).json({ok:true,suggestions:rows,html});
}
module.exports=async function(req,res){
  try{
    const action=String(req.query.action||req.query.type||'review').toLowerCase();
    if(action==='health') return health(req,res);
    if(!available()) return res.status(200).json({ok:false,disabled:true,error:'Supabase env missing'});
    if(action==='create') return create(req,res);
    if(action==='update') return update(req,res);
    if(action==='open') return open(req,res);
    if(action==='review') return review(req,res);
    if(action==='backtest') return backtest(req,res);
    if(action==='recommendations') return recommendations(req,res);
    return res.status(400).json({ok:false,error:'Unknown journal action'});
  }catch(e){
    res.status(e.disabled?200:500).json({ok:false,disabled:!!e.disabled,error:e.message});
  }
};
