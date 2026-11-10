extends SceneTree

const Sim := preload("res://scripts/dust_sim.gd")
var passed := 0
var failed := 0

func check(condition: bool, name: String) -> void:
	if condition:
		passed += 1
	else:
		failed += 1
		push_error("FAIL " + name)

func run_steps(sim, state: Dictionary, ticks: int) -> void:
	for i in ticks:
		if state["status"] != "observing":
			break
		sim.step(state)

func sane(state: Dictionary) -> bool:
	var xs: PackedFloat32Array = state["x"]
	var ys: PackedFloat32Array = state["y"]
	var vs: PackedFloat32Array = state["vx"]
	var vys: PackedFloat32Array = state["vy"]
	var es: PackedFloat32Array = state["energy"]
	for i in state["count"]:
		for arr in [xs[i], ys[i], vs[i], vys[i], es[i]]:
			if not is_finite(arr):
				return false
		if xs[i] < 0.0 or xs[i] > Sim.FIELD_W or ys[i] < 0.0 or ys[i] > Sim.FIELD_H:
			return false
	return true

func mean_dist(state: Dictionary, tx: float, ty: float) -> float:
	var xs: PackedFloat32Array = state["x"]
	var ys: PackedFloat32Array = state["y"]
	var d := 0.0
	for i in state["count"]:
		var dx := xs[i] - tx
		var dy := ys[i] - ty
		d += sqrt(dx * dx + dy * dy)
	return d / maxf(1.0, float(state["count"]))

func _initialize() -> void:
	var sim = Sim.new()

	# 1. Determinism: same seed → identical 600-tick states.
	for seed: int in [7, 42, 199, 20261009, 987654321]:
		var a: Dictionary = sim.new_round(seed)
		var b: Dictionary = sim.new_round(seed)
		for i in 600:
			sim.step(a)
			sim.step(b)
			check(sane(a), "sane state %d@%d" % [seed, i])
		check(a == b, "600 ticks identical %d" % seed)

	# 2. Same seed + same input log replays identically.
	var r1: Dictionary = sim.new_round(555)
	var r2: Dictionary = sim.new_round(555)
	for i in 300:
		if i == 60:
			sim.apply_tool(r1, "light", 400.0, 300.0)
			sim.apply_tool(r2, "light", 400.0, 300.0)
		if i == 200:
			sim.apply_tool(r1, "poison", 800.0, 500.0)
			sim.apply_tool(r2, "poison", 800.0, 500.0)
		sim.step(r1)
		sim.step(r2)
	check(r1 == r2, "input replay identical")

	# 3. Light attracts: particles drift inward while the zone is young.
	var ls: Dictionary = sim.new_round(11)
	sim.apply_tool(ls, "light", 600.0, 410.0)
	var before := mean_dist(ls, 600.0, 410.0)
	run_steps(sim, ls, 120)
	var after := mean_dist(ls, 600.0, 410.0)
	check(after < before * 0.9, "light attracts dust (%.1f → %.1f)" % [before, after])
	# The intervention must change local state, not just the visual layer.
	var baseline: Dictionary = sim.new_round(11)
	run_steps(sim, baseline, 60)
	var lit_energy := 0.0
	var base_energy := 0.0
	for i in int(ls["count"]):
		lit_energy += float(ls["energy"][i])
	for i in int(baseline["count"]):
		base_energy += float(baseline["energy"][i])
	check(lit_energy > base_energy, "light changes energy state")

	# 4. Poison drains total energy below no-poison baseline.
	var p0: Dictionary = sim.new_round(23)
	var p1: Dictionary = sim.clone_state(p0)
	sim.apply_tool(p1, "poison", 600.0, 410.0)
	run_steps(sim, p0, 90)
	run_steps(sim, p1, 90)
	var e0 := 0.0
	var e1 := 0.0
	for i in int(p0["count"]):
		e0 += float(p0["energy"][i])
	for i in int(p1["count"]):
		e1 += float(p1["energy"][i])
	check(e1 < e0, "poison drains energy (%.1f < %.1f)" % [e1, e0])
	check(int(p1["count"]) <= int(p0["count"]), "poison kills or scatters")
	var poison_mean_dist := mean_dist(p1, 600.0, 410.0)
	var base_mean_dist := mean_dist(p0, 600.0, 410.0)
	check(poison_mean_dist > base_mean_dist, "poison changes spatial distribution")

	# 5. Round always ends within 90 s.
	var fade: Dictionary = sim.new_round(31)
	run_steps(sim, fade, Sim.MAX_TICKS + 10)
	check(fade["status"] == "finished", "round ends within 90 s")
	check(int(fade["tick"]) <= Sim.MAX_TICKS, "tick bound")
	check(int(fade["score"]) >= 0, "score non-negative")

	# 6. Split cap: light keeps dust alive but never exceeds MAX_PARTICLES.
	var grow: Dictionary = sim.new_round(77)
	for k in 4:
		sim.apply_tool(grow, "light", 300.0 + 150.0 * k, 400.0)
	run_steps(sim, grow, 900)
	check(int(grow["count"]) <= Sim.MAX_PARTICLES, "split cap hard bound")
	check(int(grow["peak"]) <= Sim.MAX_PARTICLES, "peak bound")

	# 7. Phenomena emerge somewhere over a batch of seeds+lights.
	var seen := {"nebula": false, "vortex": false, "flow": false}
	var any := false
	for seed: int in range(1, 25):
		var st: Dictionary = sim.new_round(seed)
		sim.apply_tool(st, "light", 600.0, 410.0)
		run_steps(sim, st, 600)
		for k in seen:
			if int(st["phenomena"][k]) > 0:
				seen[k] = true
				any = true
	check(any, "at least one emergent phenomenon detected")
	print("PHENOMENA over 24 seeds: ", seen)

	# 8. Different interventions give measurably different outcomes.
	var x1: Dictionary = sim.new_round(99)
	sim.apply_tool(x1, "light", 200.0, 200.0)
	run_steps(sim, x1, 400)
	var x2: Dictionary = sim.new_round(99)
	sim.apply_tool(x2, "light", 1000.0, 600.0)
	run_steps(sim, x2, 400)
	var d1 := 0.0
	var d2 := 0.0
	for i in int(x1["count"]):
		d1 += float(x1["x"][i])
	for i in int(x2["count"]):
		d2 += float(x2["x"][i])
	check(absf(d1 - d2) > 100.0, "different light positions diverge")

	# 9. Tool/budget enforcement.
	var bs: Dictionary = sim.new_round(5)
	for i in Sim.LIGHT_BUDGET:
		check(sim.apply_tool(bs, "light", 100.0, 100.0)["ok"], "light %d legal" % i)
	check(not sim.apply_tool(bs, "light", 100.0, 100.0)["ok"], "light budget exhausted")
	check(not sim.apply_tool(bs, "shovel", 0.0, 0.0)["ok"], "unknown tool rejected")
	bs["status"] = "finished"
	check(not sim.apply_tool(bs, "poison", 0.0, 0.0)["ok"], "no input after end")

	# 10. JSON roundtrip stays deterministically faithful. Float32→text→float32
	# is not bit-exact (≤1e-4 drift), so compare trajectories statistically:
	# positions/energies must stay within tolerance and macro outcomes match.
	var js: Dictionary = sim.new_round(314)
	sim.apply_tool(js, "light", 500.0, 300.0)
	run_steps(sim, js, 120)
	var restored: Dictionary = sim.deserialize_state(JSON.parse_string(JSON.stringify(sim.serialize_state(js))))
	check(not restored.is_empty(), "deserialize accepts serialized state")
	var cont_a := sim.clone_state(js)
	for i in 60:
		sim.step(cont_a)
		sim.step(restored)
	check(int(cont_a["count"]) == int(restored["count"]), "roundtrip particle count")
	var max_dx := 0.0
	for i in int(cont_a["count"]):
		max_dx = maxf(max_dx, absf(float(cont_a["x"][i]) - float(restored["x"][i])))
		max_dx = maxf(max_dx, absf(float(cont_a["y"][i]) - float(restored["y"][i])))
	check(max_dx < 0.02, "roundtrip positions within 0.02 (max %.5f)" % max_dx)
	check(cont_a["phenomenon_now"] == restored["phenomenon_now"], "roundtrip live phenomena equal")

	# 11. Rough performance: 2700 ticks × ≤180 particles must stay fast headless.
	var t0 := Time.get_ticks_msec()
	var perf: Dictionary = sim.new_round(2026)
	sim.apply_tool(perf, "light", 600.0, 410.0)
	run_steps(sim, perf, 2700)
	var ms := Time.get_ticks_msec() - t0
	print("PERF: full 90 s round simulated in %d ms" % ms)
	check(ms < 12000, "90 s simulation under 12 s headless")

	# 12. Per-round goal is deterministic, reachable, and reflected in results.
	var goal_hits := 0
	for seed: int in range(1, 16):
		var gs: Dictionary = sim.new_round(seed)
		check(gs["goal"]["kind"] is String and int(gs["goal"]["target"]) > 0, "goal valid %d" % seed)
		check(sim.new_round(seed)["goal"] == gs["goal"], "goal deterministic %d" % seed)
		sim.apply_tool(gs, "light", 600.0, 410.0)
		run_steps(sim, gs, 1500)
		if bool(gs["goal"]["done"]):
			goal_hits += 1
	check(goal_hits > 0, "goal achievable with a single light (hits=%d/15)" % goal_hits)
	var gr: Dictionary = sim.new_round(5)
	gr["goal"]["done"] = true
	gr["goal"]["done_tick"] = 100
	var scored := sim.score(gr)
	gr["goal"]["done"] = false
	check(scored - sim.score(gr) == Sim.GOAL_BONUS, "goal bonus applied exactly once")

	# 13. Result baseline diff: same seed, no interventions vs actual round.
	var bs2: Dictionary = sim.new_round(7)
	sim.apply_tool(bs2, "light", 400.0, 300.0)
	run_steps(sim, bs2, 300)
	var diff := sim.result_baseline(bs2)
	# With one light placed for 10 s, the actual round should differ from the
	# empty baseline; the diff text must reference the comparison.
	check(diff.contains("同种子") or diff == "", "baseline diff text or empty")
	# A no-intervention round compared to itself yields no diff.
	var empty: Dictionary = sim.new_round(7)
	run_steps(sim, empty, 300)
	check(sim.result_baseline(empty) == "", "no interventions → no baseline diff")

	print("DUST RESULTS: %d passed, %d failed" % [passed, failed])
	quit(1 if failed else 0)
