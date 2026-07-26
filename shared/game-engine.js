"use strict";

const {
  TOTAL_LEVELS,WAVE_SIZE,START_CRYSTALS,PREP_SECONDS,START_TROOPS,
  TROOPS_PER_STAGE,MAX_LEVEL,SLOT_COUNT,PATH,PATH_LEN,TROOP_TYPES,SLOT_META,posOnPath
} = require("./game-types");

function createRng(seed){
  let value = seed >>> 0;
  return ()=>{
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function typeByKey(key){
  return TROOP_TYPES.find(t=>t.key===key) || TROOP_TYPES[0];
}

function baseStats(level){
  return {
    range: 90 + level*14,
    dmg:   6 + level*7,
    rate:  0.85 + level*0.07,
  };
}

function makeTroop(level, ownerId, nextId, rng, typeKey){
  const type = typeKey ? typeByKey(typeKey) : TROOP_TYPES[(rng()*TROOP_TYPES.length)|0];
  const b = baseStats(level);
  return {
    id: nextId(),
    ownerId,
    level,
    typeKey: type.key,
    name: type.name,
    icon: type.icon,
    tag: type.tag,
    desc: type.desc,
    style: type.style,
    mode: type.mode || "single",
    range: b.range * (type.rangeMul || 1),
    dmg:   b.dmg   * (type.dmgMul || 1),
    rate:  b.rate  * (type.rateMul || 1),
    splash: type.splash || 0,
    slow: type.slow || 0,
    burst: type.burst || 1,
    cone: type.cone || 0,
    chain: type.chain || 0,
    chainR: type.chainR || 0,
    pellets: type.pellets || 0,
    poison: type.poison || 0,
    cd: 0,
  };
}

function makeEnemy(level, nextId, rng){
  // 每关血量/防御/速度都涨；第 2 关起就要认真合成
  const hp = Math.round(32 * Math.pow(1.28, level-1) + (level>1 ? level*8 : 0));
  const def = Math.floor((level-1) * 2.2 + (level>=5 ? (level-4)*1.5 : 0));
  const speed = 40 + (level-1)*2.1 + (level>=10 ? (level-9)*0.6 : 0);
  const hue = (level*41 + rng()*40) % 360;
  const bodyR = 10 + Math.min(5, (level-1)*0.18);
  const p0 = PATH[0];
  return {
    id: nextId(),
    hpMax: hp, hp, def, speed, bodyR,
    dist: 0,
    x: p0.x, y: p0.y,
    slowMul: 1, slowTimer: 0,
    poisonTimer: 0, poisonDps: 0,
    color: `hsl(${hue},65%,58%)`,
    dead: false, reached: false,
  };
}

function createSession(playerIds, seed=Date.now()>>>0){
  const rng = createRng(seed);
  let idSeq = 0;
  const nextId = ()=> "e"+(++idSeq);
  const state = {
    revision: 0,
    tick: 0,
    seed,
    rng,
    nextId,
    started: false,
    over: false,
    result: null,
    level: 1,
    phase: "lobby",
    prepTimer: PREP_SECONDS,
    crystals: START_CRYSTALS,
    spawned: 0,
    killed: 0,
    spawnAcc: 0,
    enemies: [],
    bullets: [],
    beams: [],
    clouds: [],
    effects: [],
    slots: Array.from({length: SLOT_COUNT}, ()=>null),
    trays: Object.fromEntries(playerIds.map(id=>[id,[]])),
    hostId: playerIds[0] || null,
    players: playerIds.map((id,i)=>({id, name:"玩家"+(i+1), ready:false, connected:true})),
  };
  for(const playerId of playerIds){
    for(let i=0;i<START_TROOPS;i++){
      state.trays[playerId].push(makeTroop(1, playerId, nextId, rng));
    }
  }
  return state;
}

function serializeTroop(t){
  return {
    id:t.id, ownerId:t.ownerId, level:t.level, typeKey:t.typeKey,
    name:t.name, icon:t.icon, tag:t.tag, desc:t.desc,
    style:t.style, mode:t.mode, range:t.range, dmg:t.dmg, rate:t.rate,
  };
}

function publicState(state, viewerId){
  return {
    revision: state.revision,
    tick: state.tick,
    started: state.started,
    over: state.over,
    result: state.result,
    level: state.level,
    phase: state.phase,
    prepTimer: Math.max(0, Number(state.prepTimer.toFixed(2))),
    crystals: state.crystals,
    spawned: state.spawned,
    killed: state.killed,
    hostId: state.hostId,
    players: state.players.map(p=>({id:p.id, name:p.name, ready:!!p.ready, connected:!!p.connected})),
    slots: state.slots.map(t=>t?serializeTroop(t):null),
    tray: (state.trays[viewerId]||[]).map(serializeTroop),
    enemies: state.enemies.filter(e=>!e.dead).map(e=>({
      id:e.id, hp:Math.max(0,e.hp), hpMax:e.hpMax,
      x:e.x, y:e.y, color:e.color, bodyR:e.bodyR||12,
      slow:e.slowMul<1, poison:e.poisonTimer>0,
    })),
    bullets: state.bullets.map(b=>({
      id:b.id, x:b.x, y:b.y, sx:b.sx, sy:b.sy, tx:b.tx, ty:b.ty,
      color:b.color, size:b.size, style:b.style,
    })),
    beams: state.beams.map(b=>({
      id:b.id, x:b.x, y:b.y, tx:b.tx, ty:b.ty, color:b.color, life:b.life,
    })),
    clouds: state.clouds.map(c=>({id:c.id, x:c.x, y:c.y, r:c.r, life:c.life})),
    effects: state.effects.map(ef=>({
      id:ef.id, kind:ef.kind, x:ef.x, y:ef.y, r:ef.r,
      x1:ef.x1, y1:ef.y1, x2:ef.x2, y2:ef.y2,
      ang:ef.ang, half:ef.half, color:ef.color, life:ef.life, max:ef.max, width:ef.width,
    })),
  };
}

function player(state,id){ return state.players.find(p=>p.id===id); }
function allReady(state){
  // 至少 1 人，当前在线玩家全部准备即可开局（方便 1～3 人测试）
  const online = state.players.filter(p=>p.connected);
  return online.length>=1 && online.every(p=>p.ready);
}

function findOwnedTroop(state,ownerId,id){
  const trayTroop=(state.trays[ownerId]||[]).find(t=>t.id===id);
  if(trayTroop) return {troop:trayTroop, source:"tray"};
  const idx=state.slots.findIndex(t=>t&&t.id===id&&t.ownerId===ownerId);
  if(idx>=0) return {troop:state.slots[idx], source:"slot", slotIndex:idx};
  return null;
}
function removeFromTray(state,ownerId,id){
  state.trays[ownerId]=(state.trays[ownerId]||[]).filter(t=>t.id!==id);
}

function command(state, playerId, message){
  if(!message || typeof message.type!=="string") throw new Error("无效命令");
  if(message.type==="ready"){
    const p=player(state,playerId); if(!p) throw new Error("玩家不存在");
    p.ready=!!message.value; state.revision++; return {ok:true};
  }
  if(message.type==="start"){
    if(state.hostId!==playerId) throw new Error("只有房主可以开始");
    if(state.players.length<1) throw new Error("房间里没有玩家");
    if(!allReady(state)) throw new Error("需要所有在线玩家都准备");
    if(state.started) throw new Error("已经开始");
    state.started=true;
    state.phase="prep";
    state.prepTimer=PREP_SECONDS;
    state.revision++;
    return {ok:true,start:true};
  }
  if(message.type==="startWave"){
    // 备战阶段房主可跳过倒计时，立即进入进攻
    if(state.hostId!==playerId) throw new Error("只有房主可以开始进攻");
    if(!state.started || state.over) throw new Error("游戏未开始");
    if(state.phase!=="prep") throw new Error("当前不是备战阶段");
    state.phase="battle";
    state.prepTimer=0;
    state.spawned=0; state.killed=0; state.spawnAcc=0;
    state.enemies=[]; state.bullets=[]; state.beams=[]; state.clouds=[]; state.effects=[];
    state.revision++;
    return {ok:true,startWave:true};
  }
  if(message.type==="deploy" || message.type==="move" || message.type==="merge"){
    if(!state.started || state.over) throw new Error("游戏未开始");
    if(state.phase!=="prep" && state.phase!=="battle") throw new Error("当前不能部署");
    const found=findOwnedTroop(state,playerId,message.troopId);
    if(!found) throw new Error("这不是你的兵");
    const troop=found.troop;
    const target=Number(message.targetSlot);
    if(!Number.isInteger(target)||target<0||target>=SLOT_COUNT) throw new Error("槽位无效");
    // 战场上的兵不能自由挪位，只能同级合成；待命区可部署到空位
    if(found.source==="slot" && found.slotIndex===target){
      return {ok:true}; // 放回原位，无操作
    }
    const existing=state.slots[target];
    if(!existing){
      if(found.source!=="tray") throw new Error("战场上的兵不能移动，只能合成");
      state.slots[target]=troop;
      removeFromTray(state,playerId,troop.id);
    } else if(existing.ownerId===playerId && existing.level===troop.level && troop.level<MAX_LEVEL){
      if(found.source==="slot") state.slots[found.slotIndex]=null;
      state.slots[target]=makeTroop(troop.level+1, playerId, state.nextId, state.rng);
      if(found.source==="tray") removeFromTray(state,playerId,troop.id);
    } else {
      throw new Error("目标槽位不能放置");
    }
    state.revision++;
    return {ok:true};
  }
  throw new Error("未知命令");
}

function damageEnemy(state, e, dmg, mul){
  if(!e || e.dead) return;
  const real = Math.max(1, dmg*(mul||1) - e.def*0.5);
  e.hp -= real;
  if(e.hp<=0){ e.dead=true; state.killed++; }
}

function pushBullet(state, slot, tgt, opts){
  const tx = opts.tx!=null ? opts.tx : (tgt?tgt.x:slot.x);
  const ty = opts.ty!=null ? opts.ty : (tgt?tgt.y:slot.y);
  state.bullets.push({
    id: state.nextId(),
    sx:slot.x, sy:slot.y, x:slot.x, y:slot.y,
    tx, ty,
    targetId: tgt ? tgt.id : null,
    dmg:opts.dmg||1,
    splash:opts.splash||0,
    slow:opts.slow||0,
    poison:opts.poison||0,
    mode:opts.mode||"single",
    style:opts.style||"basic",
    color:opts.color||"#ffe58a",
    size:opts.size||3,
    homing:!!opts.homing,
    pierce:!!opts.pierce,
    life:opts.life||0.2,
    maxLife:opts.life||0.2,
    hit:false,
  });
}

function addEffect(state, ef){
  state.effects.push({id:state.nextId(), life:0.2, max:0.2, ...ef});
}

function findTarget(state, slot, tr){
  let best=null, bestProg=-1;
  for(const e of state.enemies){
    if(e.dead) continue;
    const d=Math.hypot(e.x-slot.x, e.y-slot.y);
    if(d<=tr.range){
      if(e.dist>bestProg){ bestProg=e.dist; best=e; }
    }
  }
  return best;
}

function fireByStyle(state, slot, tr, tgt){
  const st = tr.style;
  if(st==="rapid"){
    const n=tr.burst||3;
    for(let i=0;i<n;i++){
      const jx=(state.rng()-0.5)*12, jy=(state.rng()-0.5)*12;
      pushBullet(state, slot, tgt, {
        dmg:tr.dmg, life:0.12+i*0.03, color:"#ffe58a", size:2,
        tx:tgt.x+jx, ty:tgt.y+jy, style:"rapid"
      });
    }
  } else if(st==="heavy"){
    pushBullet(state, slot, tgt, {
      dmg:tr.dmg, life:0.22, color:"#fb923c", size:5, style:"heavy"
    });
  } else if(st==="splash"){
    pushBullet(state, slot, tgt, {
      dmg:tr.dmg, splash:tr.splash, life:0.28, color:"#f97316", size:4,
      style:"splash", mode:"aoe"
    });
  } else if(st==="sniper"){
    addEffect(state, {
      kind:"laser", x1:slot.x, y1:slot.y, x2:tgt.x, y2:tgt.y,
      color:"#f43f5e", life:0.15, max:0.15, width:2
    });
    damageEnemy(state, tgt, tr.dmg, 1);
  } else if(st==="cone"){
    const ang=Math.atan2(tgt.y-slot.y, tgt.x-slot.x);
    const half=(tr.cone||55)*Math.PI/180;
    addEffect(state, {
      kind:"cone", x:slot.x, y:slot.y, ang, half, r:tr.range*0.95,
      life:0.18, max:0.18, color:"#fb923c"
    });
    for(const e of state.enemies){
      if(e.dead) continue;
      const d=Math.hypot(e.x-slot.x, e.y-slot.y);
      if(d>tr.range*0.95 || d<8) continue;
      const a=Math.atan2(e.y-slot.y, e.x-slot.x);
      let da=a-ang; while(da>Math.PI) da-=Math.PI*2; while(da<-Math.PI) da+=Math.PI*2;
      if(Math.abs(da)<=half) damageEnemy(state, e, tr.dmg, 1);
    }
  } else if(st==="chain"){
    const hits=[];
    let cur=tgt;
    const maxHops=tr.chain||3;
    const hopR=tr.chainR||95;
    for(let h=0;h<maxHops && cur;h++){
      hits.push(cur);
      damageEnemy(state, cur, tr.dmg*(h===0?1:0.7), 1);
      let next=null, best=1e9;
      for(const e of state.enemies){
        if(e.dead || hits.includes(e)) continue;
        const d=Math.hypot(e.x-cur.x, e.y-cur.y);
        if(d<=hopR && d<best){ best=d; next=e; }
      }
      if(next){
        addEffect(state, {
          kind:"laser", x1:cur.x, y1:cur.y, x2:next.x, y2:next.y,
          color:"#a78bfa", life:0.18, max:0.18, width:2
        });
      }
      cur=next;
    }
    if(hits[0]){
      addEffect(state, {
        kind:"laser", x1:slot.x, y1:slot.y, x2:hits[0].x, y2:hits[0].y,
        color:"#c4b5fd", life:0.15, max:0.15, width:2
      });
    }
  } else if(st==="beam"){
    state.beams.push({
      id: state.nextId(),
      x:slot.x, y:slot.y, tx:tgt.x, ty:tgt.y,
      targetId:tgt.id, dps:tr.dmg*2.2, life:0.35, color:"#4fd1ff"
    });
  } else if(st==="freeze"){
    pushBullet(state, slot, tgt, {
      dmg:tr.dmg, slow:tr.slow||0.4, life:0.2, color:"#7dd3fc", size:4, style:"freeze"
    });
  } else if(st==="poison"){
    pushBullet(state, slot, tgt, {
      dmg:tr.dmg*0.4, splash:tr.splash, poison:tr.poison||3,
      life:0.3, color:"#84cc16", size:4, style:"poison", mode:"aoe"
    });
  } else if(st==="missile"){
    pushBullet(state, slot, tgt, {
      dmg:tr.dmg, splash:tr.splash, life:0.45, color:"#fbbf24", size:4,
      style:"missile", mode:"aoe", homing:true
    });
  } else if(st==="shotgun"){
    const n=tr.pellets||5;
    const base=Math.atan2(tgt.y-slot.y, tgt.x-slot.x);
    const spread=0.55;
    for(let i=0;i<n;i++){
      const a=base + (i-(n-1)/2)*(spread/(n-1||1));
      const dist=tr.range*0.85;
      pushBullet(state, slot, null, {
        dmg:tr.dmg, life:0.16, color:"#fde68a", size:2.5,
        tx:slot.x+Math.cos(a)*dist, ty:slot.y+Math.sin(a)*dist,
        style:"shotgun", pierce:true
      });
    }
  } else if(st==="pulse"){
    const r=tr.range*0.92;
    addEffect(state, {kind:"ring", x:slot.x, y:slot.y, r, life:0.28, max:0.28, color:"#60a5fa"});
    for(const e of state.enemies){
      if(e.dead) continue;
      if(Math.hypot(e.x-slot.x, e.y-slot.y)<=r) damageEnemy(state, e, tr.dmg, 1);
    }
  } else {
    pushBullet(state, slot, tgt, {dmg:tr.dmg, life:0.18, color:"#ffe58a", size:3});
  }
}

function applyHit(state, bl){
  const findEnemy = (id)=> state.enemies.find(e=>e.id===id && !e.dead);

  if(bl.pierce || bl.style==="shotgun"){
    let best=null, bestD=1e9;
    for(const e of state.enemies){
      if(e.dead) continue;
      const d=Math.hypot(e.x-bl.x, e.y-bl.y);
      if(d<22 && d<bestD){ bestD=d; best=e; }
    }
    if(best) damageEnemy(state, best, bl.dmg, 1);
    return;
  }

  if(bl.style==="poison"){
    const tgt = findEnemy(bl.targetId);
    const cx = tgt ? tgt.x : bl.tx;
    const cy = tgt ? tgt.y : bl.ty;
    const r = bl.splash || 70;
    state.clouds.push({id:state.nextId(), x:cx, y:cy, r, life:bl.poison||3, dps:bl.dmg*1.2});
    addEffect(state, {kind:"ring", x:cx, y:cy, r, life:0.3, max:0.3, color:"#84cc16"});
    for(const e of state.enemies){
      if(e.dead) continue;
      if(Math.hypot(e.x-cx, e.y-cy)<=r) damageEnemy(state, e, bl.dmg, 0.6);
    }
    return;
  }

  if(bl.mode==="aoe" && bl.splash>0){
    const tgt = findEnemy(bl.targetId);
    const cx = tgt ? tgt.x : bl.tx;
    const cy = tgt ? tgt.y : bl.ty;
    addEffect(state, {kind:"ring", x:cx, y:cy, r:bl.splash, life:0.25, max:0.25, color:"#fb923c"});
    for(const e of state.enemies){
      if(e.dead) continue;
      const d=Math.hypot(e.x-cx, e.y-cy);
      if(d<=bl.splash){
        const mul = (tgt && e.id===tgt.id) ? 1 : Math.max(0.45, 1 - d/bl.splash*0.55);
        damageEnemy(state, e, bl.dmg, mul);
        if(bl.slow>0){ e.slowMul=bl.slow; e.slowTimer=1.2; }
      }
    }
    return;
  }

  const tgt = findEnemy(bl.targetId);
  if(tgt){
    damageEnemy(state, tgt, bl.dmg, 1);
    if(bl.slow>0){ tgt.slowMul=bl.slow; tgt.slowTimer=1.4; }
  }
}

function loseCrystal(state){
  state.crystals--;
  if(state.crystals<=0){
    state.crystals=0;
    state.over=true;
    state.result="lose";
  }
}

function step(state, dt){
  if(!state.started || state.over) return;
  state.tick++;

  if(state.phase==="prep"){
    state.prepTimer -= dt;
    if(state.prepTimer<=0){
      state.phase="battle";
      state.spawned=0; state.killed=0; state.spawnAcc=0;
      state.enemies=[]; state.bullets=[]; state.beams=[]; state.clouds=[]; state.effects=[];
    }
    state.revision++;
    return;
  }

  // spawn from cave
  if(state.spawned < WAVE_SIZE){
    state.spawnAcc += dt;
    if(state.spawnAcc >= 0.75){
      state.spawnAcc = 0;
      state.enemies.push(makeEnemy(state.level, state.nextId, state.rng));
      state.spawned++;
    }
  }

  // enemy move on S path
  for(const e of state.enemies){
    if(e.dead) continue;
    if(e.slowTimer>0){ e.slowTimer-=dt; if(e.slowTimer<=0) e.slowMul=1; }
    if(e.poisonTimer>0){
      e.poisonTimer-=dt;
      e.hp -= e.poisonDps*dt;
      if(e.hp<=0){ e.dead=true; state.killed++; continue; }
      if(e.poisonTimer<=0) e.poisonDps=0;
    }
    e.dist += e.speed * e.slowMul * dt;
    const pos = posOnPath(e.dist);
    e.x=pos.x; e.y=pos.y;
    if(e.dist >= PATH_LEN){
      e.reached=true; e.dead=true; loseCrystal(state);
    }
  }

  // poison clouds
  for(const c of state.clouds){
    c.life -= dt;
    for(const e of state.enemies){
      if(e.dead) continue;
      if(Math.hypot(e.x-c.x, e.y-c.y)<=c.r){
        e.hp -= c.dps*dt;
        e.poisonTimer = Math.max(e.poisonTimer, 0.3);
        e.poisonDps = Math.max(e.poisonDps, c.dps*0.5);
        if(e.hp<=0){ e.dead=true; state.killed++; }
      }
    }
  }
  state.clouds = state.clouds.filter(c=>c.life>0);

  // beams
  for(const beam of state.beams){
    beam.life -= dt;
    const tgt = state.enemies.find(e=>e.id===beam.targetId && !e.dead);
    if(tgt){
      beam.tx=tgt.x; beam.ty=tgt.y;
      tgt.hp -= beam.dps*dt;
      if(tgt.hp<=0){ tgt.dead=true; state.killed++; }
    }
  }
  state.beams = state.beams.filter(b=>b.life>0);

  // troops fire
  for(let i=0;i<state.slots.length;i++){
    const tr = state.slots[i]; if(!tr) continue;
    const slot = SLOT_META[i];
    tr.cd -= dt;
    if(tr.cd<=0){
      const tgt = findTarget(state, slot, tr);
      if(tgt){
        tr.cd = 1/Math.max(0.12, tr.rate);
        fireByStyle(state, slot, tr, tgt);
      }
    }
  }

  // bullets
  for(const bl of state.bullets){
    bl.life -= dt;
    if(bl.homing && bl.targetId){
      const tgt = state.enemies.find(e=>e.id===bl.targetId && !e.dead);
      if(tgt){ bl.tx=tgt.x; bl.ty=tgt.y; }
    }
    const t = 1 - Math.max(0, bl.life/bl.maxLife);
    const ease = bl.homing ? Math.min(1, t*1.15) : Math.min(1, t*1.5);
    bl.x = bl.sx + (bl.tx-bl.sx)*ease;
    bl.y = bl.sy + (bl.ty-bl.sy)*ease;
    if(bl.life<=0 && !bl.hit){
      bl.hit=true;
      applyHit(state, bl);
    }
  }
  state.bullets = state.bullets.filter(b=>b.life>0);
  state.effects = state.effects.filter(ef=>{ ef.life-=dt; return ef.life>0; });
  state.enemies = state.enemies.filter(e=>!e.dead);

  if(state.spawned>=WAVE_SIZE && state.enemies.length===0){
    if(state.level >= TOTAL_LEVELS){
      state.over=true; state.result="win";
    } else {
      state.level++;
      state.phase="prep";
      state.prepTimer=PREP_SECONDS;
      state.spawned=0; state.killed=0; state.spawnAcc=0;
      state.bullets=[]; state.beams=[]; state.clouds=[]; state.effects=[];
      for(const id of Object.keys(state.trays)){
        for(let i=0;i<TROOPS_PER_STAGE;i++){
          state.trays[id].push(makeTroop(1, id, state.nextId, state.rng));
        }
      }
    }
  }
  state.revision++;
}

module.exports = {createSession, publicState, command, step, allReady};
