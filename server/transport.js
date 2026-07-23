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
    players:[...room.players.values()].map(p=>({id:p.id,name:p.name,ready:!!p.ready,connected:!!p.connected})),
    state:room.session ? publicState(room.session,viewerId) : null
  };
}

function attachTransport(server){
  const rooms = new RoomManager();
  const wss = new WebSocketServer({server});
  let nextPlayer=0;

  function makePlayer(ws,name){
    const id="p"+(++nextPlayer);
    return {id,name:(String(name||"").trim().slice(0,20)||("玩家"+nextPlayer)),ws,ready:false,connected:true};
  }

  function updateRoom(room){
    broadcast(room,"room",p=>roomView(room,p.id));
  }
  function ensureSession(room){
    if(!room.session){
      room.session=createSession([...room.players.keys()]);
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
            room.session=createSession([...room.players.keys()]);
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
          if(room.players.size!==3) throw new Error("需要三名玩家");
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
        if(msg.type==="deploy"||msg.type==="move"||msg.type==="merge"){
          const state=ensureSession(room);
          command(state,player.id,msg);
          sendState(room); return;
        }
        if(msg.type==="rematch"){
          if(room.hostId!==player.id) throw new Error("只有房主可以重新开始");
          room.session=createSession([...room.players.keys()]);
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
                r.session=createSession([...r.players.keys()]);
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
              room.session=createSession([...room.players.keys()]);
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
    rooms.cleanup();
    for(const room of rooms.roomsByCode.values()){
      if(!room.session || !room.session.started || room.session.over) continue;
      step(room.session,0.05);
      sendState(room);
    }
  },50);
  wss.on("close",()=>clearInterval(interval));
  return {wss,rooms};
}

module.exports={attachTransport};
