"use strict";

const TOTAL_LEVELS = 40;
const WAVE_SIZE = 20;
const START_CRYSTALS = 10;
const PREP_SECONDS = 120;
const START_TROOPS = 5;
const TROOPS_PER_STAGE = 2;
const MAX_LEVEL = 6;
const SLOT_COUNT = 32;
const CELL = 64;

// 与单机 index.html 一致的 S 形路径
const PATH = [
  {x: 40, y:70}, {x:860, y:70},
  {x:860, y:180}, {x:100, y:180},
  {x:100, y:290}, {x:860, y:290},
  {x:860, y:400}, {x:100, y:400},
  {x:100, y:510}, {x:520, y:510}
];

// style 决定打法；数值用 baseStats(level) * mul 生成
const TROOP_TYPES = [
  {key:"gun",      name:"机枪兵", icon:"🔫", style:"rapid",   mode:"single", tag:"连射", desc:"快速连射，单体小伤", rateMul:2.2, dmgMul:0.42, rangeMul:0.95, burst:3},
  {key:"tank",     name:"坦克",   icon:"🛡", style:"heavy",   mode:"single", tag:"重击", desc:"单发重创，攻速慢", rateMul:0.42, dmgMul:2.2,  rangeMul:1.0},
  {key:"plane",    name:"飞机",   icon:"✈", style:"splash",  mode:"aoe",    tag:"轰炸", desc:"落点爆炸，群伤中等", rateMul:0.7,  dmgMul:0.9,  rangeMul:1.25, splash:70},
  {key:"cannon",   name:"大炮",   icon:"💣", style:"splash",  mode:"aoe",    tag:"榴弹", desc:"大范围爆炸，攻速慢", rateMul:0.32, dmgMul:1.7,  rangeMul:1.4,  splash:95},
  {key:"sniper",   name:"狙击手", icon:"🎯", style:"sniper",  mode:"single", tag:"狙击", desc:"瞬间高伤，射程远", rateMul:0.38, dmgMul:2.9,  rangeMul:1.55},
  {key:"flame",    name:"火焰兵", icon:"🔥", style:"cone",    mode:"aoe",    tag:"喷火", desc:"锥形喷火，近距群伤", rateMul:1.35, dmgMul:0.5,  rangeMul:0.78, cone:58},
  {key:"tesla",    name:"电磁塔", icon:"⚡", style:"chain",   mode:"aoe",    tag:"连锁", desc:"闪电跳跃命中多个", rateMul:0.85, dmgMul:0.72, rangeMul:1.1,  chain:3, chainR:95},
  {key:"laser",    name:"激光炮", icon:"🔺", style:"beam",    mode:"single", tag:"激光", desc:"持续光束锁定扣血", rateMul:1.45, dmgMul:0.8,  rangeMul:1.2},
  {key:"ice",      name:"冰冻塔", icon:"❄", style:"freeze",  mode:"single", tag:"冰冻", desc:"伤害并大幅减速", rateMul:0.8,  dmgMul:0.65, rangeMul:1.05, slow:0.38},
  {key:"poison",   name:"毒气兵", icon:"☣", style:"poison",  mode:"aoe",    tag:"毒云", desc:"留下毒区持续灼烧", rateMul:0.5,  dmgMul:0.45, rangeMul:1.0,  splash:72, poison:3.2},
  {key:"artillery",name:"重炮车", icon:"🚛", style:"heavy",   mode:"single", tag:"重炮", desc:"超高单体伤害，很慢", rateMul:0.32, dmgMul:2.7,  rangeMul:1.25},
  {key:"missile",  name:"飞弹塔", icon:"📡", style:"missile", mode:"aoe",    tag:"导弹", desc:"追踪导弹+小爆炸", rateMul:0.55, dmgMul:1.15, rangeMul:1.35, splash:55},
  {key:"shotgun",  name:"散弹兵", icon:"✳", style:"shotgun", mode:"aoe",    tag:"散弹", desc:"扇形多发弹，近战强", rateMul:1.05, dmgMul:0.38, rangeMul:0.82, pellets:5},
  {key:"robot",    name:"机器人", icon:"🤖", style:"rapid",   mode:"single", tag:"双发", desc:"双连发，均衡单体", rateMul:1.15, dmgMul:0.95, rangeMul:1.0,  burst:2},
  {key:"core",     name:"能量核", icon:"🔵", style:"pulse",   mode:"aoe",    tag:"脉冲", desc:"以自身为中心震波", rateMul:0.55, dmgMul:0.95, rangeMul:1.05},
];

function buildSlots(){
  const bandY = [125, 235, 345, 455];
  const startX = 150, gap = CELL + 6, cols = 8;
  const slots = [];
  bandY.forEach(y=>{
    for(let c=0;c<cols;c++) slots.push({x:startX + c*gap, y});
  });
  return slots;
}

const SLOT_META = buildSlots();

function pathLength(){
  let len=0;
  for(let i=0;i<PATH.length-1;i++){
    len += Math.hypot(PATH[i+1].x-PATH[i].x, PATH[i+1].y-PATH[i].y);
  }
  return len;
}
const PATH_LEN = pathLength();

function posOnPath(dist){
  let left = Math.max(0, dist);
  for(let i=0;i<PATH.length-1;i++){
    const a=PATH[i], b=PATH[i+1];
    const seg=Math.hypot(b.x-a.x,b.y-a.y);
    if(left <= seg){
      const t = seg>0 ? left/seg : 0;
      return {x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t, seg:i, t};
    }
    left -= seg;
  }
  const last=PATH[PATH.length-1];
  return {x:last.x, y:last.y, seg:PATH.length-2, t:1};
}

module.exports = {
  TOTAL_LEVELS,WAVE_SIZE,START_CRYSTALS,PREP_SECONDS,START_TROOPS,
  TROOPS_PER_STAGE,MAX_LEVEL,SLOT_COUNT,CELL,PATH,PATH_LEN,TROOP_TYPES,SLOT_META,posOnPath
};
