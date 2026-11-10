extends RefCounted
## 微尘 — deterministic fixed-step particle simulation.
## State is parallel packed arrays in a Dictionary: JSON-serializable via
## serialize_state(), fast to index in GDScript, no per-tick allocations in
## the hot loop beyond one neighbor scratch array per particle.
## Same seed + same input log always produces the same tick-by-tick state.

const DT := 1.0 / 30.0
const FIELD_W := 1200.0
const FIELD_H := 820.0

const INIT_PARTICLES := 120
const MAX_PARTICLES := 180

const MAX_TICKS := 2700 # 90 seconds of observation
const DETECT_EVERY := 10

const E_START := 70.0
const E_SPLIT := 110.0
const E_MAX := 140.0
const E_DECAY := 1.05 # per second
const AGE_SPLIT_MIN := 15

const NEIGHBOR_R := 46.0
const NEIGHBOR_R2 := NEIGHBOR_R * NEIGHBOR_R
const SEPARATE_R := 16.0
const SEPARATE_R2 := SEPARATE_R * SEPARATE_R
const CLUSTER_R := 45.0  # must stay ≤ CELL_SIZE so the 3×3 scan can't miss links
const CLUSTER_R2 := CLUSTER_R * CLUSTER_R
const CELL_SIZE := 46.0
const GRID_W := 27  # ceil(1200 / 46)
const GRID_H := 18  # ceil(820 / 46)

const LIGHT_R := 240.0
const LIGHT_R2 := LIGHT_R * LIGHT_R
const LIGHT_ACC := 90.0
const LIGHT_GAIN := 26.0 # energy per second at center
const POISON_R := 200.0
const POISON_R2 := POISON_R * POISON_R
const POISON_PUSH := 150.0
const POISON_DRAIN := 30.0 # energy per second at center

const ZONE_TTL := 1800 # ticks a placed zone lasts (~60 s)
const LIGHT_BUDGET := 6
const POISON_BUDGET := 3

const V_MAX := 160.0
const COHESION := 22.0
const ALIGN := 2.2
const SEPARATE := 60.0
const SWIRL := 34.0
const DRAG := 0.35

const NEBULA_MIN_SIZE := 14
const NEBULA_MAX_RADIUS := 50.0
const VORTEX_MIN_SIZE := 12
const VORTEX_MIN_SPIN := 0.30
const FLOW_MIN_SIZE := 8
const FLOW_MIN_COHERENCE := 0.62
const FLOW_MIN_SPEED := 18.0

const QUANT := 10000.0 # serialize float precision: 4 decimals

# Per-round observation goals, picked deterministically from the seed.
# "kinds" counts distinct phenomena seen; others need that phenomenon to hold
# cumulatively for `target` ticks (detection runs every DETECT_EVERY ticks).
const GOALS := [
	{"kind": "kinds", "target": 2, "label": "让两种现象出现"},
	{"kind": "vortex", "target": 90, "label": "漩涡稳定3秒"},
	{"kind": "nebula", "target": 90, "label": "星云稳定3秒"},
	{"kind": "flow", "target": 90, "label": "流动群落稳定3秒"},
]
const GOAL_BONUS := 150


func new_round(seed: int) -> Dictionary:
	# Deterministic initial scatter from the seed itself — no RNG object state.
	var n := INIT_PARTICLES
	var x := PackedFloat32Array()
	var y := PackedFloat32Array()
	var vx := PackedFloat32Array()
	var vy := PackedFloat32Array()
	var energy := PackedFloat32Array()
	var age := PackedInt32Array()
	var pid := PackedInt32Array()
	x.resize(n)
	y.resize(n)
	vx.resize(n)
	vy.resize(n)
	energy.resize(n)
	age.resize(n)
	pid.resize(n)
	for i in n:
		var a := _hash01(seed, i, 1) * TAU
		var r := 120.0 + _hash01(seed, i, 2) * 420.0
		x[i] = clampf(FIELD_W * 0.5 + cos(a) * r, 8.0, FIELD_W - 8.0)
		y[i] = clampf(FIELD_H * 0.5 + sin(a) * r * 0.62, 8.0, FIELD_H - 8.0)
		var va := _hash01(seed, i, 3) * TAU
		var vm := 14.0 + _hash01(seed, i, 4) * 30.0
		vx[i] = cos(va) * vm
		vy[i] = sin(va) * vm
		energy[i] = E_START * (0.85 + 0.3 * _hash01(seed, i, 5))
		age[i] = 0
		pid[i] = i
	return {
		"seed": seed, "tick": 0, "status": "observing", "reason": "",
		"x": x, "y": y, "vx": vx, "vy": vy,
		"energy": energy, "age": age, "pid": pid,
		"next_id": n, "count": n,
		"lights": [], "poisons": [],
		"light_budget": LIGHT_BUDGET, "poison_budget": POISON_BUDGET,
		"inputs": [],
		"peak": n,
		"phenomena": {"nebula": 0, "vortex": 0, "flow": 0},
		"streak": {"nebula": 0, "vortex": 0, "flow": 0},
		"streak_best": {"nebula": 0, "vortex": 0, "flow": 0},
		"phenomenon_now": [],
		"highlights": [],
		"goal": _pick_goal(seed),
		"stable_ticks": 0, "score": 0,
	}


func _pick_goal(seed: int) -> Dictionary:
	var index := int(_hash01(seed, 7, 11) * GOALS.size()) % GOALS.size()
	var goal: Dictionary = GOALS[index]
	return {"kind": goal["kind"], "target": int(goal["target"]),
		"label": goal["label"], "done": false, "done_tick": 0}


func clone_state(state: Dictionary) -> Dictionary:
	return state.duplicate(true)


func particle_count(state: Dictionary) -> int:
	return int(state["count"])


func particle(state: Dictionary, i: int) -> Dictionary:
	return {
		"id": int(state["pid"][i]), "x": float(state["x"][i]), "y": float(state["y"][i]),
		"vx": float(state["vx"][i]), "vy": float(state["vy"][i]),
		"energy": float(state["energy"][i]), "age": int(state["age"][i]),
	}


func apply_tool(state: Dictionary, tool: String, x: float, y: float) -> Dictionary:
	if state["status"] != "observing":
		return {"ok": false, "err": "本轮观测已结束"}
	x = clampf(x, 0.0, FIELD_W)
	y = clampf(y, 0.0, FIELD_H)
	if tool == "light":
		if int(state["light_budget"]) <= 0:
			return {"ok": false, "err": "光源余量用完了"}
		state["light_budget"] = int(state["light_budget"]) - 1
		state["lights"].append({"x": x, "y": y, "born": int(state["tick"])})
	elif tool == "poison":
		if int(state["poison_budget"]) <= 0:
			return {"ok": false, "err": "毒域余量用完了"}
		state["poison_budget"] = int(state["poison_budget"]) - 1
		state["poisons"].append({"x": x, "y": y, "born": int(state["tick"])})
	else:
		return {"ok": false, "err": "未知工具"}
	state["inputs"].append({"tick": int(state["tick"]), "tool": tool, "x": x, "y": y})
	return {"ok": true}


func step(state: Dictionary) -> Dictionary:
	if state["status"] != "observing":
		return {"changed": false}
	var tick := int(state["tick"])
	var px: PackedFloat32Array = state["x"]
	var py: PackedFloat32Array = state["y"]
	var vx: PackedFloat32Array = state["vx"]
	var vy: PackedFloat32Array = state["vy"]
	var energy: PackedFloat32Array = state["energy"]
	var age: PackedInt32Array = state["age"]
	var n: int = state["count"]

	# Flat counting-sort grid: two packed arrays, no Dictionary or
	# Array-of-Array allocations in the hot loop.
	var grid := _grid_build(px, py, n)
	var start: PackedInt32Array = grid["start"]
	var order: PackedInt32Array = grid["order"]

	var lx: Array = []
	var ly: Array = []
	var lw: Array = []
	for z in state["lights"]:
		var zage := tick - int(z["born"])
		if zage < ZONE_TTL:
			lx.append(float(z["x"]))
			ly.append(float(z["y"]))
			lw.append(minf(1.0, zage / 30.0) * (1.0 - float(zage) / float(ZONE_TTL)))
	var qx: Array = []
	var qy: Array = []
	var qw: Array = []
	for z in state["poisons"]:
		var zage2 := tick - int(z["born"])
		if zage2 < ZONE_TTL:
			qx.append(float(z["x"]))
			qy.append(float(z["y"]))
			qw.append(minf(1.0, zage2 / 30.0) * (1.0 - float(zage2) / float(ZONE_TTL)))
	var nl := lx.size()
	var nq := qx.size()

	# Per-particle accumulators for births (split) and deaths.
	var births := 0
	var dead := PackedInt32Array()
	var room := MAX_PARTICLES - n
	var seed := int(state["seed"])
	var next_id := int(state["next_id"])

	for i in n:
		var xi := px[i]
		var yi := py[i]
		var vxi := vx[i]
		var vyi := vy[i]
		var ei := energy[i]
		var fx := -vxi * DRAG
		var fy := -vyi * DRAG

		# Rule 1: seek light.
		for k in nl:
			var dx := float(lx[k]) - xi
			var dy := float(ly[k]) - yi
			var d2 := dx * dx + dy * dy
			if d2 < LIGHT_R2 and d2 > 4.0:
				var d := sqrt(d2)
				var w := (1.0 - d / LIGHT_R) * float(lw[k])
				fx += dx / d * LIGHT_ACC * w
				fy += dy / d * LIGHT_ACC * w
				ei += LIGHT_GAIN * w * DT

		# Rule 2: local flock — cohesion, alignment, separation, swirl.
		var cx := 0.0
		var cy := 0.0
		var avx := 0.0
		var avy := 0.0
		var count := 0
		var ccx := int(xi / CELL_SIZE)
		var ccy := int(yi / CELL_SIZE)
		for oy in range(-1, 2):
			var yy := ccy + oy
			if yy < 0 or yy >= GRID_H:
				continue
			var row := yy * GRID_W
			for ox in range(-1, 2):
				var xx := ccx + ox
				if xx < 0 or xx >= GRID_W:
					continue
				var c := row + xx
				var s: int = start[c]
				var e: int = start[c + 1]
				for idx in range(s, e):
					var j := int(order[idx])
					if j == i:
						continue
					var nx := px[j] - xi
					var ny := py[j] - yi
					var nd2 := nx * nx + ny * ny
					if nd2 > NEIGHBOR_R2:
						continue
					var nd := sqrt(maxf(nd2, 0.01))
					count += 1
					cx += px[j]
					cy += py[j]
					avx += vx[j]
					avy += vy[j]
					if nd2 < SEPARATE_R2:
						var push := (1.0 - nd / SEPARATE_R) * SEPARATE
						fx -= nx / nd * push
						fy -= ny / nd * push
					else:
						var tang := (1.0 - nd / NEIGHBOR_R) * SWIRL
						fx += -ny / nd * tang
						fy += nx / nd * tang
		if count > 0:
			cx /= count
			cy /= count
			var tx := cx - xi
			var ty := cy - yi
			var td := sqrt(maxf(tx * tx + ty * ty, 0.01))
			var cw := COHESION * minf(1.0, td / NEIGHBOR_R)
			fx += tx / td * cw
			fy += ty / td * cw
			vxi = lerpf(vxi, avx / count, ALIGN * DT)
			vyi = lerpf(vyi, avy / count, ALIGN * DT)

		# Rule 3a: poison repels and drains.
		for k in nq:
			var dx := xi - float(qx[k])
			var dy := yi - float(qy[k])
			var d2 := dx * dx + dy * dy
			if d2 < POISON_R2 and d2 > 4.0:
				var d := sqrt(d2)
				var w := (1.0 - d / POISON_R) * float(qw[k])
				fx += dx / d * POISON_PUSH * w
				fy += dy / d * POISON_PUSH * w
				ei -= POISON_DRAIN * w * DT

		# Rule 3b: ambient decay.
		ei -= E_DECAY * DT

		vxi += fx * DT
		vyi += fy * DT
		var sp := sqrt(vxi * vxi + vyi * vyi)
		if sp > V_MAX:
			vxi *= V_MAX / sp
			vyi *= V_MAX / sp
		xi += vxi * DT
		yi += vyi * DT
		if xi < 6.0:
			xi = 6.0
			vxi = absf(vxi) * 0.6
		elif xi > FIELD_W - 6.0:
			xi = FIELD_W - 6.0
			vxi = -absf(vxi) * 0.6
		if yi < 6.0:
			yi = 6.0
			vyi = absf(vyi) * 0.6
		elif yi > FIELD_H - 6.0:
			yi = FIELD_H - 6.0
			vyi = -absf(vyi) * 0.6

		px[i] = xi
		py[i] = yi
		vx[i] = vxi
		vy[i] = vyi
		age[i] = age[i] + 1

		if ei <= 0.0:
			dead.append(i)
			energy[i] = 0.0
		elif ei >= E_SPLIT and int(age[i]) >= AGE_SPLIT_MIN and births < room:
			# Split: parent keeps half energy; child gets deterministic direction.
			var ang := _hash01(seed, int(state["pid"][i]), tick + 7) * TAU
			var nvx := cos(ang) * 46.0
			var nvy := sin(ang) * 46.0
			var half := ei * 0.5
			energy[i] = half
			vx[i] = vxi - nvx * 0.5
			vy[i] = vyi - nvy * 0.5
			px.append(xi + cos(ang) * 6.0)
			py.append(yi + sin(ang) * 6.0)
			vx.append(nvx)
			vy.append(nvy)
			energy.append(half)
			age.append(0)
			state["pid"].append(next_id)
			next_id += 1
			births += 1
		else:
			energy[i] = clampf(ei, 0.0, E_MAX)

	# Remove dead particles, highest index first. With packed arrays, swap-with-
	# last then pop is O(1) per removal; index order must not matter afterwards,
	# and neighbor relationships are positional so order is irrelevant.
	if dead.size() > 0:
		dead.sort()
		for k in range(dead.size() - 1, -1, -1):
			var idx := int(dead[k])
			var last := px.size() - 1
			if idx != last:
				px[idx] = px[last]
				py[idx] = py[last]
				vx[idx] = vx[last]
				vy[idx] = vy[last]
				energy[idx] = energy[last]
				age[idx] = age[last]
				state["pid"][idx] = state["pid"][last]
			px.resize(px.size() - 1)
			py.resize(py.size() - 1)
			vx.resize(vx.size() - 1)
			vy.resize(vy.size() - 1)
			energy.resize(energy.size() - 1)
			age.resize(age.size() - 1)
			state["pid"].resize(state["pid"].size() - 1)

	var new_count := px.size()
	state["count"] = new_count
	state["next_id"] = next_id
	state["peak"] = maxi(int(state["peak"]), new_count)

	tick += 1
	state["tick"] = tick
	_expire_zones(state, tick)

	if tick % DETECT_EVERY == 0 and new_count > 0:
		_detect(state)

	var ended := ""
	if tick >= MAX_TICKS:
		ended = "观测时间结束"
	elif new_count == 0:
		ended = "尘埃全部消散了"
	if ended != "":
		state["status"] = "finished"
		state["reason"] = ended
		state["score"] = score(state)
	return {"changed": true, "ended": ended}


func score(state: Dictionary) -> int:
	var ph: Dictionary = state["phenomena"]
	var seconds := (int(ph["nebula"]) + int(ph["vortex"]) + int(ph["flow"])) / 30
	var kinds := 0
	for k in ph:
		if int(ph[k]) > 0:
			kinds += 1
	var best_streak := 0
	for k in state["streak_best"]:
		best_streak = maxi(best_streak, int(state["streak_best"][k]))
	# Brevity bonus: ending the round early with survivors means the player
	# found a compact outcome instead of one long vortex slog.
	var brevity := maxi(0, (MAX_TICKS - int(state["tick"])) / 30)
	var alive_bonus := int(state["count"]) / 2
	var goal_bonus := GOAL_BONUS if bool(state["goal"]["done"]) else 0
	return seconds * 10 + kinds * 120 + best_streak / 3 + brevity + alive_bonus + goal_bonus + int(state["peak"])


func result_text(state: Dictionary) -> String:
	var names := {"nebula": "星云", "vortex": "漩涡", "flow": "流动群落"}
	var seen: Array[String] = []
	for k in names:
		if int(state["phenomena"][k]) > 0:
			seen.append("%s %.1f秒" % [names[k], int(state["phenomena"][k]) / 30.0])
	if seen.is_empty():
		seen.append("未形成稳定结构")
	var best := 0
	for k in state["streak_best"]:
		best = maxi(best, int(state["streak_best"][k]))
	var goal: Dictionary = state["goal"]
	return "《微尘》观测记录\n种子 %d · 得分 %d\n目标：%s %s\n现象：%s\n尘埃峰值 %d · 最长稳定 %.1f秒\n本局干预：光%d / 毒%d · 观测 %.1f秒\n存活 %d/%d\n" % [
		int(state["seed"]), score(state),
		goal["label"], "✓" if bool(goal["done"]) else "✗",
		"、".join(seen),
		int(state["peak"]), best / 30.0,
		LIGHT_BUDGET - int(state["light_budget"]),
		POISON_BUDGET - int(state["poison_budget"]),
		int(state["tick"]) / 30.0,
		int(state["count"]), MAX_PARTICLES,
	]


func result_baseline(state: Dictionary) -> String:
	# Run a no-intervention round on the same seed and diff phenomena against
	# the actual round, so the player sees what THEIR placements caused.
	var names := {"nebula": "星云", "vortex": "漩涡", "flow": "流动群落"}
	var base := new_round(int(state["seed"]))
	var limit := int(state["tick"])
	for i in limit:
		if base["status"] != "observing":
			break
		step(base)
	var gained: Array = []
	var lost: Array = []
	for k in names:
		var with_them := int(state["phenomena"][k]) > 0
		var without := int(base["phenomena"][k]) > 0
		if with_them and not without:
			gained.append(names[k])
		elif without and not with_them:
			lost.append(names[k])
	if gained.is_empty() and lost.is_empty():
		return ""
	var parts: Array = []
	if not gained.is_empty():
		parts.append("你多养出了：%s" % "、".join(gained))
	if not lost.is_empty():
		parts.append("你放跑了：%s" % "、".join(lost))
	return "（对比同种子不放任何东西：%s）" % "；".join(parts)


func serialize_state(state: Dictionary) -> Dictionary:
	# Quantized, JSON-safe deep copy: floats rounded to 4 decimals so a
	# parse→stringify round trip is bit-stable and replays stay identical.
	var out: Dictionary = state.duplicate(true)
	for key in ["x", "y", "vx", "vy", "energy"]:
		var src: PackedFloat32Array = state[key]
		var dst: Array = []
		dst.resize(src.size())
		for i in src.size():
			dst[i] = snappedf(src[i], 1.0 / QUANT)
		out[key] = dst
	for key in ["age", "pid"]:
		var src2: PackedInt32Array = state[key]
		var dst2: Array = []
		dst2.resize(src2.size())
		for i in src2.size():
			dst2[i] = src2[i]
		out[key] = dst2
	for key in ["lights", "poisons", "inputs"]:
		var zones: Array = out[key]
		for i in zones.size():
			var z: Dictionary = zones[i]
			var q := {}
			for zk in z:
				var v: Variant = z[zk]
				q[zk] = snappedf(float(v), 1.0 / QUANT) if v is float else v
			zones[i] = q
	return out


func deserialize_state(data: Variant) -> Dictionary:
	if not data is Dictionary:
		return {}
	var d: Dictionary = data
	if not d.get("seed") is float and not d.get("seed") is int:
		return {}
	if not d.get("x") is Array or not d.get("y") is Array:
		return {}
	var n: int = (d["x"] as Array).size()
	if (d["y"] as Array).size() != n or (d.get("vx", []) as Array).size() != n or (d.get("vy", []) as Array).size() != n:
		return {}
	var fresh := new_round(int(d["seed"]))
	for key in fresh:
		if not d.has(key):
			continue
		if ["x", "y", "vx", "vy", "energy"].has(key):
			var arr: PackedFloat32Array = PackedFloat32Array()
			arr.resize(n)
			var src: Array = d[key]
			for i in n:
				arr[i] = float(src[i])
			fresh[key] = arr
		elif ["age", "pid"].has(key):
			var arr2 := PackedInt32Array()
			arr2.resize(n)
			var src2: Array = d[key]
			for i in n:
				arr2[i] = int(src2[i])
			fresh[key] = arr2
		else:
			fresh[key] = d[key]
	fresh["count"] = n
	return fresh


func _expire_zones(state: Dictionary, tick: int) -> void:
	for key in ["lights", "poisons"]:
		var kept: Array = []
		for z in state[key]:
			if tick - int(z["born"]) < ZONE_TTL:
				kept.append(z)
		state[key] = kept


func _detect(state: Dictionary) -> void:
	# Union-find over CLUSTER_R links, then classify each cluster.
	var px: PackedFloat32Array = state["x"]
	var py: PackedFloat32Array = state["y"]
	var vx: PackedFloat32Array = state["vx"]
	var vy: PackedFloat32Array = state["vy"]
	var n: int = state["count"]
	var parent := PackedInt32Array()
	parent.resize(n)
	for i in n:
		parent[i] = i
	var grid := _grid_build(px, py, n)
	var start: PackedInt32Array = grid["start"]
	var order: PackedInt32Array = grid["order"]
	for i in n:
		var ccx := int(px[i] / CELL_SIZE)
		var ccy := int(py[i] / CELL_SIZE)
		for oy in range(-1, 2):
			var yy := ccy + oy
			if yy < 0 or yy >= GRID_H:
				continue
			var row := yy * GRID_W
			for ox in range(-1, 2):
				var xx := ccx + ox
				if xx < 0 or xx >= GRID_W:
					continue
				var c := row + xx
				var s: int = start[c]
				var e: int = start[c + 1]
				for idx in range(s, e):
					var j := int(order[idx])
					if j <= i:
						continue
					var dx := px[j] - px[i]
					var dy := py[j] - py[i]
					if dx * dx + dy * dy <= CLUSTER_R2:
						_union(parent, i, j)
	var clusters := {}
	for i in n:
		var root := _find(parent, i)
		if not clusters.has(root):
			clusters[root] = []
		clusters[root].append(i)

	var found := {}
	var found_list: Array = []
	for root in clusters:
		var members: Array = clusters[root]
		var size := members.size()
		if size < FLOW_MIN_SIZE:
			continue
		var cx := 0.0
		var cy := 0.0
		for i in members:
			cx += px[i]
			cy += py[i]
		cx /= size
		cy /= size
		var mean_r := 0.0
		var mean_speed := 0.0
		var spin := 0.0
		var coh_x := 0.0
		var coh_y := 0.0
		for i in members:
			var rx := px[i] - cx
			var ry := py[i] - cy
			var r := sqrt(rx * rx + ry * ry)
			mean_r += r
			var vxi := vx[i]
			var vyi := vy[i]
			var s := sqrt(vxi * vxi + vyi * vyi)
			mean_speed += s
			if r > 4.0:
				# z of (radial_unit × velocity): signed swirl measure
				spin += (rx / r * vyi - ry / r * vxi)
			if s > 1.0:
				coh_x += vxi / s
				coh_y += vyi / s
		mean_r /= size
		mean_speed /= size
		var coherence := sqrt(coh_x * coh_x + coh_y * coh_y) / size
		var spin_norm := absf(spin) / maxf(1.0, mean_speed * size)

		if size >= NEBULA_MIN_SIZE and mean_r <= NEBULA_MAX_RADIUS and coherence < 0.45:
			found["nebula"] = true
			found_list.append({"label": "nebula", "x": cx, "y": cy, "r": mean_r})
		if size >= VORTEX_MIN_SIZE and spin_norm >= VORTEX_MIN_SPIN and mean_r <= NEBULA_MAX_RADIUS * 1.8:
			found["vortex"] = true
			found_list.append({"label": "vortex", "x": cx, "y": cy, "r": mean_r})
		if size >= FLOW_MIN_SIZE and coherence >= FLOW_MIN_COHERENCE and mean_speed >= FLOW_MIN_SPEED:
			found["flow"] = true
			found_list.append({"label": "flow", "x": cx, "y": cy, "r": mean_r})

	# One highlight per label: the strongest signal is the first cluster found.
	var uniq := {}
	var highlights: Array = []
	for entry in found_list:
		if not uniq.has(entry["label"]):
			uniq[entry["label"]] = true
			highlights.append(entry)
	state["phenomenon_now"] = uniq.keys()
	state["highlights"] = highlights
	for k in ["nebula", "vortex", "flow"]:
		if found.has(k):
			state["phenomena"][k] = int(state["phenomena"][k]) + DETECT_EVERY
			state["streak"][k] = int(state["streak"][k]) + DETECT_EVERY
			state["streak_best"][k] = maxi(int(state["streak_best"][k]), int(state["streak"][k]))
		else:
			state["streak"][k] = 0
	if not found.is_empty():
		state["stable_ticks"] = int(state["stable_ticks"]) + DETECT_EVERY
	_check_goal(state)


func _check_goal(state: Dictionary) -> void:
	var goal: Dictionary = state["goal"]
	if bool(goal["done"]):
		return
	var met := false
	if goal["kind"] == "kinds":
		var kinds := 0
		for k in state["phenomena"]:
			if int(state["phenomena"][k]) > 0:
				kinds += 1
		met = kinds >= int(goal["target"])
	elif state["phenomena"].has(goal["kind"]):
		met = int(state["phenomena"][goal["kind"]]) >= int(goal["target"])
	if met:
		goal["done"] = true
		goal["done_tick"] = int(state["tick"])


func _grid_build(px: PackedFloat32Array, py: PackedFloat32Array, n: int) -> Dictionary:
	# Counting sort into flat cell offsets. Particles are clamped to the field,
	# so cell indices are always in range.
	var start := PackedInt32Array()
	start.resize(GRID_W * GRID_H + 1)
	var count := PackedInt32Array()
	count.resize(GRID_W * GRID_H)
	for i in n:
		var cx := int(px[i] / CELL_SIZE)
		var cy := int(py[i] / CELL_SIZE)
		count[cy * GRID_W + cx] += 1
	var sum := 0
	for c in GRID_W * GRID_H:
		start[c] = sum
		sum += count[c]
	start[GRID_W * GRID_H] = sum
	var cursor := PackedInt32Array()
	cursor.resize(GRID_W * GRID_H)
	for c in GRID_W * GRID_H:
		cursor[c] = start[c]
	var order := PackedInt32Array()
	order.resize(n)
	for i in n:
		var cx2 := int(px[i] / CELL_SIZE)
		var cy2 := int(py[i] / CELL_SIZE)
		var c2 := cy2 * GRID_W + cx2
		order[cursor[c2]] = i
		cursor[c2] += 1
	return {"start": start, "order": order}


func _find(parent: PackedInt32Array, i: int) -> int:
	while parent[i] != i:
		parent[i] = parent[parent[i]]
		i = parent[i]
	return i


func _union(parent: PackedInt32Array, a: int, b: int) -> void:
	var ra := _find(parent, a)
	var rb := _find(parent, b)
	if ra != rb:
		parent[max(ra, rb)] = min(ra, rb)


func _hash01(a: int, b: int, c: int) -> float:
	# Integer mix → [0,1). Deterministic across platforms.
	var h := int(a) * 374761393 + int(b) * 668265263 + int(c) * 1442695041
	h = (h ^ (h >> 13)) * 1274126177
	h = h ^ (h >> 16)
	return float(h & 0x7fffffff) / float(0x7fffffff)
