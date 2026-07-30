"use strict";

class NetworkClient {
  constructor({url,onMessage,onStatus,onError}={}){
    this.url=url||((location.protocol==="https:"?"wss://":"ws://")+location.host);
    this.onMessage=onMessage||(()=>{});
    this.onStatus=onStatus||(()=>{});
    this.onError=onError||(()=>{});
    this.ws=null;
    this.retryTimer=null;
    this.retryCount=0;
    this.closed=false;
  }
  connect(){
    this.closed=false;
    if(this.ws && this.ws.readyState<=1) return;
    clearTimeout(this.retryTimer);
    this.onStatus(this.retryCount>0?"reconnecting":"connecting");
    const ws=new WebSocket(this.url);
    this.ws=ws;
    ws.addEventListener("open",()=>{
      if(this.ws!==ws) return;
      this.retryCount=0;
      this.onStatus("connected");
    });
    ws.addEventListener("close",()=>{
      if(this.ws!==ws) return;
      this.ws=null;
      if(this.closed){ this.onStatus("offline"); return; }
      this.scheduleReconnect();
    });
    ws.addEventListener("error",()=>{
      if(this.ws===ws) this.onError("连接服务器失败，正在重试");
    });
    ws.addEventListener("message",e=>{
      try{ this.onMessage(JSON.parse(e.data)); }
      catch(err){ this.onError("服务器消息错误"); }
    });
  }
  scheduleReconnect(){
    clearTimeout(this.retryTimer);
    const delay=Math.min(10000,1000*Math.pow(2,Math.min(this.retryCount,3)));
    this.retryCount++;
    this.onStatus("reconnecting");
    this.retryTimer=setTimeout(()=>this.connect(),delay);
  }
  disconnect(){
    this.closed=true;
    clearTimeout(this.retryTimer);
    if(this.ws) this.ws.close();
    this.ws=null;
  }
  send(type,payload={}){
    if(!this.ws || this.ws.readyState!==WebSocket.OPEN){
      this.onError("服务器正在连接，请稍后重试");
      this.connect();
      return false;
    }
    this.ws.send(JSON.stringify({type,...payload})); return true;
  }
}

if(typeof module!=="undefined") module.exports={NetworkClient};
