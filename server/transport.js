"use strict";

const {WebSocketServer} = require("ws");
const {RoomManager} = require("./room-manager");
const {createSession,publicState,command,step} = require("../shared/game-engine");

function send(ws,type,payload={}){
  if(ws.readyState===ws.OPEN) ws.send(JSON.stringify({type,...payload}));
}

function broadcast(room,type,payloadFactory){
  for(const player of room.players.values()){
    if(player.ws && player.connected) send(player.ws,type,payloadFactory(player));
  }
}

function roomView(room,viewerId){
  return {
    roomCode:room.code,
    inviteToken:room.token,
    hostId:room.hostId,
    gameMode:room.gameMode||"coop",
    players:[...room.players.values()].map(p=>({id:p.id,name:p.name,ready:!!p.ready,connected:!!p.connected})),
    state:room.session ? publicState(room.session,viewerId) : null
  };
}

function attachTransport(server){
  const rooms = new RoomManager();
  const wss = new WebSocketServer({
    server,
    // 允许长连接（托管平台常常有代理空闲超时）
    perMessageDeflate: false,
    clientTracking: true,
  });
  let nextPlayer=0;

  // WebSocket 心跳：每 25s ping 一次，断开无响应的连接
  // Railway / Cloudflare 等代理默认空闲 60~120s 会切断连接
  const HEARTBEAT_MS = 25000;
  function heartbeat(){
    for(const room of rooms.roomsByCode.values()){
      for(const p of room.players.values()){
        if(p.ws && p.ws.readyState===p.ws.OPEN){
          try{ p.ws.ping(); }catch(_){}
        }
      }
    }
  }
  const hbTimer = setInterval(heartbeat, HEARTBEAT_MS);

  function makePlayer(ws,name){
    const id="p"+(++nextPlayer);
    return {id,name:(String(name||"").trim().slice(0,20)||("玩家"+nextPlayer)),ws,ready:false,connected:true};
  }

  function updateRoom(room){
    broadcast(room,"room",p=>roomView(room,p.id));
  }
  function ensureSession(room){
    if(!room.session){
      room.session=createSession([...room.players.keys()], Date.now()>>>0, room.gameMode||"coop");
      // keep host id aligned with room host
      room.session.hostId = room.hostId;
      // sync names
      for(const p of room.players.values()){
        const sp=room.session.players.find(x=>x.id===p.id);
        if(sp) sp.name=p.name;
      }
    }
    return room.session;
  }
  function sendState(room){
    if(!room.session) return;
    broadcast(room,"state",p=>({state:publicState(room.session,p.id)}));
  }
  function fail(ws,message){ send(ws,"error",{message:String(message.message||message)}); }

  wss.on("connection",ws=>{
    const player=makePlayer(ws);
    let room=null;
    send(ws,"hello",{playerId:player.id});

    ws.on("message",raw=>{
      let msg;
      try{ msg=JSON.parse(raw.toString()); }catch(e){ return fail(ws,"消息格式错误"); }
      try{
        if(msg.type==="create"){
          if(room) throw new Error("已经在房间里");
          player.name=String(msg.name||player.name).trim().slice(0,20)||player.name;
          room=rooms.create(player);
          // 设置游戏模式
          if(msg.mode==="independent") room.gameMode="independent";
          ensureSession(room);
          updateRoom(room); sendState(room); return;
        }
        if(msg.type==="join"){
          if(room) throw new Error("已经在房间里");
          player.name=String(msg.name||player.name).trim().slice(0,20)||player.name;
          room=rooms.find(msg.code||msg.token);
          if(!room) throw new Error("房间不存在");
          rooms.add(room,player);
          // recreate session when roster changes before start
          if(!room.session || !room.session.started){
            room.session=createSession([...room.players.keys()], Date.now()>>>0, room.gameMode||"coop");
            room.session.hostId=room.hostId;
            for(const p of room.players.values()){
              const sp=room.session.players.find(x=>x.id===p.id);
              if(sp){ sp.name=p.name; sp.ready=!!p.ready; }
            }
          }
          updateRoom(room); sendState(room); return;
        }
        if(!room) throw new Error("请先创建或加入房间");
        if(msg.type==="ready"){
          player.ready=!!msg.value;
          const state=ensureSession(room);
          const sp=state.players.find(p=>p.id===player.id);
          if(sp) sp.ready=player.ready;
          state.revision++;
          updateRoom(room); sendState(room); return;
        }
        if(msg.type==="start"){
          if(room.players.size<1) throw new Error("房间里没有玩家");
          if(room.hostId!==player.id) throw new Error("只有房主可以开始");
          const state=ensureSession(room);
          // sync ready flags
          for(const p of room.players.values()){
            const sp=state.players.find(x=>x.id===p.id);
            if(sp) sp.ready=!!p.ready;
          }
          command(state,player.id,{type:"start"});
          sendState(room); updateRoom(room); return;
        }
        if(msg.type==="startWave"){
          if(room.hostId!==player.id) throw new Error("只有房主可以开始进攻");
          const state=ensureSession(room);
          command(state,player.id,{type:"startWave"});
          sendState(room); return;
        }
        if(msg.type==="deploy"||msg.type==="move"||msg.type==="merge"){
          const state=ensureSession(room);
          command(state,player.id,msg);
          sendState(room); return;
        }
        if(msg.type==="rematch"){
          if(room.hostId!==player.id) throw new Error("只有房主可以重新开始");
          room.session=createSession([...room.players.keys()], Date.now()>>>0, room.gameMode||"coop");
          room.session.hostId=room.hostId;
          for(const p of room.players.values()){
            p.ready=false;
            const sp=room.session.players.find(x=>x.id===p.id);
            if(sp){ sp.name=p.name; sp.ready=false; }
          }
          updateRoom(room); sendState(room); return;
        }
        if(msg.type==="leave"){
          if(room){
            const r=room;
            rooms.remove(r,player.id);
            if(r.players.size>0){
              if(r.session && !r.session.started){
                r.session=createSession([...r.players.keys()], Date.now()>>>0, r.gameMode||"coop");
                r.session.hostId=r.hostId;
              }
              updateRoom(r);
            }
            room=null;
          }
          send(ws,"left",{});
          return;
        }
        throw new Error("未知消息");
      }catch(e){ fail(ws,e); }
    });

    ws.on("close",()=>{
      player.connected=false;
      if(room){
        const state=room.session;
        if(state){
          const p=state.players.find(x=>x.id===player.id);
          if(p) p.connected=false;
        }
        // keep seat for short grace; for v1 remove immediately if not started
        if(!room.session || !room.session.started){
          rooms.remove(room,player.id);
          if(room.players.size>0){
            if(room.session && !room.session.started){
              room.session=createSession([...room.players.keys()], Date.now()>>>0, room.gameMode||"coop");
              room.session.hostId=room.hostId;
            }
            updateRoom(room);
          }
        } else {
          updateRoom(room); sendState(room);
        }
        room=null;
      }
    });
  });

  const interval=setInterval(()=>{
    try{
      rooms.cleanup();
      for(const room of rooms.roomsByCode.values()){
        if(!room.session || !room.session.started || room.session.over) continue;
        step(room.session,0.05);
        sendState(room);
      }
    }catch(e){
      console.error("step loop error:", e.message);
    }
  },50);
  wss.on("close",()=>{
    clearInterval(interval);
    clearInterval(hbTimer);
  });
  return {wss,rooms};
}

module.exports={attachTransport};
