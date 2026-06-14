const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function ft(url,opt={},ms=9000){const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);try{return await fetch(url,{...opt,signal:c.signal})}finally{clearTimeout(t)}}
function clean(x){return typeof x==='string'?x.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,900):x}
function normTf(t){return String(t||'5m').replace('m','m').replace('h','h')}
module.exports=async function(req,res){try{
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'GET only'});
 const token=process.env.METAAPI_TOKEN,accountId=process.env.METAAPI_ACCOUNT_ID;
 if(!token||!accountId)return res.status(500).json({ok:false,error:'Missing METAAPI_TOKEN or METAAPI_ACCOUNT_ID'});
 const symbol=String(req.query.symbol||'XAUUSD').trim(),region=process.env.METAAPI_REGION||'london';
 const host=process.env.METAAPI_CLIENT_HOST||`https://mt-client-api-v1.${region}.agiliumtrade.ai`;
 const wantCandles=!!(req.query.timeframe||req.query.limit||req.query.kind==='candles'||req.query.type==='candles');
 if(wantCandles){
   const tf=normTf(req.query.timeframe||'5m'),limit=Math.max(1,Math.min(parseInt(req.query.limit||'700',10),1000));
   let url=`${host}/users/current/accounts/${encodeURIComponent(accountId)}/symbols/${encodeURIComponent(symbol)}/timeframes/${encodeURIComponent(tf)}/candles?limit=${limit}`;
   if(req.query.startTime)url+=`&startTime=${encodeURIComponent(req.query.startTime)}`;
   let status=0,detail='',attempts=0;
   for(let i=0;i<4;i++){attempts=i+1;let up;try{up=await ft(url,{headers:{Accept:'application/json','auth-token':token}},10000)}catch(e){status=504;detail=e.message;if(i<3)await sleep(500*Math.pow(1.7,i));continue}
    status=up.status;const text=await up.text();let data;try{data=JSON.parse(text)}catch{data=text}
    if(up.ok){res.setHeader('Cache-Control','no-store,max-age=0');return res.status(200).json({ok:true,source:'metaapi',symbol,timeframe:tf,attempts,candles:data})}
    detail=clean(data); if(![429,500,502,503,504].includes(status)||i===3)break; await sleep(500*Math.pow(1.7,i));
   }
   return res.status(status||500).json({ok:false,error:'MetaAPI candles failed',status,attempts,detail});
 }
 const url=`${host}/users/current/accounts/${encodeURIComponent(accountId)}/symbols/${encodeURIComponent(symbol)}/current-price?keepSubscription=true`;
 let status=0,detail='',attempts=0;
 for(let i=0;i<3;i++){attempts=i+1;let up;try{up=await ft(url,{headers:{Accept:'application/json','auth-token':token}},9000)}catch(e){status=504;detail=e.message;if(i<2)await sleep(400*Math.pow(1.7,i));continue}
  status=up.status;const text=await up.text();let data;try{data=JSON.parse(text)}catch{data=text}
  if(up.ok){const bid=Number(data.bid),ask=Number(data.ask);res.setHeader('Cache-Control','no-store,max-age=0');return res.status(200).json({ok:true,source:'metaapi-current-price',symbol:data.symbol||symbol,bid,ask,mid:Number.isFinite(bid)&&Number.isFinite(ask)?(bid+ask)/2:null,spread:Number.isFinite(bid)&&Number.isFinite(ask)?ask-bid:null,time:data.time||null,brokerTime:data.brokerTime||null,raw:data})}
  detail=clean(data); if(![429,500,502,503,504].includes(status)||i===2)break; await sleep(400*Math.pow(1.7,i));
 }
 return res.status(status||500).json({ok:false,error:'MetaAPI current price failed',status,attempts,detail});
}catch(e){return res.status(500).json({ok:false,error:e.message||'Server error'})}};
