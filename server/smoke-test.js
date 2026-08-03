"use strict";

const http = require("http");
const {WebSocketServer} = require("ws");
const {attachTransport} = require("./transport");

// Smoke test: create/join/start/deploy plus active-game resume.
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function main(){
  const server=http.createServer((req,res)=>{ res.writeHead(200); res.end("ok"); });
  const transport=attachTransport(server);
  const clients=[];

  try{
    await new Promise(r=>server.listen(0,"127.0.0.1",r));
    const {port}=server.address();
    const url=`ws://127.0.0.1:${port}`;

    function waitFor(bag,predicate,label,timeout=2000){
      return new Promise((resolve,reject)=>{
        const started=Date.now();
        function check(){
          if(predicate(bag)) return resolve(bag);
          if(Date.now()-started>=timeout) return reject(new Error("timed out waiting for "+label+"; messages="+JSON.stringify(bag.msgs.slice(-5))));
          setTimeout(check,10);
        }
        check();
      });
    }
    function client(name){
      return new Promise((resolve,reject)=>{
        const ws=new (require("ws"))(url);
        const bag={ws,name,hello:null,identity:null,room:null,state:null,error:null,msgs:[]};
        clients.push(bag);
        ws.on("message",raw=>{
          const msg=JSON.parse(raw.toString());
          bag.msgs.push(msg);
          if(msg.type==="hello") bag.hello=msg;
          if(msg.type==="identity") bag.identity=msg;
          if(msg.type==="room") bag.room=msg;
          if(msg.type==="state") bag.state=msg.state;
          if(msg.type==="error") bag.error=msg;
        });
        ws.once("error",reject);
        ws.once("open",()=>resolve(bag));
      });
    }
    function send(c,type,payload={}){ c.ws.send(JSON.stringify({type,...payload})); }

    const a=await client("A");
    const b=await client("B");
    const c=await client("C");
    await Promise.all([
      waitFor(a,x=>x.hello&&x.hello.ready,"A hello"),
      waitFor(b,x=>x.hello&&x.hello.ready,"B hello"),
      waitFor(c,x=>x.hello&&x.hello.ready,"C hello")
    ]);
    if(a.hello.playerId!==undefined || b.hello.playerId!==undefined || c.hello.playerId!==undefined){
      throw new Error("hello must not contain playerId");
    }

    send(a,"create",{name:"房主甲"});
    await waitFor(a,x=>x.identity&&x.room&&x.state,"create identity/state");
    if(!a.identity.playerId || !a.identity.roomToken || !a.identity.resumeToken) throw new Error("create identity incomplete");
    const code=a.room.roomCode;
    const token=a.room.inviteToken;
    if(token!==a.identity.roomToken) throw new Error("create room token mismatch");

    send(b,"join",{code,name:"玩家乙"});
    await waitFor(b,x=>x.identity&&x.room&&x.state,"B join identity/state");
    if(!b.identity.playerId || b.identity.roomToken!==token || !b.identity.resumeToken) throw new Error("B join identity incomplete");
    send(c,"join",{token,name:"玩家丙"});
    await waitFor(c,x=>x.identity&&x.room&&x.state,"C join identity/state");
    if(!c.identity.playerId || c.identity.roomToken!==token || !c.identity.resumeToken) throw new Error("C join identity incomplete");
    await waitFor(a,x=>(x.room.players||[]).length===3,"three-player room");

    send(a,"ready",{value:true});
    send(b,"ready",{value:true});
    send(c,"ready",{value:true});
    await waitFor(a,x=>x.room.players.every(p=>p.ready),"all players ready");
    send(a,"start",{});
    await waitFor(a,x=>x.state&&x.state.started,"game start");
    await waitFor(b,x=>x.state&&x.state.started,"B game start");
    if(a.state.hostId!==a.identity.playerId) throw new Error("start host identity mismatch");

    const troop=a.state.tray[0];
    if(!troop) throw new Error("no A tray troop");
    send(a,"deploy",{troopId:troop.id,targetSlot:0});
    await waitFor(a,x=>x.state.slots[0]&&x.state.slots[0].id===troop.id,"A deploy");

    const troopB=b.state.tray[0];
    if(!troopB) throw new Error("no B tray troop");
    send(b,"deploy",{troopId:troopB.id,targetSlot:1});
    await waitFor(b,x=>x.state.slots[1]&&x.state.slots[1].id===troopB.id,"B deploy");
    if(b.state.tray.some(t=>t.id===troopB.id)) throw new Error("B deployed troop remained in tray");

    const invalid=await client("invalid-resume");
    await waitFor(invalid,x=>x.hello&&x.hello.ready,"invalid resume hello");
    send(invalid,"resume",{
      playerId:b.identity.playerId,
      roomToken:b.identity.roomToken,
      resumeToken:"invalid-token"
    });
    await waitFor(invalid,x=>x.error,"invalid resume error");
    if(invalid.error.code!=="resume_failed") throw new Error("invalid resume did not return resume_failed");

    const savedIdentity={
      playerId:b.identity.playerId,
      roomToken:b.identity.roomToken,
      resumeToken:b.identity.resumeToken
    };
    const savedState={
      started:b.state.started,
      phase:b.state.phase,
      pathIndex:b.state.players.find(p=>p.id===savedIdentity.playerId).pathIndex,
      trayIds:b.state.tray.map(t=>t.id),
      slotIds:b.state.slots.map(t=>t&&t.id)
    };
    await new Promise(resolve=>{ b.ws.once("close",resolve); b.ws.close(); });
    await waitFor(a,x=>x.room.players.some(p=>p.id===savedIdentity.playerId&&!p.connected),"B disconnect");

    const resumed=await client("B-resumed");
    await waitFor(resumed,x=>x.hello&&x.hello.ready,"replacement hello");
    send(resumed,"resume",savedIdentity);
    await waitFor(resumed,x=>x.identity&&x.identity.resumed&&x.room&&x.state,"B resume");
    if(resumed.identity.playerId!==savedIdentity.playerId) throw new Error("resume changed playerId");
    if(resumed.room.players.length!==3) throw new Error("resume changed player count");
    const resumedPath=resumed.state.players.find(p=>p.id===savedIdentity.playerId).pathIndex;
    if(resumed.state.started!==savedState.started || resumed.state.phase!==savedState.phase || resumedPath!==savedState.pathIndex){
      throw new Error("resume did not preserve game/path state");
    }
    if(JSON.stringify(resumed.state.tray.map(t=>t.id))!==JSON.stringify(savedState.trayIds)) throw new Error("resume did not preserve B tray");
    if(JSON.stringify(resumed.state.slots.map(t=>t&&t.id))!==JSON.stringify(savedState.slotIds)) throw new Error("resume did not preserve slots");

    const resumedTroop=resumed.state.tray[0];
    if(!resumedTroop) throw new Error("no B tray troop after resume");
    send(resumed,"deploy",{troopId:resumedTroop.id,targetSlot:2});
    await waitFor(resumed,x=>x.state.slots[2]&&x.state.slots[2].id===resumedTroop.id,"post-resume command");
    if(resumed.state.revision===undefined) throw new Error("no revision");

    console.log("SMOKE OK", {
      room:code,
      players:resumed.room.players.map(p=>p.name),
      resumedPlayerId:resumed.identity.playerId,
      started:resumed.state.started,
      phase:resumed.state.phase,
      slot0:resumed.state.slots[0]&&resumed.state.slots[0].name,
      slot1:resumed.state.slots[1]&&resumed.state.slots[1].name,
      slot2:resumed.state.slots[2]&&resumed.state.slots[2].name,
      trayB:resumed.state.tray.length
    });
  } finally {
    for(const c of clients){
      if(c.ws.readyState===c.ws.OPEN || c.ws.readyState===c.ws.CONNECTING) c.ws.terminate();
    }
    await wait(20);
    await new Promise(resolve=>transport.wss.close(resolve));
    if(server.listening) await new Promise(resolve=>server.close(resolve));
  }
}

main().then(()=>process.exit(0)).catch(e=>{ console.error("SMOKE FAIL", e); process.exit(1); });
