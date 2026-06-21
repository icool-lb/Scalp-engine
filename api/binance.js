const spotHosts=['https://api.binance.com','https://api1.binance.com','https://data-api.binance.vision'];
const futuresHosts=['https://fapi.binance.com','https://fapi1.binance.com'];

async function fetchJSON(url){
  const r=await fetch(url,{headers:{Accept:'application/json'},cache:'no-store'});
  const j=await r.json().catch(()=>null);
  if(!r.ok) throw Object.assign(new Error(j?.msg||j?.message||`HTTP ${r.status}`),{detail:j,status:r.status});
  return j;
}
async function tryMarket(pathSpot,pathFutures,preferFutures=false){
  const markets=preferFutures
    ? [['futures',futuresHosts,pathFutures],['spot',spotHosts,pathSpot]]
    : [['spot',spotHosts,pathSpot],['futures',futuresHosts,pathFutures]];
  let lastErr=null;
  for(const [market,hosts,path] of markets){
    if(!path) continue;
    for(const h of hosts){
      try{
        const data=await fetchJSON(h+path);
        return{market,host:h,data};
      }catch(e){lastErr=e.detail||e.message;}
    }
  }
  throw Object.assign(new Error('Binance failed on spot and futures'),{detail:lastErr});
}
function sym(req){return String(req.query.symbol||'BTCUSDT').toUpperCase().trim();}
function preferFutures(symbol){return symbol==='BTWUSDT'||String(symbol).endsWith('.P');}
module.exports=async function(req,res){try{
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'GET only'});
 const type=String(req.query.type||'price').toLowerCase(),symbol=sym(req).replace('.P','');
 const pf=preferFutures(symbol);

 if(type==='price'){
   const pathSpot=`/api/v3/ticker/bookTicker?symbol=${encodeURIComponent(symbol)}`;
   const pathFut=`/fapi/v1/ticker/bookTicker?symbol=${encodeURIComponent(symbol)}`;
   const {host,market,data:j}=await tryMarket(pathSpot,pathFut,pf);
   const bid=Number(j.bidPrice),ask=Number(j.askPrice);
   res.setHeader('Cache-Control','no-store,max-age=0');
   return res.status(200).json({ok:true,source:'binance',market,host,symbol,bid,ask,mid:(bid+ask)/2,spread:ask-bid,time:new Date().toISOString(),raw:j});
 }

 if(type==='klines'){
   const interval=String(req.query.timeframe||'5m'),limit=Math.max(1,Math.min(parseInt(req.query.limit||'700',10),1000));
   const qs=new URLSearchParams({symbol,interval,limit:String(limit)});
   if(req.query.startTime)qs.set('startTime',String(req.query.startTime));
   const {host,market,data:j}=await tryMarket(`/api/v3/klines?${qs}`,`/fapi/v1/klines?${qs}`,pf);
   const candles=j.map(k=>({symbol,time:new Date(k[0]).toISOString(),open:Number(k[1]),high:Number(k[2]),low:Number(k[3]),close:Number(k[4]),volume:Number(k[5]),tickVolume:Number(k[8]||k[5]),state:'complete'}));
   res.setHeader('Cache-Control','no-store,max-age=0');
   return res.status(200).json({ok:true,source:'binance',market,host,symbol,timeframe:interval,candles});
 }

 if(type==='depth'){
   const limit=Math.max(5,Math.min(parseInt(req.query.limit||'100',10),500));
   const {host,market,data:j}=await tryMarket(`/api/v3/depth?symbol=${encodeURIComponent(symbol)}&limit=${limit}`,`/fapi/v1/depth?symbol=${encodeURIComponent(symbol)}&limit=${limit}`,pf);
   const bids=(j.bids||[]).map(x=>[Number(x[0]),Number(x[1])]),asks=(j.asks||[]).map(x=>[Number(x[0]),Number(x[1])]);
   const bidVolume=bids.reduce((s,x)=>s+x[1],0),askVolume=asks.reduce((s,x)=>s+x[1],0);
   res.setHeader('Cache-Control','no-store,max-age=0');
   return res.status(200).json({ok:true,source:'binance-depth',market,host,symbol,bidVolume,askVolume,bids:bids.slice(0,30),asks:asks.slice(0,30),time:new Date().toISOString()});
 }

 if(type==='aggtrades'){
   const limit=Math.max(1,Math.min(parseInt(req.query.limit||'800',10),1000));
   const {host,market,data:j}=await tryMarket(`/api/v3/aggTrades?symbol=${encodeURIComponent(symbol)}&limit=${limit}`,`/fapi/v1/aggTrades?symbol=${encodeURIComponent(symbol)}&limit=${limit}`,pf);
   let buyAggVolume=0,sellAggVolume=0;
   for(const t of j){const q=Number(t.q||0); if(t.m) sellAggVolume+=q; else buyAggVolume+=q}
   res.setHeader('Cache-Control','no-store,max-age=0');
   return res.status(200).json({ok:true,source:'binance-aggtrades',market,host,symbol,buyAggVolume,sellAggVolume,count:j.length,time:new Date().toISOString()});
 }

 return res.status(400).json({ok:false,error:'bad type'});
}catch(e){return res.status(500).json({ok:false,error:e.message||'Binance error',detail:e.detail||null})}};
