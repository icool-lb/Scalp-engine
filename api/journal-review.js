const {available,sb,clean}=require('./_supabase');
module.exports=async function(req,res){try{
 if(!available())return res.status(200).json({ok:false,disabled:true,error:'Supabase env missing'});
 const trades=await sb('trades?select=*&order=created_at.desc&limit=200');
 const closed=trades.filter(x=>x.result==='WIN'||x.result==='LOSS'),wins=closed.filter(x=>x.result==='WIN').length,losses=closed.filter(x=>x.result==='LOSS').length,open=trades.filter(x=>x.result==='OPEN'||x.status==='ACTIVE').length,wr=closed.length?wins/closed.length*100:0;
 const causes={};closed.filter(x=>x.result==='LOSS').forEach(x=>{const k=x.result_cause||'Unknown';causes[k]=(causes[k]||0)+1});
 const top=Object.entries(causes).sort((a,b)=>b[1]-a[1]).slice(0,5);
 const html=`<div class=sourceNote>☁️ Supabase Server Journal</div><div class=journalGrid><div class=jstat><b>${trades.length}</b><span>Total</span></div><div class=jstat><b>${open}</b><span>Open</span></div><div class=jstat><b>${wins}/${losses}</b><span>Win/Loss</span></div><div class=jstat><b>${wr.toFixed(1)}%</b><span>WR Closed</span></div></div><h3>Top Loss Causes</h3>${top.map(([k,v])=>`<div class=suggestionBox>${v}× ${clean(k)}</div>`).join('')||'<p>No losses yet.</p>'}<h3>Recent Server Trades</h3>${trades.slice(0,12).map(x=>`<div class="journalRow ${x.result==='WIN'?'win':x.result==='LOSS'?'loss':'open'}"><h4>${x.result||x.status} | ${x.symbol} ${x.timeframe} ${x.direction} q${x.quality||''}%</h4><small>${x.opened_at||''} → ${x.closed_at||'OPEN'} | Entry ${x.entry} SL ${x.sl} TP1 ${x.tp1}</small><p>${clean(x.result_cause||x.reason||'قيد المتابعة')}</p><div class=suggestionBox>اقتراح: ${clean(x.suggested_fix||'بانتظار النتيجة')}</div></div>`).join('')}`;
 res.status(200).json({ok:true,stats:{total:trades.length,open,wins,losses,win_rate:wr},top_loss_causes:top,html});
}catch(e){res.status(e.disabled?200:500).json({ok:false,disabled:!!e.disabled,error:e.message})}}
