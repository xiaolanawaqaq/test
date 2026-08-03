"use strict";

const crypto = require("crypto");
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
    players:[...room.players.values()].map(p=>({id:p.id,name:p.name,ready:!!p.ready,connected:!!p.connected,abandoned:!!p.abandoned})),
    state:room.session ? publicState(room.session,viewerId) : null
  };
}

function attachTransport(server, dbReady){
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
    return {
      id,name:(String(name||"").trim().slice(0,20)||("玩家"+nextPlayer)),ws,
      resumeToken:crypto.randomBytes(32).toString("hex"),
      userId:null,
      ready:false,connected:true,disconnectedAt:null,abandoned:false
    };
  }

  function sendIdentity(ws,room,player,resumed){
    send(ws,"identity",{playerId:player.id,roomToken:room.token,resumeToken:player.resumeToken,resumed:!!resumed});
  }

  function validResumeToken(actual,supplied){
    const value=String(supplied||"");
    if(!actual || value.length!==actual.length) return false;
    return crypto.timingSafeEqual(Buffer.from(actual,"utf8"),Buffer.from(value,"utf8"));
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
  function fail(ws,message,code){ send(ws,"error",{message:String(message.message||message),...(code?{code}:{})}); }

  wss.on("connection",ws=>{
    let player=null;
    let room=null;
    send(ws,"hello",{ready:true});

    ws.on("message",raw=>{
      let msg;
      try{ msg=JSON.parse(raw.toString()); }catch(e){ return fail(ws,"消息格式错误"); }
      handleMessage(ws, msg).catch(e => fail(ws, e));
    });

    async function handleMessage(ws, msg){
      try{
        if(msg.type==="auth"){
          if(!dbReady) throw new Error("服务器数据库未就绪");
          try{
            const sessionRepo = require("./repositories/session-repo");
            const user = await sessionRepo.validate(String(msg.token||""));
            if(!user) throw new Error("无效凭证");
            if(!player) player = { id: "p"+(++nextPlayer), name: (user.display_name || "玩家"), ws, resumeToken: crypto.randomBytes(32).toString("hex"), userId: user.id, ready: false, connected: true, disconnectedAt: null, abandoned: false };
            else player.userId = user.id;
            send(ws,"auth_ok",{});
          }catch(e){ return fail(ws,"认证失败，请重新登录","auth_failed"); }
          return;
        }
        if(msg.type==="create"){
          if(room) throw new Error("已经在房间里");
          player=makePlayer(ws,msg.name);
          room=rooms.create(player);
          // 设置游戏模式
          if(msg.mode==="independent") room.gameMode="independent";
          ensureSession(room);
          sendIdentity(ws,room,player,false);
          updateRoom(room); sendState(room); return;
        }
        if(msg.type==="join"){
          if(room) throw new Error("已经在房间里");
          const target=rooms.find(msg.code||msg.token);
          if(!target) throw new Error("房间不存在");
          player=makePlayer(ws,msg.name);
          rooms.add(target,player);
          room=target;
          // recreate session when roster changes before start
          if(!room.session || !room.session.started){
            room.session=createSession([...room.players.keys()], Date.now()>>>0, room.gameMode||"coop");
            room.session.hostId=room.hostId;
            for(const p of room.players.values()){
              const sp=room.session.players.find(x=>x.id===p.id);
              if(sp){ sp.name=p.name; sp.ready=!!p.ready; }
            }
          }
          sendIdentity(ws,room,player,false);
          updateRoom(room); sendState(room); return;
        }
        if(msg.type==="resume"){
          if(room) return fail(ws,"恢复失败","resume_failed");
          const target=rooms.find(msg.roomToken);
          const seat=target && target.players.get(String(msg.playerId||""));
          rooms.abandonExpiredSeats(target);
          if(!target || !target.session || !target.session.started || !seat || seat.abandoned ||
             !validResumeToken(seat.resumeToken,msg.resumeToken)){
            return fail(ws,"恢复失败","resume_failed");
          }
          const oldWs=seat.ws;
          seat.ws=ws;
          seat.connected=true;
          seat.disconnectedAt=null;
          player=seat;
          room=target;
          const enginePlayer=room.session.players.find(p=>p.id===player.id);
          if(enginePlayer) enginePlayer.connected=true;
          room.touchedAt=Date.now();
          if(oldWs && oldWs!==ws){
            try{ oldWs.close(4001,"resumed elsewhere"); }catch(_){}
          }
          sendIdentity(ws,room,player,true);
          send(ws,"room",roomView(room,player.id));
          send(ws,"state",{state:publicState(room.session,player.id)});
          updateRoom(room);
          return;
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
            player.abandoned=true;
            player.resumeToken=null;
            const enginePlayer=r.session && r.session.players.find(p=>p.id===player.id);
            if(enginePlayer) enginePlayer.connected=false;
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
    }

    ws.on("close",()=>{
      // A resumed seat may already be bound to a replacement socket.
      if(!player || player.ws!==ws) return;
      player.connected=false;
      player.ws=null;
      if(room){
        const closingRoom=room;
        const state=closingRoom.session;
        if(state){
          const p=state.players.find(x=>x.id===player.id);
          if(p) p.connected=false;
        }
        // Before start a disconnect removes the seat; active games retain it briefly.
        if(!closingRoom.session || !closingRoom.session.started){
          rooms.remove(closingRoom,player.id);
          if(closingRoom.players.size>0){
            if(closingRoom.session && !closingRoom.session.started){
              closingRoom.session=createSession([...closingRoom.players.keys()], Date.now()>>>0, closingRoom.gameMode||"coop");
              closingRoom.session.hostId=closingRoom.hostId;
            }
            updateRoom(closingRoom);
          }
        } else {
          player.disconnectedAt=Date.now();
          closingRoom.touchedAt=Date.now();
          updateRoom(closingRoom); sendState(closingRoom);
        }
        room=null;
      }
    });
  });

  const interval=setInterval(()=>{
    try{
      const changedRooms=rooms.cleanup();
      for(const changedRoom of changedRooms){
        updateRoom(changedRoom);
        sendState(changedRoom);
      }
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
