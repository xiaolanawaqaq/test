"use strict";

const TOTAL_LEVELS = 40;
const WAVE_SIZE = 20;
const START_CRYSTALS = 10;
const PREP_SECONDS = 120;
const START_TROOPS = 5;
const TROOPS_PER_STAGE = 2;
const MAX_LEVEL = 6;
const CELL = 64;

// ============ 原始单路径（合作模式 / 单机） ============
const PATH = [
  {x: 40, y:70}, {x:860, y:70},
  {x:860, y:180}, {x:100, y:180},
  {x:100, y:290}, {x:860, y:290},
  {x:860, y:400}, {x:100, y:400},
  {x:100, y:520}, {x:520, y:520}
];

// ============ 三条独立路径（独立路径模式） ============
// 画布尺寸 960x576，三条路径分上/中/下三个条带
const INDEPENDENT_PATHS = [
  // 路径0：顶部条带 (y: 40~165)
  [
    {x: 30, y: 55}, {x:860, y: 55},
    {x:860, y:105}, {x:100, y:105},
    {x:100, y:155}, {x:860, y:155},
  ],
  // 路径1：中部条带 (y: 200~325)
  [
    {x: 30, y:215}, {x:860, y:215},
    {x:860, y:265}, {x:100, y:265},
    {x:100, y:315}, {x:860, y:315},
  ],
  // 路径2：底部条带 (y: 360~485)
  [
    {x: 30, y:375}, {x:860, y:375},
    {x:860, y:425}, {x:100, y:425},
    {x:100, y:475}, {x:860, y:475},
  ],
];

// 每条独立路径的槽位（4排×4列 = 16个/路）
function buildIndependentSlots(){
  const bands = [
    [{x:220,y:72},{x:340,y:72},{x:460,y:72},{x:580,y:72},
     {x:220,y:102},{x:340,y:102},{x:460,y:102},{x:580,y:102},
     {x:220,y:132},{x:340,y:132},{x:460,y:132},{x:580,y:132},
     {x:220,y:162},{x:340,y:162},{x:460,y:162},{x:580,y:162}],
    [{x:220,y:232},{x:340,y:232},{x:460,y:232},{x:580,y:232},
     {x:220,y:262},{x:340,y:262},{x:460,y:262},{x:580,y:262},
     {x:220,y:292},{x:340,y:292},{x:460,y:292},{x:580,y:292},
     {x:220,y:322},{x:340,y:322},{x:460,y:322},{x:580,y:322}],
    [{x:220,y:392},{x:340,y:392},{x:460,y:392},{x:580,y:392},
     {x:220,y:422},{x:340,y:422},{x:460,y:422},{x:580,y:422},
     {x:220,y:452},{x:340,y:452},{x:460,y:452},{x:580,y:452},
     {x:220,y:482},{x:340,y:482},{x:460,y:482},{x:580,y:482}],
  ];
  return bands;
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
];

// ============ 原始单路径槽位（合作模式 / 单机） ============
function buildSlots(){
  const bandY = [115, 225, 335, 445];
  const startX = 150, gap = CELL + 6, cols = 8;
  const slots = [];
  bandY.forEach(y=>{
    for(let c=0;c<cols;c++) slots.push({x:startX + c*gap, y});
  });
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

module.exports = {
  TOTAL_LEVELS,WAVE_SIZE,START_CRYSTALS,PREP_SECONDS,START_TROOPS,
  TROOPS_PER_STAGE,MAX_LEVEL,SLOT_COUNT,CELL,
  PATH,PATH_LEN,TROOP_TYPES,SLOT_META,posOnPath,pathLength,
  INDEPENDENT_PATHS,INDEPENDENT_SLOT_META,INDEPENDENT_SLOT_COUNT,
  getIndependentPath,getIndependentSlots,getIndependentPathLen
};
