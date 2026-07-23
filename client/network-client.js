"use strict";

class NetworkClient {
  constructor({url,onMessage,onStatus,onError}={}){
    this.url=url||((location.protocol==="https:"?"wss://":"ws://")+location.host);
    this.onMessage=onMessage||(()=>{});
    this.onStatus=onStatus||(()=>{});
    this.onError=onError||(()=>{});
    this.ws=null;
  }
  connect(){
    if(this.ws && this.ws.readyState<=1) return;
    this.onStatus("connecting");
    this.ws=new WebSocket(this.url);
    this.ws.addEventListener("open",()=>this.onStatus("connected"));
    this.ws.addEventListener("close",()=>this.onStatus("offline"));
    this.ws.addEventListener("error",()=>this.onError("连接服务器失败"));
    this.ws.addEventListener("message",e=>{
      try{ this.onMessage(JSON.parse(e.data)); }
      catch(err){ this.onError("服务器消息错误"); }
    });
  }
  send(type,payload={}){
    if(!this.ws || this.ws.readyState!==WebSocket.OPEN){ this.onError("尚未连接服务器"); return false; }
    this.ws.send(JSON.stringify({type,...payload})); return true;
  }
}

if(typeof module!=="undefined") module.exports={NetworkClient};
