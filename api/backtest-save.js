const {available,readBody,sb,num,clean}=require('./_supabase');
function parse(v){const n=Number(String(v??'').replace(/,/g,''));return Number.isFinite(n)?n:null}
module.exports=async function(req,res){try{
 if(req.method!=='POST')return res.status(405).json({ok:false,error:'POST only'});
 if(!available())return res.status(200).json({ok:false,disabled:true,error:'Supabase env missing'});
 const b=await readBody(req),s=b.summary||{},trades=b.trades||[];
 const losses=Number(s.losses||0),wins=Number(s.wins||0),total=Number(s.totalTrades||trades.length||0),wr=Number(s.winRate||0);
 const lossCauses={};trades.filter(t=>t.res==='LOSS'||t.result==='LOSS').forEach(t=>{const k=t.failure||t.failure_cause||'Unknown';lossCauses[k]=(lossCauses[k]||0)+1});
 const runRow={strategy_version:b.version||'V12.3',symbol:s.symbol,source:s.source,timeframe:s.tf,mode:s.mode,from_date:s.from,to_date:s.to,settings_json:s.settings||{},total_trades:total,wins,losses,open_trades:Number(s.openTrades||0),win_rate:wr,analysis_json:{lossCauses,summary:s}};
 const ins=await sb('backtest_runs',{method:'POST',body:runRow});const run=Array.isArray(ins)?ins[0]:ins;
 if(run?.id&&trades.length){const rows=trades.slice(0,5000).map((t,i)=>({run_id:run.id,sequence:i+1,symbol:t.symbol||s.symbol,timeframe:t.tf||s.tf,mode:t.mode||s.mode,entry_time:t.time,direction:t.dir,grade:t.grade,quality:parse(t.q),entry:parse(t.entry),sl:parse(t.sl),tp1:parse(t.tp1),tp2:parse(t.tp2),tp3:parse(t.tp3),result:t.res||t.result,exit_price:parse(t.exit),exit_time:t.etime,mfe:parse(t.mfe),mae:parse(t.mae),candle:clean(t.candle),target_guard:clean(t.targetGuard),gann:clean(t.gann),failure_cause:clean(t.failure),reason:clean(t.reason),snapshot_json:t.snapshot||{}}));for(let i=0;i<rows.length;i+=500){await sb('backtest_trades',{method:'POST',body:rows.slice(i,i+500),prefer:'return=minimal'});}}
 res.status(200).json({ok:true,run_id:run?.id,total_saved:trades.length,lossCauses});
}catch(e){res.status(e.disabled?200:500).json({ok:false,disabled:!!e.disabled,error:e.message})}}
