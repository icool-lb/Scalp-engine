const {available,readBody,sb,num,clean}=require('./_supabase');
function reviewFrom(record,status,resultAnalysis){if(resultAnalysis)return resultAnalysis;return {result:status==='SL HIT'?'LOSS':(status&&status.includes('TP')?'WIN':'OPEN'),resultCause:status==='SL HIT'?'SL hit':'Still active',suggestedFix:''}}
module.exports=async function(req,res){try{
 if(req.method!=='POST')return res.status(405).json({ok:false,error:'POST only'});
 if(!available())return res.status(200).json({ok:false,disabled:true,error:'Supabase env missing'});
 const b=await readBody(req),id=String(b.client_trade_id||b.record?.id||b.trade?.createdAt||''); if(!id)return res.status(400).json({ok:false,error:'missing client_trade_id'});
 const rows=await sb(`trades?client_trade_id=eq.${encodeURIComponent(id)}&select=*`); const tr=rows?.[0]; if(!tr)return res.status(404).json({ok:false,error:'trade not found'});
 const rec=b.record||{}, status=b.status||rec.status||'ACTIVE', price=num(b.price??rec.lastPrice??rec.exit), closed=status==='SL HIT'||status==='TP2 HIT'||status==='TP3 HIT';
 const upd={status,updated_at:new Date().toISOString(),exit_price:closed?price:null,mfe:num(rec.mfe)||tr.mfe||0,mae:num(rec.mae)||tr.mae||0,max_favorable_r:num(rec.maxFavorableR)||tr.max_favorable_r||0,max_adverse_r:num(rec.maxAdverseR)||tr.max_adverse_r||0};
 if(closed){const rv=reviewFrom(rec,status,b.resultAnalysis);upd.result=rv.result|| (status==='SL HIT'?'LOSS':'WIN');upd.closed_at=rv.closedAt||new Date().toISOString();upd.result_cause=clean(rv.resultCause);upd.suggested_fix=clean(rv.suggestedFix)}
 await sb(`trades?client_trade_id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:upd});
 if(price!=null)await sb('trade_price_path',{method:'POST',body:{trade_id:tr.id,price,mfe:upd.mfe,mae:upd.mae,r_value:upd.max_favorable_r,status}}).catch(()=>null);
 await sb('trade_events',{method:'POST',body:{trade_id:tr.id,event_type:status,price,note:closed?upd.result_cause:'update'}}).catch(()=>null);
 if(closed){const rv=reviewFrom(rec,status,b.resultAnalysis);await sb('trade_reviews?on_conflict=trade_id',{method:'POST',prefer:'resolution=merge-duplicates,return=representation',body:{trade_id:tr.id,result:upd.result,result_cause:clean(rv.resultCause),failure_reason:upd.result==='LOSS'?clean(rv.resultCause):'',success_reason:upd.result==='WIN'?clean(rv.resultCause):'',suggested_fix:clean(rv.suggestedFix),rule_to_adjust:clean(rv.ruleToAdjust||''),confidence:rv.confidence||0.65,metrics_json:rv||{}}}).catch(()=>null)}
 res.status(200).json({ok:true,trade_id:tr.id,status,result:upd.result||'OPEN'});
}catch(e){res.status(e.disabled?200:500).json({ok:false,disabled:!!e.disabled,error:e.message})}}
