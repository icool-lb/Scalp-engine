const {available,readBody,sb,num,clean}=require('./_supabase');
module.exports=async function(req,res){try{
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'POST only'});
  if(!available())return res.status(200).json({ok:false,disabled:true,error:'Supabase env missing'});
  const b=await readBody(req),t=b.trade||{},rec=b.record||{};
  const snap=t.analysisSnapshot||rec.snapshot||{};
  const row={client_trade_id:String(t.createdAt||rec.id||Date.now()),strategy_version:b.version||'V12.3',symbol:t.symbol||rec.symbol,source:(snap.source&&snap.source.source)||t.source||'',timeframe:t.tf||rec.tf,mode:t.mode||rec.mode,direction:t.dir||rec.dir,quality:num(t.q||rec.q),grade:t.grade||rec.grade,entry:num(t.entry),sl:num(t.sl),tp1:num(t.tp1),tp2:num(t.tp2),tp3:num(t.tp3),release_at:t.releaseAt||rec.releaseAt,status:'ACTIVE',result:'OPEN',opened_at:new Date(t.createdAt||Date.now()).toISOString(),reason:clean(t.reason||rec.reason),snapshot_json:snap||{},report_text:t.reportText||rec.reportText||''};
  const inserted=await sb('trades?on_conflict=client_trade_id',{method:'POST',body:row,prefer:'resolution=merge-duplicates,return=representation'});
  const trade=Array.isArray(inserted)?inserted[0]:inserted;
  if(trade?.id)await sb('trade_events',{method:'POST',body:{trade_id:trade.id,event_type:'LOCKED',price:row.entry,note:row.reason}}).catch(()=>null);
  res.status(200).json({ok:true,trade_id:trade?.id,trade});
}catch(e){res.status(e.disabled?200:500).json({ok:false,disabled:!!e.disabled,error:e.message})}}
