const hosts=['https://api.binance.com','https://api1.binance.com','https://data-api.binance.vision'];
async function tryHosts(path){let lastErr=null;for(const h of hosts){try{const r=await fetch(h+path,{headers:{Accept:'application/json'},cache:'no-store'});const j=await r.json().catch(()=>null);if(!r.ok){lastErr=j;continue}return{host:h,data:j}}catch(e){lastErr={msg:e.message}}}throw Object.assign(new Error('Binance failed on all hosts'),{detail:lastErr})}
module.exports=async function(req,res){try{
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'GET only'});
 const type=String(req.query.type||'price').toLowerCase(),symbol=String(req.query.symbol||'BTCUSDT').toUpperCase();
 if(type==='price'){
   const {host,data:j}=await tryHosts(`/api/v3/ticker/bookTicker?symbol=${encodeURIComponent(symbol)}`);
   const bid=Number(j.bidPrice),ask=Number(j.askPrice);res.setHeader('Cache-Control','no-store,max-age=0');return res.status(200).json({ok:true,source:'binance',host,symbol,bid,ask,mid:(bid+ask)/2,spread:ask-bid,time:new Date().toISOString(),raw:j});
 }
 if(type==='klines'){
   const interval=String(req.query.timeframe||'5m'),limit=Math.max(1,Math.min(parseInt(req.query.limit||'700',10),1000));const qs=new URLSearchParams({symbol,interval,limit:String(limit)});if(req.query.startTime)qs.set('startTime',String(req.query.startTime));
   const {host,data:j}=await tryHosts(`/api/v3/klines?${qs}`);
   const candles=j.map(k=>({symbol,time:new Date(k[0]).toISOString(),open:Number(k[1]),high:Number(k[2]),low:Number(k[3]),close:Number(k[4]),volume:Number(k[5]),tickVolume:Number(k[8]||k[5]),state:'complete'}));res.setHeader('Cache-Control','no-store,max-age=0');return res.status(200).json({ok:true,source:'binance',host,symbol,timeframe:interval,candles});
 }
 if(type==='depth'){
   const limit=Math.max(5,Math.min(parseInt(req.query.limit||'100',10),500));const {host,data:j}=await tryHosts(`/api/v3/depth?symbol=${encodeURIComponent(symbol)}&limit=${limit}`);
   const bids=(j.bids||[]).map(x=>[Number(x[0]),Number(x[1])]),asks=(j.asks||[]).map(x=>[Number(x[0]),Number(x[1])]);const bidVolume=bids.reduce((s,x)=>s+x[1],0),askVolume=asks.reduce((s,x)=>s+x[1],0);res.setHeader('Cache-Control','no-store,max-age=0');return res.status(200).json({ok:true,source:'binance-depth',host,symbol,bidVolume,askVolume,bids:bids.slice(0,30),asks:asks.slice(0,30),time:new Date().toISOString()});
 }
 if(type==='aggtrades'){
   const limit=Math.max(1,Math.min(parseInt(req.query.limit||'800',10),1000));const {host,data:j}=await tryHosts(`/api/v3/aggTrades?symbol=${encodeURIComponent(symbol)}&limit=${limit}`);
   let buyAggVolume=0,sellAggVolume=0;for(const t of j){const q=Number(t.q||0);if(t.m) sellAggVolume+=q; else buyAggVolume+=q}res.setHeader('Cache-Control','no-store,max-age=0');return res.status(200).json({ok:true,source:'binance-aggtrades',host,symbol,buyAggVolume,sellAggVolume,count:j.length,time:new Date().toISOString()});
 }
 return res.status(400).json({ok:false,error:'Unknown Binance type'});
}catch(e){return res.status(502).json({ok:false,error:e.message,detail:e.detail||null})}};
