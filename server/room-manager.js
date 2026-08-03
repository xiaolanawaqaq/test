"use strict";

const MAX_PLAYERS = 3;
const ROOM_CODE_LENGTH = 6;
const ROOM_TTL_MS = 30 * 60 * 1000;
const ACTIVE_SEAT_TTL_MS = 120 * 1000;

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
    gameMode: "coop", // "coop" | "independent"
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
    if(room.hostId === playerId) this.transferHost(room);
    if(room.players.size === 0) this.delete(room);
  }

  transferHost(room){
    const next = [...room.players.values()].find(player=>player.connected && !player.abandoned);
    room.hostId = next ? next.id : null;
    if(room.session) room.session.hostId = room.hostId;
  }

  abandonExpiredSeats(room, now=Date.now()){
    if(!room || !room.session || !room.session.started) return false;
    let changed = false;
    for(const player of room.players.values()){
      if(!player.connected && !player.abandoned && player.disconnectedAt && now-player.disconnectedAt >= ACTIVE_SEAT_TTL_MS){
        player.abandoned = true;
        player.resumeToken = null;
        changed = true;
      }
    }
    if(!room.players.get(room.hostId) || room.players.get(room.hostId).abandoned){
      const oldHost = room.hostId;
      this.transferHost(room);
      changed = changed || oldHost !== room.hostId;
    }
    return changed;
  }

  delete(room){
    this.roomsByCode.delete(room.code);
    this.roomsByToken.delete(room.token);
  }

  cleanup(){
    const now = Date.now();
    const changed = [];
    for(const room of this.roomsByCode.values()){
      if(this.abandonExpiredSeats(room,now)) changed.push(room);
      if(room.players.size === 0 && now-room.touchedAt > ROOM_TTL_MS) this.delete(room);
    }
    return changed;
  }
}

module.exports = {RoomManager, MAX_PLAYERS};
