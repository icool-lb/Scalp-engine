const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function ft(url,opt={},ms=12000){const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);try{return await fetch(url,{...opt,signal:c.signal})}finally{clearTimeout(t)}}
function clean(x){return typeof x==='string'?x.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,700):x}
module.exports=async function(req,res){try{
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'GET only'});
 const token=process.env.METAAPI_TOKEN,accountId=process.env.METAAPI_ACCOUNT_ID;
 if(!token||!accountId)return res.status(500).json({ok:false,error:'Missing METAAPI_TOKEN or METAAPI_ACCOUNT_ID'});
 const symbol=String(req.query.symbol||'XAUUSD').trim(),tf=String(req.query.timeframe||'5m').trim(),limit=Math.max(1,Math.min(parseInt(req.query.limit||'700',10),1000));
 const region=process.env.METAAPI_REGION||'london';
 const host=process.env.METAAPI_MARKET_DATA_HOST||`https://mt-market-data-client-api-v1.${region}.agiliumtrade.ai`;
 const params=new URLSearchParams({limit:String(limit)}); if(req.query.startTime)params.set('startTime',String(req.query.startTime));
 const url=`${host}/users/current/accounts/${encodeURIComponent(accountId)}/historical-market-data/symbols/${encodeURIComponent(symbol)}/timeframes/${encodeURIComponent(tf)}/candles?${params}`;
 let status=0,detail='',attempts=0;
 for(let i=0;i<4;i++){attempts=i+1;let up;try{up=await ft(url,{headers:{Accept:'application/json','auth-token':token}},12000)}catch(e){status=504;detail=e.message;if(i<3)await sleep(500*Math.pow(1.7,i));continue}
  status=up.status;const text=await up.text();let data;try{data=JSON.parse(text)}catch{data=text}
  if(up.ok){res.setHeader('Cache-Control','no-store,max-age=0');return res.status(200).json({ok:true,source:'metaapi',symbol,timeframe:tf,attempts,candles:data})}
  detail=clean(data); if(![429,500,502,503,504].includes(status)||i===3)break; await sleep(500*Math.pow(1.7,i));
 }
 return res.status(status||500).json({ok:false,error:'MetaAPI candles failed',status,attempts,detail});
}catch(e){return res.status(500).json({ok:false,error:e.message||'Server error'})}};