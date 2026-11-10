extends SceneTree
## Headless visual proof: run N ticks, then render the field state to PNG.
## Usage: godot --headless --script res://tests/render_field.gd -- --ticks=300 --out=/tmp/f.png

const Sim := preload("res://scripts/dust_sim.gd")
const Field := preload("res://scripts/dust_field.gd")

func _initialize() -> void:
	var args := {}
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--"):
			var kv := a.trim_prefix("--").split("=", true, 1)
			args[kv[0]] = kv[1] if kv.size() > 1 else "1"
	var ticks := int(args.get("ticks", "300"))
	var seed := int(args.get("seed", "11"))
	var out := str(args.get("out", "/tmp/weichen.png"))
	var lights := str(args.get("lights", "600,410"))
	var poisons := str(args.get("poisons", ""))

	var sim = Sim.new()
	var state := sim.new_round(seed)
	for p in lights.split(";", false):
		var xy := p.split(",")
		sim.apply_tool(state, "light", float(xy[0]), float(xy[1]))
	for p in poisons.split(";", false):
		var xy2 := p.split(",")
		sim.apply_tool(state, "poison", float(xy2[0]), float(xy2[1]))
	for i in ticks:
		if state["status"] != "observing":
			break
		sim.step(state)

	var img := Image.create(int(Sim.FIELD_W), int(Sim.FIELD_H), false, Image.FORMAT_RGBA8)
	img.fill(Color(0.027, 0.051, 0.078))
	# stars
	for i in 64:
		var sx := fposmod(float(i * 73.31 + 17.7), Sim.FIELD_W)
		var sy := fposmod(float(i * 131.77 + 5.1), Sim.FIELD_H)
		img.set_pixel(int(sx), int(sy), Color(0.7, 0.8, 0.9, 0.3))
	# zones
	for z in state["lights"]:
		var c := Vector2(float(z["x"]), float(z["y"]))
		for r in range(int(Sim.LIGHT_R), 0, -8):
			var a := 0.10 * (1.0 - float(r) / Sim.LIGHT_R)
			_draw_circle(img, c, r, Color(1.0, 0.82, 0.42, a))
		_draw_circle(img, c, 8, Color(1.0, 0.88, 0.55, 1.0))
	for z in state["poisons"]:
		var c2 := Vector2(float(z["x"]), float(z["y"]))
		for r in range(int(Sim.POISON_R), 0, -8):
			var a2 := 0.08 * (1.0 - float(r) / Sim.POISON_R)
			_draw_circle(img, c2, r, Color(0.5, 0.1, 0.6, a2))
	# particles
	var xs: PackedFloat32Array = state["x"]
	var ys: PackedFloat32Array = state["y"]
	var es: PackedFloat32Array = state["energy"]
	for i in int(state["count"]):
		var e := clampf(es[i] / Sim.E_SPLIT, 0.15, 1.2)
		var col := Color(0.45 + 0.55 * minf(e, 1.0), 0.62 + 0.3 * e, 1.0, 1.0)
		_draw_disc(img, Vector2(xs[i], ys[i]), 3.0, col)
	img.save_png(out)
	print("saved %s tick=%d count=%d ph=%s" % [out, int(state["tick"]), int(state["count"]), state["phenomena"]])
	quit()

func _inside(img: Image, p: Vector2) -> bool:
	return p.x >= 0.0 and p.y >= 0.0 and p.x < img.get_width() and p.y < img.get_height()


func _draw_circle(img: Image, c: Vector2, r: int, col: Color) -> void:
	for ang in range(0, 360, 3):
		var p := c + Vector2(cos(deg_to_rad(ang)) * r, sin(deg_to_rad(ang)) * r)
		if _inside(img, p):
			var cur := img.get_pixelv(p)
			img.set_pixelv(p, cur.blend(col))

func _draw_disc(img: Image, c: Vector2, r: float, col: Color) -> void:
	for dx in range(-int(r), int(r) + 1):
		for dy in range(-int(r), int(r) + 1):
			if dx * dx + dy * dy <= r * r:
				var p := c + Vector2(dx, dy)
				if _inside(img, p):
					img.set_pixelv(p, col)
