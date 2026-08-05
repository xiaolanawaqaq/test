"use strict";

const assert=require("assert");
const {PATH_LEN,MAX_LEVEL,LEVEL_RATE_MUL,UPGRADE_POINTS_PER_STAGE,TROOPS_PER_STAGE,WEAPON_UPGRADE_MAX}=require("../shared/game-types");
const {createSession,command,step,publicState}=require("../shared/game-engine");

function startSession(mode){
  const state=createSession(["a","b","c"],24680,mode);
  for(const player of state.players) command(state,player.id,{type:"ready",value:true});
  command(state,"a",{type:"start"});
  return state;
}

function expectInvalidSlot(mode,targetSlot,includeTarget=true){
  const state=startSession(mode);
  const deploy={type:"deploy",troopId:state.trays.a[0].id};
  if(includeTarget) deploy.targetSlot=targetSlot;
  assert.throws(()=>command(state,"a",deploy),/槽位无效/,`${mode} accepted targetSlot ${String(targetSlot)}`);
}

function makeEnemy(id,dist,speed=10){
  return {
    id,hpMax:100,hp:100,def:0,speed,bodyR:2,kind:"mite",
    dist,x:0,y:0,slowMul:1,slowTimer:0,poisonTimer:0,poisonDps:0,
    walk:0,dead:false,reached:false,
  };
}

for(const mode of ["coop","independent"]){
  expectInvalidSlot(mode,null);
  expectInvalidSlot(mode,false);
  expectInvalidSlot(mode,"");
  expectInvalidSlot(mode,undefined,false);
  expectInvalidSlot(mode,"0");
  expectInvalidSlot(mode,0.5);

  const state=startSession(mode);
  const troop=state.trays.a[0];
  command(state,"a",{type:"deploy",troopId:troop.id,targetSlot:0});
  const slot=mode==="coop"?state.slots[0]:state.paths[0].slots[0];
  assert.strictEqual(slot.id,troop.id,`${mode} rejected numeric targetSlot zero`);
}

{
  const state=startSession("coop");
  state.level=40;
  state.phase="battle";
  state.crystals=1;
  state.spawned=74;
  state.enemies=[makeEnemy("final-crystal",PATH_LEN-1)];
  step(state,0.2);
  assert.strictEqual(state.over,true);
  assert.strictEqual(state.result,"lose");
  assert.strictEqual(state.level,40);
  assert.strictEqual(state.enemies.length,0);
}

{
  const state=startSession("coop");
  state.phase="battle";
  state.crystals=1;
  state.spawned=20;
  state.enemies=[makeEnemy("early-crystal",PATH_LEN-1)];
  step(state,0.2);
  assert.strictEqual(state.over,true);
  assert.strictEqual(state.result,"lose");
  assert.strictEqual(state.level,1);
  assert.strictEqual(state.phase,"battle");
}

{
  const state=startSession("independent");
  state.phase="battle";
  for(let i=0;i<state.paths.length;i++){
    const pathState=state.paths[i];
    pathState.crystals=1;
    pathState.spawned=20;
    pathState.enemies=[makeEnemy(`path-${i}-crystal`,pathState.pathLen-1)];
  }
  step(state,0.2);
  assert.strictEqual(state.over,true);
  assert.strictEqual(state.result,"lose");
  assert.strictEqual(state.level,1);
  assert.strictEqual(state.phase,"battle");
  assert(state.paths.every(pathState=>pathState.enemies.length===0));
}

{
  const state=startSession("independent");
  const troop=state.trays.a[0];
  troop.style="shotgun";
  troop.pellets=1;
  troop.range=100;
  troop.dmg=10;
  troop.rate=1;
  troop.cd=0;
  command(state,"a",{type:"deploy",troopId:troop.id,targetSlot:0});
  command(state,"a",{type:"startWave"});

  const pathState=state.paths[0];
  pathState.path=[{x:144,y:220},{x:500,y:220}];
  pathState.pathLen=1000;
  const first=makeEnemy("shotgun-first",35,0);
  const second=makeEnemy("shotgun-second",65,0);
  pathState.enemies=[first,second];

  step(state,0.08);
  assert.strictEqual(first.hp,90,"shotgun did not damage the first swept target exactly once");
  assert.strictEqual(second.hp,100,"shotgun passed through the first target");
  assert.strictEqual(pathState.bullets.length,0,"shotgun pellet survived after its first hit");
}

{
  const state=startSession("coop");
  assert.strictEqual(new Set(state.trays.a.map(t=>t.typeKey)).size,5,"opening troops must be varied");
  const rates=[];
  for(let level=1;level<=MAX_LEVEL;level++) rates.push(require("../shared/game-engine").makeTroop(level,"a",state.nextId,state.rng,"tank").rate);
  assert(Math.abs(rates[1]/rates[0]-LEVEL_RATE_MUL[1])<1e-9,"level 2 rate mismatch");
  assert(Math.abs(rates[5]/rates[0]-LEVEL_RATE_MUL[5])<1e-9,"level 6 rate mismatch");

  const troop=state.trays.a[0];
  command(state,"a",{type:"deploy",troopId:troop.id,targetSlot:0});
  state.upgradePoints.a=20;
  const before=publicState(state,"a").slots[0].damageFinal;
  command(state,"a",{type:"upgradeWeapon",troopId:troop.id});
  assert.strictEqual(state.slots[0].weaponLevel,1);
  assert(Math.abs(publicState(state,"a").slots[0].damageFinal-before*1.25)<1e-9);
  command(state,"a",{type:"upgradeWeapon",troopId:troop.id});
  command(state,"a",{type:"upgradeWeapon",troopId:troop.id});
  assert.strictEqual(state.slots[0].weaponLevel,WEAPON_UPGRADE_MAX);
  assert.throws(()=>command(state,"a",{type:"upgradeWeapon",troopId:troop.id}),/满级/);

  state.crystals=7;
  command(state,"a",{type:"upgradeDefense"});
  assert.strictEqual(state.crystalsMax,12);
  assert.strictEqual(state.crystals,9);

  state.phase="battle";
  state.spawned=20;
  state.enemies=[];
  const trayBefore=state.trays.a.length;
  const pointsBefore=state.upgradePoints.a;
  step(state,0.01);
  assert.strictEqual(state.upgradePoints.a,pointsBefore+UPGRADE_POINTS_PER_STAGE);
  assert.strictEqual(state.trays.a.length,trayBefore+TROOPS_PER_STAGE);
}

{
  const state=startSession("coop");
  state.trays.a=[
    require("../shared/game-engine").makeTroop(1,"a",state.nextId,state.rng,"gun",2),
    require("../shared/game-engine").makeTroop(1,"a",state.nextId,state.rng,"tank",1),
  ];
  const first=state.trays.a[0],second=state.trays.a[1];
  command(state,"a",{type:"deploy",troopId:first.id,targetSlot:0});
  command(state,"a",{type:"deploy",troopId:second.id,targetSlot:1});
  command(state,"a",{type:"merge",troopId:first.id,targetSlot:1});
  assert.strictEqual(state.slots[1].level,2);
  assert.strictEqual(state.slots[1].weaponLevel,2);
  assert.strictEqual(state.slots[0],null);
}

console.log("ENGINE REGRESSION OK",{
  targetSlotModes:2,
  lossBranches:3,
  sweptShotgun:true,
  upgrades:true,
  mergeInheritance:true,
  variedTroops:true,
});
