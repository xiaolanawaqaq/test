"use strict";

(function(){
const TOTAL_LEVELS = 40;
const WAVE_SIZE = 20;
const START_CRYSTALS = 10;
const PREP_SECONDS = 120;
const START_TROOPS = 5;
const TROOPS_PER_STAGE = 2;
const MAX_LEVEL = 6;
const RULES_VERSION = 2;
const LEVEL_DAMAGE_MUL = [1.0, 1.85, 2.9, 4.2, 5.8, 7.7];
const LEVEL_RATE_MUL = [1.0, 1.7, 2.4, 3.1, 3.8, 4.5];
const UPGRADE_POINTS_PER_STAGE = 2;
const WEAPON_UPGRADE_MAX = 3;
const WEAPON_UPGRADE_COSTS = [1, 2, 3];
const WEAPON_DAMAGE_PER_LEVEL = 0.25;
const DEFENSE_UPGRADE_MAX = 5;
const DEFENSE_UPGRADE_COSTS = [2, 3, 4, 5, 6];
const DEFENSE_HP_PER_LEVEL = 2;
const CANVAS_WIDTH = 576;
const CANVAS_HEIGHT = 960;
const SLOT_COUNT = 32;
const CELL = 64;

const PATH = [
  {x:70,y:40}, {x:70,y:860},
  {x:180,y:860}, {x:180,y:100},
  {x:290,y:100}, {x:290,y:860},
  {x:400,y:860}, {x:400,y:100},
  {x:520,y:100}, {x:520,y:520},
];

const INDEPENDENT_PATH = [
  {x:80,y:60}, {x:80,y:850},
  {x:288,y:850}, {x:288,y:100},
  {x:496,y:100}, {x:496,y:710},
];
const INDEPENDENT_PATHS = Array.from({length:3},()=>
  INDEPENDENT_PATH.map(point=>({...point}))
);

function buildIndependentSlots(){
  const xs=[144,240,336,433];
  const ys=[220,400,580,760];
  const slots=[];
  for(const y of ys){
    for(const x of xs) slots.push({x,y});
  }
  return Array.from({length:3},()=>slots.map(slot=>({...slot})));
}

const INDEPENDENT_SLOT_META = buildIndependentSlots();
const INDEPENDENT_SLOT_COUNT = 16; // 每条路径16个槽位

// ============ 兵种定义 ============
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
  {key:"railgun",  name:"轨道炮", icon:"➤",  style:"rail",    mode:"line",   tag:"贯穿", desc:"远程直线贯穿四个目标", rateMul:0.34, dmgMul:2.35, rangeMul:1.65, pierceCount:4},
  {key:"miner",    name:"地雷工兵", icon:"◆", style:"mine",    mode:"aoe",    tag:"布雷", desc:"沿路径布雷，接近后爆炸", rateMul:0.44, dmgMul:1.35, rangeMul:1.1, mineRadius:62},
  {key:"radar",    name:"干扰雷达", icon:"◎", style:"vulnerable", mode:"support", tag:"易伤", desc:"标记目标，使其承受更多伤害", rateMul:0.72, dmgMul:0.42, rangeMul:1.28, vulnerable:0.28},
];

function buildSlots(){
  const xs=[115,225,335,445];
  const ys=[150,220,290,360,430,500,570,640];
  const slots=[];
  for(const y of ys){
    for(const x of xs) slots.push({x,y});
  }
  return slots;
}

const SLOT_META = buildSlots();

// ============ 路径工具函数 ============
function pathLength(path){
  path = path || PATH;
  let len=0;
  for(let i=0;i<path.length-1;i++){
    len += Math.hypot(path[i+1].x-path[i].x, path[i+1].y-path[i].y);
  }
  return len;
}
const PATH_LEN = pathLength();

function posOnPath(dist, path){
  path = path || PATH;
  let left = Math.max(0, dist);
  for(let i=0;i<path.length-1;i++){
    const a=path[i], b=path[i+1];
    const seg=Math.hypot(b.x-a.x,b.y-a.y);
    if(left <= seg){
      const t = seg>0 ? left/seg : 0;
      return {x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t, seg:i, t};
    }
    left -= seg;
  }
  const last=path[path.length-1];
  return {x:last.x, y:last.y, seg:path.length-2, t:1};
}

// 获取独立模式下某条路径的信息
function getIndependentPath(pathIndex){
  return INDEPENDENT_PATHS[pathIndex] || INDEPENDENT_PATHS[0];
}
function getIndependentSlots(pathIndex){
  return INDEPENDENT_SLOT_META[pathIndex] || INDEPENDENT_SLOT_META[0];
}
function getIndependentPathLen(pathIndex){
  return pathLength(getIndependentPath(pathIndex));
}

const GameTypes = {
  TOTAL_LEVELS,WAVE_SIZE,START_CRYSTALS,PREP_SECONDS,START_TROOPS,
  TROOPS_PER_STAGE,MAX_LEVEL,RULES_VERSION,LEVEL_DAMAGE_MUL,LEVEL_RATE_MUL,
  UPGRADE_POINTS_PER_STAGE,WEAPON_UPGRADE_MAX,WEAPON_UPGRADE_COSTS,WEAPON_DAMAGE_PER_LEVEL,
  DEFENSE_UPGRADE_MAX,DEFENSE_UPGRADE_COSTS,DEFENSE_HP_PER_LEVEL,
  CANVAS_WIDTH,CANVAS_HEIGHT,SLOT_COUNT,CELL,
  PATH,PATH_LEN,TROOP_TYPES,SLOT_META,posOnPath,pathLength,
  INDEPENDENT_PATHS,INDEPENDENT_SLOT_META,INDEPENDENT_SLOT_COUNT,
  getIndependentPath,getIndependentSlots,getIndependentPathLen
};

if(typeof module!=="undefined" && module.exports) module.exports=GameTypes;
if(typeof window!=="undefined") window.GameTypes=GameTypes;
})();
