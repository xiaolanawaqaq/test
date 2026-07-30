"use strict";

const assert=require("assert");
const {
  CANVAS_WIDTH,CANVAS_HEIGHT,PATH,PATH_LEN,SLOT_COUNT,SLOT_META,
  INDEPENDENT_PATHS,INDEPENDENT_SLOT_META,INDEPENDENT_SLOT_COUNT,
  posOnPath,pathLength,
}=require("../shared/game-types");
const {createSession,publicState,command,step}=require("../shared/game-engine");

function inside(point){
  return point.x>=0 && point.x<=CANVAS_WIDTH && point.y>=0 && point.y<=CANVAS_HEIGHT;
}
function distanceToSegment(point,a,b){
  const dx=b.x-a.x,dy=b.y-a.y;
  const lengthSq=dx*dx+dy*dy;
  const t=lengthSq?Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/lengthSq)):0;
  return Math.hypot(point.x-(a.x+t*dx),point.y-(a.y+t*dy));
}
function distanceToPath(point,path){
  let distance=Infinity;
  for(let i=0;i<path.length-1;i++) distance=Math.min(distance,distanceToSegment(point,path[i],path[i+1]));
  return distance;
}
function expectInvalid(fn){
  assert.throws(fn,/槽位无效/);
}
function startSession(mode){
  const state=createSession(["a","b","c"],12345,mode);
  for(const player of state.players) command(state,player.id,{type:"ready",value:true});
  command(state,"a",{type:"start"});
  return state;
}

assert.strictEqual(CANVAS_WIDTH,576);
assert.strictEqual(CANVAS_HEIGHT,960);
assert.strictEqual(SLOT_COUNT,32);
assert.strictEqual(SLOT_META.length,32);
assert(PATH.every(inside));
assert(SLOT_META.every(inside));
assert.deepStrictEqual(posOnPath(0,PATH),{...PATH[0],seg:0,t:0});
const pathEnd=posOnPath(PATH_LEN+1,PATH);
assert.strictEqual(pathEnd.x,PATH.at(-1).x);
assert.strictEqual(pathEnd.y,PATH.at(-1).y);

assert.strictEqual(INDEPENDENT_PATHS.length,3);
assert.strictEqual(INDEPENDENT_SLOT_META.length,3);
for(let i=0;i<3;i++){
  const path=INDEPENDENT_PATHS[i];
  const slots=INDEPENDENT_SLOT_META[i];
  assert(path.every(inside));
  assert.strictEqual(slots.length,INDEPENDENT_SLOT_COUNT);
  assert(slots.every(inside));
  assert.strictEqual(new Set(slots.map(slot=>`${slot.x},${slot.y}`)).size,slots.length);
  assert(slots.every(slot=>distanceToPath(slot,path)<=125),`path ${i} contains an unreachable slot`);
  assert(pathLength(path)>0);
}

const coop=startSession("coop");
command(coop,"a",{type:"deploy",troopId:coop.trays.a[0].id,targetSlot:0});
command(coop,"b",{type:"deploy",troopId:coop.trays.b[0].id,targetSlot:31});
assert(coop.slots[0]);
assert(coop.slots[31]);
expectInvalid(()=>command(coop,"c",{type:"deploy",troopId:coop.trays.c[0].id,targetSlot:32}));

const independent=startSession("independent");
for(let i=0;i<3;i++){
  const id=independent.players[i].id;
  command(independent,id,{type:"deploy",troopId:independent.trays[id][0].id,targetSlot:i?15:0});
}
assert(independent.paths[0].slots[0]);
assert(independent.paths[1].slots[15]);
assert(independent.paths[2].slots[15]);
expectInvalid(()=>command(independent,"a",{type:"deploy",troopId:independent.trays.a[0].id,targetSlot:16}));
const view=publicState(independent,"a");
assert.strictEqual(view.pathViews.length,3);
assert.strictEqual(view.pathViews[1].slots.length,16);
assert(view.pathViews[1].slots[15]);

command(independent,"a",{type:"startWave"});
step(independent,1.1);
assert(independent.paths.every(pathState=>pathState.enemies.length>0));
assert(independent.paths.every(pathState=>inside(pathState.enemies[0])));

console.log("GEOMETRY OK",{
  canvas:`${CANVAS_WIDTH}x${CANVAS_HEIGHT}`,
  coopSlots:SLOT_META.length,
  independentSlots:INDEPENDENT_SLOT_META[0].length,
  pathViews:view.pathViews.length,
});
