"use strict";

const http = require("http");
const {WebSocketServer} = require("ws");
const {attachTransport} = require("./transport");

// Minimal smoke test: create room, join 2 more, ready all, host start.
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function main(){
  const server=http.createServer((req,res)=>{ res.writeHead(200); res.end("ok"); });
  const transport=attachTransport(server);
  await new Promise(r=>server.listen(0,"127.0.0.1",r));
  const {port}=server.address();
  const url=`ws://127.0.0.1:${port}`;

  function client(name){
    return new Promise((resolve,reject)=>{
      const ws=new (require("ws"))(url);
      const bag={ws,name,id:null,room:null,state:null,msgs:[]};
      ws.on("open",()=>{});
      ws.on("message",raw=>{
        const msg=JSON.parse(raw.toString());
        bag.msgs.push(msg);
        if(msg.type==="hello") bag.id=msg.playerId;
        if(msg.type==="room") bag.room=msg;
        if(msg.type==="state") bag.state=msg.state;
        if(msg.type==="error") bag.err=msg.message;
      });
      ws.on("error",reject);
      setTimeout(()=>resolve(bag),100);
    });
  }
  function send(c,type,payload={}){ c.ws.send(JSON.stringify({type,...payload})); }

  const a=await client("A");
  const b=await client("B");
  const c=await client("C");
  await wait(80);
  send(a,"create",{name:"房主甲"});
  await wait(120);
  if(!a.room) throw new Error("create failed");
  const code=a.room.roomCode;
  const token=a.room.inviteToken;
  send(b,"join",{code,name:"玩家乙"});
  await wait(120);
  send(c,"join",{token,name:"玩家丙"});
  await wait(150);
  if((a.room.players||[]).length!==3) throw new Error("expected 3 players, got "+(a.room.players||[]).length);
  send(a,"ready",{value:true});
  send(b,"ready",{value:true});
  send(c,"ready",{value:true});
  await wait(120);
  send(a,"start",{});
  await wait(200);
  if(!a.state || !a.state.started) throw new Error("start failed: "+(a.err||"no state"));
  // deploy first tray troop
  const troop=a.state.tray[0];
  if(!troop) throw new Error("no tray troop");
  send(a,"deploy",{troopId:troop.id,targetSlot:0});
  await wait(120);
  if(!a.state.slots[0]) throw new Error("deploy failed");
  // second player deploy
  const troopB=b.state.tray[0];
  send(b,"deploy",{troopId:troopB.id,targetSlot:1});
  await wait(120);
  if(!b.state.slots[1]) throw new Error("player B deploy failed");
  // wait a few ticks
  await wait(300);
  if(a.state.revision===undefined) throw new Error("no revision");
  console.log("SMOKE OK", {
    room:code,
    players:a.room.players.map(p=>p.name),
    started:a.state.started,
    phase:a.state.phase,
    slot0:a.state.slots[0]&&a.state.slots[0].name,
    slot1:b.state.slots[1]&&b.state.slots[1].name,
    trayA:a.state.tray.length,
    trayB:b.state.tray.length
  });
  a.ws.close(); b.ws.close(); c.ws.close();
  transport.wss.close();
  await new Promise(resolve=>server.close(resolve));
}

main().catch(e=>{ console.error("SMOKE FAIL", e); process.exit(1); });
