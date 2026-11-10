extends Control
## 微尘 field renderer — everything drawn procedurally in _draw().
## Reads the sim's parallel packed arrays directly; no image assets,
## no particle nodes, no shaders; Android GL-compatible.

signal field_pressed(pos: Vector2, button: int)

const Sim := preload("res://scripts/dust_sim.gd")

const HIGHLIGHT_STYLE := {
	"nebula": {"name": "星云", "color": Color(0.98, 0.86, 0.62)},
	"vortex": {"name": "漩涡", "color": Color(0.55, 0.92, 1.0)},
	"flow": {"name": "流动群落", "color": Color(0.62, 1.0, 0.72)},
}

var state: Dictionary = {}
var reduced_motion := false
var high_contrast := false
var _trails: Dictionary = {} # pid -> Array of recent Vector2
var _stars: Array = []
var _bursts: Array = [] # {pos, color, radius, age, ttl} placement shockwaves
var _births: Array = [] # {pos, age, ttl} newborn particle sparkles


func _ready() -> void:
	mouse_filter = MOUSE_FILTER_STOP
	# Static background stars are decorative only — fixed layout, computed once.
	for i in 64:
		_stars.append(Vector2(
			fposmod(float(i * 73.31 + 17.7), Sim.FIELD_W),
			fposmod(float(i * 131.77 + 5.1), Sim.FIELD_H)))


func set_state(s: Dictionary) -> void:
	state = s
	queue_redraw()


func add_burst(world_pos: Vector2, tool: String) -> void:
	# Placement shockwave: expanding ring that fades, purely cosmetic.
	_bursts.append({
		"pos": world_pos,
		"color": Color(1.0, 0.85, 0.45) if tool == "light" else Color(0.75, 0.4, 1.0),
		"radius": 20.0,
		"age": 0.0,
		"ttl": 0.55,
	})


func add_birth(world_pos: Vector2) -> void:
	_births.append({"pos": world_pos, "age": 0.0, "ttl": 0.4})


func set_reduced_motion(on: bool) -> void:
	reduced_motion = on
	if on:
		_trails.clear()
	queue_redraw()


func set_high_contrast(on: bool) -> void:
	high_contrast = on
	queue_redraw()


func _process(delta: float) -> void:
	# Advance cosmetic effect timers; skip entirely in reduced-motion mode.
	var dirty := false
	for b in _bursts:
		b["age"] = float(b["age"]) + delta
		b["radius"] = float(b["radius"]) + delta * 380.0
	for b in _births:
		b["age"] = float(b["age"]) + delta
	_bursts = _bursts.filter(func(b): return float(b["age"]) < float(b["ttl"]))
	_births = _births.filter(func(b): return float(b["age"]) < float(b["ttl"]))
	if not _bursts.is_empty() or not _births.is_empty():
		dirty = true
	if dirty:
		queue_redraw()


func field_to_world(pos: Vector2) -> Vector2:
	var sc := minf(size.x / Sim.FIELD_W, size.y / Sim.FIELD_H)
	var off := (size - Vector2(Sim.FIELD_W, Sim.FIELD_H) * sc) * 0.5
	var w := (pos - off) / sc
	if w.x < 0.0 or w.y < 0.0 or w.x > Sim.FIELD_W or w.y > Sim.FIELD_H:
		return Vector2(-1, -1)
	return w


func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_LEFT or event.button_index == MOUSE_BUTTON_RIGHT:
			emit_signal("field_pressed", event.position, event.button_index)
	elif event is InputEventScreenTouch and event.pressed:
		if event.index != InputEvent.DEVICE_ID_EMULATION:
			emit_signal("field_pressed", event.position, MOUSE_BUTTON_LEFT)


func _energy_color(e: float) -> Color:
	# Temperature spectrum over normalized energy:
	#   e < 0.35  dying ember — dim red
	#   e ≈ 0.6   calm dust — blue-white
	#   e ≥ 1.0   split-ready — gold, with a warm halo ring
	var hue: float
	var sat: float
	var val: float
	if e < 0.35:
		# Red ember fading toward dark.
		hue = 0.02
		sat = 0.85
		val = 0.35 + e * 0.9
	elif e < 0.8:
		# Ember → blue-white: sweep through violet/indigo between 0.35-0.6.
		var t := clampf((e - 0.35) / 0.25, 0.0, 1.0)
		hue = lerpf(0.02, 0.60, t * t)
		sat = lerpf(0.85, 0.30, t)
		val = lerpf(0.66, 0.95, t)
	else:
		# Blue-white → gold as it approaches split.
		var t2 := clampf((e - 0.8) / 0.4, 0.0, 1.0)
		hue = lerpf(0.60, 0.12, t2)
		sat = lerpf(0.30, 0.55, t2)
		val = 0.95 + 0.05 * t2
	var alpha := 0.52 + 0.48 * minf(e, 1.0)
	return Color.from_hsv(hue, sat, minf(val, 1.0), alpha)


func _draw() -> void:
	var rect := Rect2(Vector2.ZERO, size)
	var sc := minf(size.x / Sim.FIELD_W, size.y / Sim.FIELD_H)
	var off := (size - Vector2(Sim.FIELD_W, Sim.FIELD_H) * sc) * 0.5

	# Deep-space backdrop: two tinted nebulas (teal + faint magenta) for depth,
	# instead of one flat blue-black field.
	draw_rect(rect, Color(0.027, 0.051, 0.078))
	for i in range(4, 0, -1):
		var f := float(i) / 4.0
		draw_circle(off + Vector2(Sim.FIELD_W * 0.34, Sim.FIELD_H * 0.30) * sc,
			Sim.FIELD_W * 0.42 * sc * f, Color(0.05, 0.16, 0.17, 0.055))
		draw_circle(off + Vector2(Sim.FIELD_W * 0.70, Sim.FIELD_H * 0.66) * sc,
			Sim.FIELD_W * 0.38 * sc * f, Color(0.14, 0.07, 0.16, 0.05))
	for star in _stars:
		draw_circle(off + star * sc, 1.2 * sc + 0.6, Color(0.7, 0.8, 0.9, 0.14))

	if state.is_empty():
		return
	var tick := int(state.get("tick", 0))

	# Placement shockwaves: expanding ring, fading fast — immediate cause/effect.
	if not reduced_motion:
		for b in _bursts:
			var t := float(b["age"]) / float(b["ttl"])
			var col: Color = b["color"]
			var bc := off + (b["pos"] as Vector2) * sc
			draw_arc(bc, float(b["radius"]) * sc, 0.0, TAU, 32,
				Color(col.r, col.g, col.b, (1.0 - t) * 0.55), 2.5, true)
		for b in _births:
			var t2 := float(b["age"]) / float(b["ttl"])
			var bc2 := off + (b["pos"] as Vector2) * sc
			draw_circle(bc2, (6.0 + 10.0 * t2) * sc, Color(0.9, 1.0, 1.0, (1.0 - t2) * 0.5))

	# Zones: light = warm halo with breathing ring, poison = cold broken ring.
	var breathe := 1.0 if reduced_motion else 0.94 + 0.06 * sin(tick * 0.09)
	for z in state.get("lights", []):
		var age := tick - int(z["born"])
		var power := minf(1.0, age / 30.0) * (1.0 - float(age) / float(Sim.ZONE_TTL))
		var c := off + Vector2(float(z["x"]), float(z["y"])) * sc
		var rr := Sim.LIGHT_R * sc * breathe
		for i in range(3, 0, -1):
			var f := float(i) / 3.0
			draw_circle(c, rr * f, Color(1.0, 0.82, 0.42, 0.05 * power * (1.4 - f)))
		draw_circle(c, 7.0 * sc, Color(1.0, 0.88, 0.55, 0.95))
		draw_arc(c, rr, 0.0, TAU, 48, Color(1.0, 0.83, 0.4, (0.55 if high_contrast else 0.3) * power), 2.0)
	for z in state.get("poisons", []):
		var age := tick - int(z["born"])
		var power := minf(1.0, age / 30.0) * (1.0 - float(age) / float(Sim.ZONE_TTL))
		var c := off + Vector2(float(z["x"]), float(z["y"])) * sc
		var rr := Sim.POISON_R * sc * breathe
		for i in range(3, 0, -1):
			var f := float(i) / 3.0
			draw_circle(c, rr * f, Color(0.45, 0.1, 0.55, 0.05 * power * (1.4 - f)))
		draw_arc(c, rr, 0.0, TAU, 48, Color(0.75, 0.35, 0.95, (0.65 if high_contrast else 0.38) * power), 2.0, true)
		if not reduced_motion:
			draw_arc(c, rr * 0.55, tick * 0.02, tick * 0.02 + TAU * 0.7, 32,
				Color(0.7, 0.3, 0.9, 0.35 * power), 1.5)

	# Phenomenon highlights: dashed ring + label at the detected cluster, so
	# the HUD tag and the thing the player sees are the same object.
	for h in state.get("highlights", []):
		var style: Dictionary = HIGHLIGHT_STYLE.get(h["label"], {})
		if style.is_empty():
			continue
		var col: Color = style["color"]
		var c := off + Vector2(float(h["x"]), float(h["y"])) * sc
		var rr := (float(h["r"]) + 16.0) * sc
		if not reduced_motion:
			rr += sin(tick * 0.15) * 3.0 * sc
		var alpha := 0.7 if high_contrast else 0.45
		# Two opposite arcs read as a dashed ring without per-segment draws.
		draw_arc(c, rr, tick * 0.03, tick * 0.03 + PI * 0.85, 24, Color(col.r, col.g, col.b, alpha), 1.8, true)
		draw_arc(c, rr, tick * 0.03 + PI, tick * 0.03 + PI * 1.85, 24, Color(col.r, col.g, col.b, alpha), 1.8, true)
		var label_pos := c + Vector2(-rr, -rr - 8.0 * sc)
		draw_string(ThemeDB.fallback_font, label_pos, str(style["name"]),
			HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Color(col.r, col.g, col.b, alpha + 0.2))

	# Particles: color carries meaning — a full temperature spectrum from
	# dying ember (red) through calm dust (blue-white) to split-ready (gold).
	# Brightness follows energy on top of the hue shift.
	var xs: PackedFloat32Array = state.get("x", PackedFloat32Array())
	var ys: PackedFloat32Array = state.get("y", PackedFloat32Array())
	var es: PackedFloat32Array = state.get("energy", PackedFloat32Array())
	var ids: PackedInt32Array = state.get("pid", PackedInt32Array())
	var n: int = int(state.get("count", 0))
	var live_ids := {}
	for i in n:
		var id := int(ids[i])
		live_ids[id] = true
		var pos := off + Vector2(xs[i], ys[i]) * sc
		var e := clampf(es[i] / Sim.E_SPLIT, 0.15, 1.2)
		var col := _energy_color(e)
		if not reduced_motion:
			var trail: Array = _trails.get(id, [])
			trail.append(pos)
			if trail.size() > 9:
				trail.pop_front()
			_trails[id] = trail
			for t in trail.size() - 1:
				var fade := float(t) / float(trail.size())
				draw_line(trail[t], trail[t + 1],
					Color(col.r, col.g, col.b, 0.12 * fade), 1.4 * sc + 0.4)
		var radius := (3.0 + 2.0 * minf(e, 1.0)) * sc
		draw_circle(pos, radius, col)
		if e >= 1.0:
			draw_circle(pos, radius * 2.4, Color(1.0, 0.80, 0.30, 0.16))
			draw_circle(pos, radius * 1.6, Color(1.0, 0.95, 0.75, 0.35))
	for id in _trails.keys():
		if not live_ids.has(id):
			_trails.erase(id)
