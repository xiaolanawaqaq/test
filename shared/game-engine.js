"use strict";

const {
  TOTAL_LEVELS,WAVE_SIZE,START_CRYSTALS,PREP_SECONDS,START_TROOPS,
  TROOPS_PER_STAGE,MAX_LEVEL,SLOT_COUNT,PATH,PATH_LEN,TROOP_TYPES,SLOT_META,posOnPath,pathLength,
  INDEPENDENT_PATHS,INDEPENDENT_SLOT_META,INDEPENDENT_SLOT_COUNT,
  getIndependentPath,getIndependentSlots,getIndependentPathLen
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

const BUG_KINDS = ["mite","beetle","spider","flyer"];
const BUG_PAL = {
  mite:   {body:"#7a3f6a", shell:"#5a2850", eye:"#c4f042"},
  beetle: {body:"#a86a3a", shell:"#6e4020", eye:"#ffd36b"},
  spider: {body:"#c9a227", shell:"#8b1e1e", eye:"#4fd1ff"},
  flyer:  {body:"#6b4ea3", shell:"#3d2a6e", eye:"#7ee787"},
};

function makeEnemy(level, nextId, rng, spawnPath){
  const hp = Math.round(50 * Math.pow(1.52, level-1) + level*level*16);
  const def = Math.floor((level-1)*3.2 + (level>=3 ? (level-2)*2.4 : 0));
  const speed = 44 + (level-1)*3.0 + (level>=6 ? (level-5)*1.8 : 0);
  const kind = BUG_KINDS[(rng()*BUG_KINDS.length)|0];
  const pal = BUG_PAL[kind];
  const bodyR = 9 + Math.min(5, (level-1)*0.2) + (kind==="spider"?1:0);
  const p0 = spawnPath ? spawnPath[0] : PATH[0];
  return {
    id: nextId(),
    hpMax: hp, hp, def, speed, bodyR, kind,
    dist: 0,
    x: p0.x, y: p0.y,
    slowMul: 1, slowTimer: 0,
    poisonTimer: 0, poisonDps: 0,
    walk: rng()*Math.PI*2,
    color: pal.body, shell: pal.shell, eye: pal.eye,
    dead: false, reached: false,
  };
}

function waveSizeFor(level){
  return WAVE_SIZE + Math.floor((level-1)/2) + (level>=6 ? level-5 : 0);
}
function spawnIntervalFor(level){
  return Math.max(0.62, 1.05 - (level-1)*0.032);
}

// ============ 创建会话 ============
function createSession(playerIds, seed=Date.now()>>>0, mode="coop"){
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
    mode, // "coop" | "independent"
    prepTimer: PREP_SECONDS,
    hostId: playerIds[0] || null,
    players: playerIds.map((id,i)=>({
      id, name:"玩家"+(i+1), ready:false, connected:true,
      pathIndex: mode==="independent" ? i : -1, // 独立模式下每人一条路
    })),
  };

  if(mode === "independent"){
    // 独立路径模式：每人一条路，独立状态
    state.paths = playerIds.map((id, i)=>{
      const path = getIndependentPath(i);
      const slots = getIndependentSlots(i);
      const pLen = pathLength(path);
      return {
        pathIndex: i,
        ownerId: id,
        path,
        slots: Array.from({length: INDEPENDENT_SLOT_COUNT}, ()=>null),
        pathLen: pLen,
        crystals: START_CRYSTALS,
        enemies: [], bullets: [], beams: [], clouds: [], effects: [],
        spawned: 0, killed: 0, spawnAcc: 0,
      };
    });
    state.trays = Object.fromEntries(playerIds.map(id=>[id,[]]));
    for(const playerId of playerIds){
      for(let i=0;i<START_TROOPS;i++){
        state.trays[playerId].push(makeTroop(1, playerId, nextId, rng));
      }
    }
  } else {
    // 合作模式：共享路径
    state.crystals = START_CRYSTALS;
    state.spawned = 0; state.killed = 0; state.spawnAcc = 0;
    state.enemies = []; state.bullets = []; state.beams = [];
    state.clouds = []; state.effects = [];
    state.slots = Array.from({length: SLOT_COUNT}, ()=>null);
    state.trays = Object.fromEntries(playerIds.map(id=>[id,[]]));
    for(const playerId of playerIds){
      for(let i=0;i<START_TROOPS;i++){
        state.trays[playerId].push(makeTroop(1, playerId, nextId, rng));
      }
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

function player(state,id){ return state.players.find(p=>p.id===id); }
function allReady(state){
  const online = state.players.filter(p=>p.connected);
  return online.length>=1 && online.every(p=>p.ready);
}

// 获取玩家所属的路径索引
function getPlayerPathIndex(state, playerId){
  const p = player(state, playerId);
  if(p) return p.pathIndex;
  return -1;
}

// 获取玩家的路径状态（独立模式）
function getPlayerPathState(state, playerId){
  const idx = getPlayerPathIndex(state, playerId);
  if(idx >= 0 && state.paths && state.paths[idx]) return state.paths[idx];
  return null;
}

function findOwnedTroop(state,ownerId,id){
  const trayTroop=(state.trays[ownerId]||[]).find(t=>t.id===id);
  if(trayTroop) return {troop:trayTroop, source:"tray"};

  if(state.mode === "independent"){
    // 独立模式：在自己的路径槽位中查找
    const ps = getPlayerPathState(state, ownerId);
    if(ps){
      const idx=ps.slots.findIndex(t=>t&&t.id===id&&t.ownerId===ownerId);
      if(idx>=0) return {troop:ps.slots[idx], source:"slot", slotIndex:idx, pathIndex:ps.pathIndex};
    }
  } else {
    // 合作模式：在共享槽位中查找
    const idx=state.slots.findIndex(t=>t&&t.id===id&&t.ownerId===ownerId);
    if(idx>=0) return {troop:state.slots[idx], source:"slot", slotIndex:idx};
  }
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
    if(state.hostId!==playerId) throw new Error("只有房主可以开始进攻");
    if(!state.started || state.over) throw new Error("游戏未开始");
    if(state.phase!=="prep") throw new Error("当前不是备战阶段");
    state.phase="battle";
    state.prepTimer=0;
    if(state.mode==="independent"){
      for(const ps of state.paths){
        ps.spawned=0; ps.killed=0; ps.spawnAcc=0;
        ps.enemies=[]; ps.bullets=[]; ps.beams=[]; ps.clouds=[]; ps.effects=[];
      }
    } else {
      state.spawned=0; state.killed=0; state.spawnAcc=0;
      state.enemies=[]; state.bullets=[]; state.beams=[]; state.clouds=[]; state.effects=[];
    }
    state.revision++;
    return {ok:true,startWave:true};
  }

  if(message.type==="deploy" || message.type==="move" || message.type==="merge"){
    if(!state.started || state.over) throw new Error("游戏未开始");
    if(state.phase!=="prep" && state.phase!=="battle") throw new Error("当前不能部署");
    const found=findOwnedTroop(state,playerId,message.troopId);
    if(!found) throw new Error("这不是你的兵");
    const troop=found.troop;
    const target=message.targetSlot;

    if(state.mode === "independent"){
      // 独立模式：槽位范围是0~15
      if(!Number.isInteger(target)||target<0||target>=INDEPENDENT_SLOT_COUNT) throw new Error("槽位无效");
      const ps = getPlayerPathState(state, playerId);
      if(!ps) throw new Error("路径不存在");
      if(found.source==="slot" && found.slotIndex===target) return {ok:true};
      const existing=ps.slots[target];
      if(!existing){
        if(found.source!=="tray") throw new Error("战场上的兵不能移动，只能合成");
        ps.slots[target]=troop;
        removeFromTray(state,playerId,troop.id);
      } else if(existing.ownerId===playerId && existing.level===troop.level && troop.level<MAX_LEVEL){
        if(found.source==="slot") ps.slots[found.slotIndex]=null;
        ps.slots[target]=makeTroop(troop.level+1, playerId, state.nextId, state.rng);
        if(found.source==="tray") removeFromTray(state,playerId,troop.id);
      } else {
        throw new Error("目标槽位不能放置");
      }
    } else {
      // 合作模式
      if(!Number.isInteger(target)||target<0||target>=SLOT_COUNT) throw new Error("槽位无效");
      if(found.source==="slot" && found.slotIndex===target) return {ok:true};
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
    }
    state.revision++;
    return {ok:true};
  }
  throw new Error("未知命令");
}

// ============ 战斗逻辑（路径级） ============
function damageEnemy(ps, e, dmg, mul){
  if(!e || e.dead) return;
  const factor = 1 / (1 + Math.max(0, e.def) * 0.085);
  const real = Math.max(0.35, (dmg||0) * (mul||1) * factor);
  e.hp -= real;
  if(e.hp<=0){ e.dead=true; ps.killed++; }
}

function pushBullet(ps, slot, tgt, opts){
  const tx = opts.tx!=null ? opts.tx : (tgt?tgt.x:slot.x);
  const ty = opts.ty!=null ? opts.ty : (tgt?tgt.y:slot.y);
  ps.bullets.push({
    id: ps._nextId(),
    sx:slot.x, sy:slot.y, x:slot.x, y:slot.y,
    tx, ty,
    targetId: tgt ? tgt.id : null,
    dmg:opts.dmg||1, splash:opts.splash||0, slow:opts.slow||0,
    poison:opts.poison||0, mode:opts.mode||"single",
    style:opts.style||"basic", color:opts.color||"#ffe58a",
    size:opts.size||3, homing:!!opts.homing, pierce:!!opts.pierce,
    life:opts.life||0.2, maxLife:opts.life||0.2, hit:false,
  });
}

function addEffect(ps, ef){
  ps.effects.push({id:ps._nextId(), life:0.2, max:0.2, ...ef});
}

function findTarget(ps, slot, tr){
  let best=null, bestProg=-1;
  for(const e of ps.enemies){
    if(e.dead) continue;
    const d=Math.hypot(e.x-slot.x, e.y-slot.y);
    if(d<=tr.range){
      if(e.dist>bestProg){ bestProg=e.dist; best=e; }
    }
  }
  return best;
}

function fireByStyle(ps, slot, tr, tgt){
  const st = tr.style;
  if(st==="rapid"){
    const n=tr.burst||3;
    for(let i=0;i<n;i++){
      const jx=(ps._rng()-0.5)*12, jy=(ps._rng()-0.5)*12;
      pushBullet(ps, slot, tgt, {
        dmg:tr.dmg, life:0.12+i*0.03, color:"#ffe58a", size:2,
        tx:tgt.x+jx, ty:tgt.y+jy, style:"rapid"
      });
    }
  } else if(st==="heavy"){
    pushBullet(ps, slot, tgt, {dmg:tr.dmg, life:0.22, color:"#fb923c", size:5, style:"heavy"});
  } else if(st==="splash"){
    pushBullet(ps, slot, tgt, {dmg:tr.dmg, splash:tr.splash, life:0.28, color:"#f97316", size:4, style:"splash", mode:"aoe"});
  } else if(st==="sniper"){
    addEffect(ps, {kind:"laser", x1:slot.x, y1:slot.y, x2:tgt.x, y2:tgt.y, color:"#f43f5e", life:0.15, max:0.15, width:2});
    damageEnemy(ps, tgt, tr.dmg, 1);
  } else if(st==="cone"){
    const ang=Math.atan2(tgt.y-slot.y, tgt.x-slot.x);
    const half=(tr.cone||55)*Math.PI/180;
    addEffect(ps, {kind:"cone", x:slot.x, y:slot.y, ang, half, r:tr.range*0.95, life:0.18, max:0.18, color:"#fb923c"});
    for(const e of ps.enemies){
      if(e.dead) continue;
      const d=Math.hypot(e.x-slot.x, e.y-slot.y);
      if(d>tr.range*0.95 || d<8) continue;
      const a=Math.atan2(e.y-slot.y, e.x-slot.x);
      let da=a-ang; while(da>Math.PI) da-=Math.PI*2; while(da<-Math.PI) da+=Math.PI*2;
      if(Math.abs(da)<=half) damageEnemy(ps, e, tr.dmg, 1);
    }
  } else if(st==="chain"){
    const hits=[]; let cur=tgt;
    const maxHops=tr.chain||3, hopR=tr.chainR||95;
    for(let h=0;h<maxHops && cur;h++){
      hits.push(cur); damageEnemy(ps, cur, tr.dmg*(h===0?1:0.7), 1);
      let next=null, best=1e9;
      for(const e of ps.enemies){
        if(e.dead || hits.includes(e)) continue;
        const d=Math.hypot(e.x-cur.x, e.y-cur.y);
        if(d<=hopR && d<best){ best=d; next=e; }
      }
      if(next) addEffect(ps, {kind:"laser", x1:cur.x, y1:cur.y, x2:next.x, y2:next.y, color:"#a78bfa", life:0.18, max:0.18, width:2});
      cur=next;
    }
    if(hits[0]) addEffect(ps, {kind:"laser", x1:slot.x, y1:slot.y, x2:hits[0].x, y2:hits[0].y, color:"#c4b5fd", life:0.15, max:0.15, width:2});
  } else if(st==="beam"){
    ps.beams.push({id:ps._nextId(), x:slot.x, y:slot.y, tx:tgt.x, ty:tgt.y, targetId:tgt.id, dps:tr.dmg*2.2, life:0.35, color:"#4fd1ff"});
  } else if(st==="freeze"){
    pushBullet(ps, slot, tgt, {dmg:tr.dmg, slow:tr.slow||0.4, life:0.2, color:"#7dd3fc", size:4, style:"freeze"});
  } else if(st==="poison"){
    pushBullet(ps, slot, tgt, {dmg:tr.dmg*0.4, splash:tr.splash, poison:tr.poison||3, life:0.3, color:"#84cc16", size:4, style:"poison", mode:"aoe"});
  } else if(st==="missile"){
    pushBullet(ps, slot, tgt, {dmg:tr.dmg, splash:tr.splash, life:0.45, color:"#fbbf24", size:4, style:"missile", mode:"aoe", homing:true});
  } else if(st==="shotgun"){
    const n=tr.pellets||5;
    const base=Math.atan2(tgt.y-slot.y, tgt.x-slot.x);
    const spread=0.55;
    for(let i=0;i<n;i++){
      const a=base + (i-(n-1)/2)*(spread/(n-1||1));
      const dist=tr.range*0.85;
      pushBullet(ps, slot, null, {dmg:tr.dmg, life:0.16, color:"#fde68a", size:2.5, tx:slot.x+Math.cos(a)*dist, ty:slot.y+Math.sin(a)*dist, style:"shotgun"});
    }
  } else if(st==="pulse"){
    const r=tr.range*0.92;
    addEffect(ps, {kind:"ring", x:slot.x, y:slot.y, r, life:0.28, max:0.28, color:"#60a5fa"});
    for(const e of ps.enemies){
      if(e.dead) continue;
      if(Math.hypot(e.x-slot.x, e.y-slot.y)<=r) damageEnemy(ps, e, tr.dmg, 1);
    }
  } else {
    pushBullet(ps, slot, tgt, {dmg:tr.dmg, life:0.18, color:"#ffe58a", size:3});
  }
}

function applyHit(ps, bl){
  const findEnemy = (id)=> ps.enemies.find(e=>e.id===id && !e.dead);

  if(bl.pierce){
    let best=null, bestD=1e9;
    for(const e of ps.enemies){
      if(e.dead) continue;
      const d=Math.hypot(e.x-bl.x, e.y-bl.y);
      if(d<22 && d<bestD){ bestD=d; best=e; }
    }
    if(best) damageEnemy(ps, best, bl.dmg, 1);
    return;
  }
  if(bl.style==="poison"){
    const tgt = findEnemy(bl.targetId);
    const cx = tgt ? tgt.x : bl.tx, cy = tgt ? tgt.y : bl.ty;
    const r = bl.splash || 70;
    ps.clouds.push({id:ps._nextId(), x:cx, y:cy, r, life:bl.poison||3, dps:bl.dmg*1.2});
    addEffect(ps, {kind:"ring", x:cx, y:cy, r, life:0.3, max:0.3, color:"#84cc16"});
    for(const e of ps.enemies){ if(!e.dead && Math.hypot(e.x-cx,e.y-cy)<=r) damageEnemy(ps, e, bl.dmg, 0.6); }
    return;
  }
  if(bl.mode==="aoe" && bl.splash>0){
    const tgt = findEnemy(bl.targetId);
    const cx = tgt ? tgt.x : bl.tx, cy = tgt ? tgt.y : bl.ty;
    addEffect(ps, {kind:"ring", x:cx, y:cy, r:bl.splash, life:0.25, max:0.25, color:"#fb923c"});
    for(const e of ps.enemies){
      if(e.dead) continue;
      const d=Math.hypot(e.x-cx, e.y-cy);
      if(d<=bl.splash){
        const mul = (tgt && e.id===tgt.id) ? 1 : Math.max(0.45, 1-d/bl.splash*0.55);
        damageEnemy(ps, e, bl.dmg, mul);
        if(bl.slow>0){ e.slowMul=bl.slow; e.slowTimer=1.2; }
      }
    }
    return;
  }
  const tgt = findEnemy(bl.targetId);
  if(tgt){
    damageEnemy(ps, tgt, bl.dmg, 1);
    if(bl.slow>0){ tgt.slowMul=bl.slow; tgt.slowTimer=1.4; }
  }
}

function segmentHit(a,b,p,r){
  const dx=b.x-a.x, dy=b.y-a.y;
  const lenSq=dx*dx+dy*dy;
  const t=lenSq?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/lenSq)):0;
  return {hit:Math.hypot(p.x-(a.x+dx*t),p.y-(a.y+dy*t))<=r,t};
}

function hitShotgun(ps,bl,from){
  let first=null, firstT=Infinity;
  for(const enemy of ps.enemies){
    if(enemy.dead) continue;
    const result=segmentHit(from,bl,enemy,(enemy.bodyR||12)+(bl.size||2));
    if(result.hit && result.t<firstT){ first=enemy; firstT=result.t; }
  }
  if(!first) return false;
  damageEnemy(ps,first,bl.dmg,1);
  bl.hit=true;
  bl.life=0;
  return true;
}

// ============ 单路径步进（合作模式 & 独立模式复用） ============
function stepPath(ps, dt, state){
  // ps = 路径状态对象，state = 全局状态（用于 rng, nextId 等）
  // spawn
  const need = waveSizeFor(state.level);
  if(ps.spawned < need){
    ps.spawnAcc += dt;
    if(ps.spawnAcc >= spawnIntervalFor(state.level)){
      ps.spawnAcc = 0;
      ps.enemies.push(makeEnemy(state.level, state.nextId, state.rng, ps.path));
      ps.spawned++;
    }
  }

  // enemy move
  const pLen = ps.pathLen || PATH_LEN;
  for(const e of ps.enemies){
    if(e.dead) continue;
    if(e.slowTimer>0){ e.slowTimer-=dt; if(e.slowTimer<=0) e.slowMul=1; }
    if(e.poisonTimer>0){
      e.poisonTimer-=dt;
      e.hp -= e.poisonDps*dt;
      if(e.hp<=0){ e.dead=true; ps.killed++; continue; }
      if(e.poisonTimer<=0) e.poisonDps=0;
    }
    e.dist += e.speed * e.slowMul * dt;
    e.walk = (e.walk||0) + dt * 10 * e.slowMul;
    const pos = posOnPath(e.dist, ps.path);
    e.x=pos.x; e.y=pos.y;
    if(e.dist >= pLen){
      e.reached=true; e.dead=true;
      ps.crystals--;
      if(ps.crystals<=0){ ps.crystals=0; ps._lost=true; }
    }
  }

  // poison clouds
  for(const c of ps.clouds){
    c.life -= dt;
    for(const e of ps.enemies){
      if(e.dead) continue;
      if(Math.hypot(e.x-c.x, e.y-c.y)<=c.r){
        e.hp -= c.dps*dt;
        e.poisonTimer = Math.max(e.poisonTimer, 0.3);
        e.poisonDps = Math.max(e.poisonDps, c.dps*0.5);
        if(e.hp<=0){ e.dead=true; ps.killed++; }
      }
    }
  }
  ps.clouds = ps.clouds.filter(c=>c.life>0);

  // beams
  for(const beam of ps.beams){
    beam.life -= dt;
    const tgt = ps.enemies.find(e=>e.id===beam.targetId && !e.dead);
    if(tgt){ beam.tx=tgt.x; beam.ty=tgt.y; tgt.hp -= beam.dps*dt; if(tgt.hp<=0){ tgt.dead=true; ps.killed++; } }
  }
  ps.beams = ps.beams.filter(b=>b.life>0);

  // troops fire
  const slots = ps.slots;
  for(let i=0;i<slots.length;i++){
    const tr = slots[i]; if(!tr) continue;
    const slotMeta = (ps._slotMeta || SLOT_META)[i];
    tr.cd -= dt;
    if(tr.cd<=0){
      const tgt = findTarget(ps, slotMeta, tr);
      if(tgt){ tr.cd = 1/Math.max(0.12, tr.rate); fireByStyle(ps, slotMeta, tr, tgt); }
    }
  }

  // bullets
  for(const bl of ps.bullets){
    bl.life -= dt;
    const previous={x:bl.x,y:bl.y};
    if(bl.homing && bl.targetId){
      const tgt = ps.enemies.find(e=>e.id===bl.targetId && !e.dead);
      if(tgt){ bl.tx=tgt.x; bl.ty=tgt.y; }
    }
    const t = 1 - Math.max(0, bl.life/bl.maxLife);
    const ease = bl.homing ? Math.min(1, t*1.15) : Math.min(1, t*1.5);
    bl.x = bl.sx + (bl.tx-bl.sx)*ease;
    bl.y = bl.sy + (bl.ty-bl.sy)*ease;
    if(bl.style==="shotgun" && !bl.hit) hitShotgun(ps,bl,previous);
    if(bl.life<=0 && !bl.hit){ bl.hit=true; applyHit(ps, bl); }
  }
  ps.bullets = ps.bullets.filter(b=>b.life>0);
  ps.effects = ps.effects.filter(ef=>{ ef.life-=dt; return ef.life>0; });
  ps.enemies = ps.enemies.filter(e=>!e.dead);

  // 硬上限
  if(ps.bullets.length>220) ps.bullets=ps.bullets.slice(-120);
  if(ps.effects.length>160) ps.effects=ps.effects.slice(-80);
  if(ps.clouds.length>40) ps.clouds=ps.clouds.slice(-20);
  if(ps.beams.length>40) ps.beams=ps.beams.slice(-20);
}

// ============ 主步进函数 ============
function step(state, dt){
  if(!state.started || state.over) return;
  state.tick++;

  if(state.phase==="prep"){
    state.prepTimer -= dt;
    if(state.prepTimer<=0){
      state.phase="battle";
      if(state.mode==="independent"){
        for(const ps of state.paths){
          ps.spawned=0; ps.killed=0; ps.spawnAcc=0;
          ps.enemies=[]; ps.bullets=[]; ps.beams=[]; ps.clouds=[]; ps.effects=[];
        }
      } else {
        state.spawned=0; state.killed=0; state.spawnAcc=0;
        state.enemies=[]; state.bullets=[]; state.beams=[]; state.clouds=[]; state.effects=[];
      }
    }
    state.revision++;
    return;
  }

  if(state.mode === "independent"){
    // 独立路径模式：每条路径独立步进
    let anyAlive = false;
    for(const ps of state.paths){
      ps._nextId = state.nextId;
      ps._rng = state.rng;
      ps._slotMeta = INDEPENDENT_SLOT_META[ps.pathIndex] || INDEPENDENT_SLOT_META[0];
      ps._lost = false;
      stepPath(ps, dt, state);
      if(ps.crystals > 0) anyAlive = true;
    }
    // 竞技模式：所有路径水晶归零 = 游戏结束
    // 合作模式：所有路径水晶归零 = 游戏结束
    if(!anyAlive){
      state.over = true;
      state.result = "lose";
    }
    // 波次结束检查：所有路径都清完怪
    const need = waveSizeFor(state.level);
    const allCleared = state.paths.every(ps => ps.spawned >= need && ps.enemies.length === 0);
    if(!state.over && allCleared){
      if(state.level >= TOTAL_LEVELS){
        state.over = true; state.result = "win";
      } else {
        state.level++;
        state.phase = "prep";
        state.prepTimer = PREP_SECONDS;
        for(const ps of state.paths){
          ps.spawned=0; ps.killed=0; ps.spawnAcc=0;
          ps.bullets=[]; ps.beams=[]; ps.clouds=[]; ps.effects=[];
        }
        for(const id of Object.keys(state.trays)){
          for(let i=0;i<TROOPS_PER_STAGE;i++){
            state.trays[id].push(makeTroop(1, id, state.nextId, state.rng));
          }
        }
      }
    }
  } else {
    // 合作模式：原有逻辑
    const ps = {
      enemies: state.enemies, bullets: state.bullets, beams: state.beams,
      clouds: state.clouds, effects: state.effects,
      slots: state.slots,
      spawned: state.spawned, killed: state.killed, spawnAcc: state.spawnAcc,
      crystals: state.crystals, path: PATH, pathLen: PATH_LEN,
      _nextId: state.nextId, _rng: state.rng, _slotMeta: SLOT_META,
    };
    stepPath(ps, dt, state);
    // 回写
    state.enemies=ps.enemies; state.bullets=ps.bullets; state.beams=ps.beams;
    state.clouds=ps.clouds; state.effects=ps.effects;
    state.spawned=ps.spawned; state.killed=ps.killed; state.spawnAcc=ps.spawnAcc;
    state.crystals=ps.crystals;
    if(ps._lost){ state.over=true; state.result="lose"; }

    const need = waveSizeFor(state.level);
    if(!state.over && state.spawned>=need && state.enemies.length===0){
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
  }
  state.revision++;
}

// ============ 公开状态 ============
function publicState(state, viewerId){
  const base = {
    revision: state.revision,
    tick: state.tick,
    started: state.started,
    over: state.over,
    result: state.result,
    level: state.level,
    phase: state.phase,
    mode: state.mode,
    prepTimer: Math.max(0, Number(state.prepTimer.toFixed(2))),
    hostId: state.hostId,
    players: state.players.map(p=>({id:p.id, name:p.name, ready:!!p.ready, connected:!!p.connected, pathIndex:p.pathIndex})),
    tray: (state.trays[viewerId]||[]).map(serializeTroop),
  };

  if(state.mode === "independent"){
    // 独立模式：返回查看者自己路径的完整状态 + 其他路径摘要
    const viewerPs = getPlayerPathState(state, viewerId);
    const viewerPathIdx = getPlayerPathIndex(state, viewerId);

    if(viewerPs){
      base.crystals = viewerPs.crystals;
      base.spawned = viewerPs.spawned;
      base.killed = viewerPs.killed;
      base.waveSize = waveSizeFor(state.level);
      base.pathIndex = viewerPathIdx;
      base.slots = viewerPs.slots.map(t=>t?serializeTroop(t):null);
      base.enemies = viewerPs.enemies.filter(e=>!e.dead).map(e=>({
        id:e.id, hp:Math.max(0,e.hp), hpMax:e.hpMax,
        x:e.x, y:e.y, color:e.color, shell:e.shell, eye:e.eye,
        bodyR:e.bodyR||12, kind:e.kind||"mite", walk:e.walk||0,
        slow:e.slowMul<1, poison:e.poisonTimer>0,
      }));
      base.bullets = viewerPs.bullets.map(b=>({id:b.id, x:b.x, y:b.y, sx:b.sx, sy:b.sy, tx:b.tx, ty:b.ty, color:b.color, size:b.size, style:b.style}));
      base.beams = viewerPs.beams.map(b=>({id:b.id, x:b.x, y:b.y, tx:b.tx, ty:b.ty, color:b.color, life:b.life}));
      base.clouds = viewerPs.clouds.map(c=>({id:c.id, x:c.x, y:c.y, r:c.r, life:c.life}));
      base.effects = viewerPs.effects.map(ef=>({
        id:ef.id, kind:ef.kind, x:ef.x, y:ef.y, r:ef.r,
        x1:ef.x1, y1:ef.y1, x2:ef.x2, y2:ef.y2,
        ang:ef.ang, half:ef.half, color:ef.color, life:ef.life, max:ef.max, width:ef.width,
      }));
    }

    base.pathViews = state.paths.map(ps=>({
      pathIndex: ps.pathIndex,
      ownerId: ps.ownerId,
      crystals: ps.crystals,
      spawned: ps.spawned,
      killed: ps.killed,
      slots: ps.slots.map(t=>t?serializeTroop(t):null),
      enemies: ps.enemies.filter(e=>!e.dead).map(e=>({
        id:e.id, hp:Math.max(0,e.hp), hpMax:e.hpMax,
        x:e.x, y:e.y, color:e.color, shell:e.shell, eye:e.eye,
        bodyR:e.bodyR||12, kind:e.kind||"mite", walk:e.walk||0,
        slow:e.slowMul<1, poison:e.poisonTimer>0,
      })),
      bullets: ps.bullets.map(b=>({id:b.id, x:b.x, y:b.y, sx:b.sx, sy:b.sy, tx:b.tx, ty:b.ty, color:b.color, size:b.size, style:b.style})),
      beams: ps.beams.map(b=>({id:b.id, x:b.x, y:b.y, tx:b.tx, ty:b.ty, color:b.color, life:b.life})),
      clouds: ps.clouds.map(c=>({id:c.id, x:c.x, y:c.y, r:c.r, life:c.life})),
      effects: ps.effects.map(ef=>({
        id:ef.id, kind:ef.kind, x:ef.x, y:ef.y, r:ef.r,
        x1:ef.x1, y1:ef.y1, x2:ef.x2, y2:ef.y2,
        ang:ef.ang, half:ef.half, color:ef.color, life:ef.life, max:ef.max, width:ef.width,
      })),
    }));

    // 其他路径摘要（迷你地图用）
    base.otherPaths = state.paths.filter(ps=>ps.ownerId!==viewerId).map(ps=>({
      pathIndex: ps.pathIndex,
      ownerId: ps.ownerId,
      crystals: ps.crystals,
      spawned: ps.spawned,
      killed: ps.killed,
      enemyCount: ps.enemies.filter(e=>!e.dead).length,
      slotCount: ps.slots.filter(Boolean).length,
    }));
  } else {
    // 合作模式：原有逻辑
    base.crystals = state.crystals;
    base.spawned = state.spawned;
    base.killed = state.killed;
    base.waveSize = waveSizeFor(state.level);
    base.slots = state.slots.map(t=>t?serializeTroop(t):null);
    base.enemies = state.enemies.filter(e=>!e.dead).map(e=>({
      id:e.id, hp:Math.max(0,e.hp), hpMax:e.hpMax,
      x:e.x, y:e.y, color:e.color, shell:e.shell, eye:e.eye,
      bodyR:e.bodyR||12, kind:e.kind||"mite", walk:e.walk||0,
      slow:e.slowMul<1, poison:e.poisonTimer>0,
    }));
    base.bullets = state.bullets.map(b=>({id:b.id, x:b.x, y:b.y, sx:b.sx, sy:b.sy, tx:b.tx, ty:b.ty, color:b.color, size:b.size, style:b.style}));
    base.beams = state.beams.map(b=>({id:b.id, x:b.x, y:b.y, tx:b.tx, ty:b.ty, color:b.color, life:b.life}));
    base.clouds = state.clouds.map(c=>({id:c.id, x:c.x, y:c.y, r:c.r, life:c.life}));
    base.effects = state.effects.map(ef=>({
      id:ef.id, kind:ef.kind, x:ef.x, y:ef.y, r:ef.r,
      x1:ef.x1, y1:ef.y1, x2:ef.x2, y2:ef.y2,
      ang:ef.ang, half:ef.half, color:ef.color, life:ef.life, max:ef.max, width:ef.width,
    }));
  }

  return base;
}

module.exports = {createSession, publicState, command, step, allReady};
