"use strict";

const MAX_PLAYERS = 3;
const ROOM_CODE_LENGTH = 6;
const ROOM_TTL_MS = 30 * 60 * 1000;

function randomCode(){
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for(let i=0;i<ROOM_CODE_LENGTH;i++) code += chars[(Math.random()*chars.length)|0];
  return code;
}

function createRoom(){
  const room = {
    code: randomCode(),
    token: cryptoRandomToken(),
    players: new Map(),
    hostId: null,
    session: null,
    createdAt: Date.now(),
    touchedAt: Date.now(),
  };
  return room;
}

function cryptoRandomToken(){
  return Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);
}

class RoomManager {
  constructor(){
    this.roomsByCode = new Map();
    this.roomsByToken = new Map();
  }

  create(player){
    let room;
    do room = createRoom(); while(this.roomsByCode.has(room.code));
    room.hostId = player.id;
    room.players.set(player.id, player);
    this.roomsByCode.set(room.code, room);
    this.roomsByToken.set(room.token, room);
    return room;
  }

  find(identifier){
    const value = String(identifier || "").trim().toUpperCase();
    return this.roomsByCode.get(value) || this.roomsByToken.get(identifier) || null;
  }

  add(room, player){
    if(!room) throw new Error("房间不存在");
    if(room.players.size >= MAX_PLAYERS) throw new Error("房间已满");
    if(room.session && room.session.started) throw new Error("游戏已经开始");
    room.players.set(player.id, player);
    room.touchedAt = Date.now();
    return room;
  }

  remove(room, playerId){
    if(!room) return;
    room.players.delete(playerId);
    room.touchedAt = Date.now();
    if(room.hostId === playerId){
      const next = room.players.keys().next();
      room.hostId = next.done ? null : next.value;
    }
    if(room.players.size === 0) this.delete(room);
  }

  delete(room){
    this.roomsByCode.delete(room.code);
    this.roomsByToken.delete(room.token);
  }

  cleanup(){
    const now = Date.now();
    for(const room of this.roomsByCode.values()){
      if(room.players.size === 0 && now-room.touchedAt > ROOM_TTL_MS) this.delete(room);
    }
  }
}

module.exports = {RoomManager, MAX_PLAYERS};
