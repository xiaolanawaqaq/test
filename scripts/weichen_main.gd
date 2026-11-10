extends Control
## 微尘 main scene controller.
## Fixed 30 Hz simulation ticks decoupled from render FPS; same input log
## replays identically. UI is built in code so the .tscn stays one node.

const Sim := preload("res://scripts/dust_sim.gd")
const Field := preload("res://scripts/dust_field.gd")
const SPEED_STEPS := [1, 2, 4]
const PHENOMENON_NAMES := {"nebula": "星云", "vortex": "漩涡", "flow": "流动群落"}

# Procedurally synthesized audio (tools/generate_music.py) — no third-party
# samples. Base drone always runs; the "alive" layer fades in while phenomena
# are present, so the music mirrors what the dust is doing.
const MUSIC_BASE_DB := -14.0
const MUSIC_ALIVE_DB := -17.0
const MUSIC_ALIVE_OFF_DB := -60.0
const MUSIC_FADE_DB_PER_SEC := 28.0 # full bloom (~43 dB) in about 1.5 s
const SFX_STREAMS := {
	"light": "res://assets/audio/sfx_light.wav",
	"poison": "res://assets/audio/sfx_poison.wav",
	"phenomenon": "res://assets/audio/sfx_phenomenon.wav",
}
const CLICK_STREAM := "res://assets/audio/sfx_click.wav"
const CLICK_DB := -13.0 # light touch: crisp but clearly background-level
const SFX_DB := {"click": CLICK_DB} # everything else plays at 0 dB

# Opening intro — three-element framing (matter / energy / disturbance) merged
# with what the sim actually does. No virus or infection mechanics promised.
const INTRO_BODY := "尘埃是物质：只感知身边的光，与同伴相互牵引，\n能量充足时分裂，能量耗尽时消散。\n光是能量：吸引尘埃汇聚，让群落生长。\n毒域是扰动：驱散结构、消耗能量，为新的秩序腾出空间。\n\n你无法命令任何一颗尘埃，只能改变它们身处的环境。"

var _sim := Sim.new()
var _state: Dictionary = {}
var _acc := 0.0
var _paused := false
var _speed := 1
var _tool := "light" # Active tool for touch and desktop selection.
var _seed := 20261009
var _replay_inputs: Array = []
var _replay_index := 0
var _replaying := false
var _announced := {}

var _field: Control
var _hud: Label
var _hint: Label
var _result_panel: PanelContainer
var _result_text: Label
var _tool_light: Button
var _tool_poison: Button
var _toast: Label
var _toast_until := 0
var _last_share := ""
var _result_shown := false # Result panel auto-opens once per round only.
var _compact := false
var _goal_label: Label
var _intro: Control
var _touch := false # Touch device: tool buttons shown, taps follow selection.
var _more_open := false
var _speed_btn: Button
var _replay_btn: Button
var _more_btn: Button
var _mute_btn: Button
var _last_count := 0 # For detecting splits (newborn sparkles).
var _music_base: AudioStreamPlayer
var _music_alive: AudioStreamPlayer
var _sfx_pool: Array[AudioStreamPlayer] = []
var _sfx_cursor := 0
var _sfx_streams := {}
var _muted := false


func _ready() -> void:
	_touch = _touch_layout()
	_build_ui()
	_setup_audio()
	_seed = _pick_seed()
	_new_round(_seed)
	get_viewport().size_changed.connect(_relayout)


func _setup_audio() -> void:
	# Base drone loops forever; the alive layer sits near-silent until phenomena.
	_music_base = AudioStreamPlayer.new()
	_music_base.name = "MusicBase"
	_music_base.stream = load("res://assets/audio/ambient_base.wav")
	_music_base.bus = &"Music"
	_music_base.volume_db = MUSIC_BASE_DB
	add_child(_music_base)
	_music_alive = AudioStreamPlayer.new()
	_music_alive.name = "MusicAlive"
	_music_alive.stream = load("res://assets/audio/ambient_alive.wav")
	_music_alive.bus = &"Music"
	_music_alive.volume_db = MUSIC_ALIVE_OFF_DB
	add_child(_music_alive)
	for key in SFX_STREAMS:
		_sfx_streams[key] = load(SFX_STREAMS[key])
	_sfx_streams["click"] = load(CLICK_STREAM)
	for i in 4:
		var p := AudioStreamPlayer.new()
		p.name = "Sfx%d" % i
		p.bus = &"SFX"
		add_child(p)
		_sfx_pool.append(p)
	_music_base.play()
	_music_alive.play()


func _play_sfx(key: String) -> void:
	if _muted or not _sfx_streams.has(key):
		return
	for i in _sfx_pool.size():
		var idx := (_sfx_cursor + i) % _sfx_pool.size()
		var p: AudioStreamPlayer = _sfx_pool[idx]
		if not p.playing:
			p.stream = _sfx_streams[key]
			p.volume_db = float(SFX_DB.get(key, 0.0))
			p.play()
			_sfx_cursor = (idx + 1) % _sfx_pool.size()
			return
	# All voices busy: steal the oldest.
	var steal: AudioStreamPlayer = _sfx_pool[_sfx_cursor]
	steal.stream = _sfx_streams[key]
	steal.volume_db = float(SFX_DB.get(key, 0.0))
	steal.play()
	_sfx_cursor = (_sfx_cursor + 1) % _sfx_pool.size()


func _toggle_mute() -> void:
	_muted = not _muted
	_mute_btn.text = "静音" if _muted else "声音"
	AudioServer.set_bus_mute(AudioServer.get_bus_index("Music"), _muted)
	AudioServer.set_bus_mute(AudioServer.get_bus_index("SFX"), _muted)
	if not _muted:
		# The press-down click was still muted; confirm the return of sound.
		_play_sfx("click")
	_show_toast("已静音（再点恢复）" if _muted else "声音已恢复")


func _update_music_layer(delta: float) -> void:
	# The alive layer fades in while any phenomenon is visible — music follows sim.
	var target := MUSIC_ALIVE_DB if not _state.get("phenomenon_now", []).is_empty() else MUSIC_ALIVE_OFF_DB
	var cur := _music_alive.volume_db
	var step := MUSIC_FADE_DB_PER_SEC * delta
	if absf(target - cur) <= step:
		_music_alive.volume_db = target
	elif target > cur:
		_music_alive.volume_db = minf(target, cur + step)
	else:
		_music_alive.volume_db = maxf(target, cur - step)


func _pick_seed() -> int:
	# Seed choice is allowed to be wall-clock; only same-seed+same-input must replay.
	var t := Time.get_unix_time_from_system()
	return 1 + int(t * 977.0) % 2147483000


# ── UI palette ──────────────────────────────────────────────────────────
# Element colors carry the same meaning as in the field: light = warm gold,
# poison = violet, neutral actions = teal, numbers = pale blue.
const UI_LIGHT := Color(0.98, 0.82, 0.45)
const UI_POISON := Color(0.80, 0.55, 0.98)
const UI_ACTION := Color(0.50, 0.85, 0.85)
const UI_TEXT := Color(0.86, 0.92, 1.0)
const UI_TEXT_DIM := Color(0.65, 0.72, 0.85)


func _flat_style(bg: Color, border: Color) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.border_width_left = 1
	sb.border_width_top = 1
	sb.border_width_right = 1
	sb.border_width_bottom = 1
	sb.border_color = border
	sb.set_corner_radius_all(6)
	sb.content_margin_left = 14.0
	sb.content_margin_right = 14.0
	sb.content_margin_top = 8.0
	sb.content_margin_bottom = 8.0
	return sb


func _theme_button(b: Button, accent: Color) -> void:
	# Flat dark button with a colored border; hover/pressed brighten the fill.
	var base := Color(0.06, 0.10, 0.15, 0.92)
	var sb := _flat_style(base, Color(accent.r, accent.g, accent.b, 0.55))
	var sb_hover := _flat_style(Color(accent.r, accent.g, accent.b, 0.18), accent)
	var sb_press := _flat_style(Color(accent.r, accent.g, accent.b, 0.30), accent)
	b.add_theme_stylebox_override("normal", sb)
	b.add_theme_stylebox_override("hover", sb_hover)
	b.add_theme_stylebox_override("pressed", sb_press)
	b.add_theme_stylebox_override("focus", sb)
	b.add_theme_color_override("font_color", Color(accent.r, accent.g, accent.b, 0.95))
	b.add_theme_color_override("font_hover_color", Color(accent.r, accent.g, accent.b, 1.0))
	b.add_theme_color_override("font_pressed_color", Color(1.0, 1.0, 1.0, 0.98))
	b.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.6))
	b.add_theme_constant_override("outline_size", 2)


func _build_ui() -> void:
	_field = Field.new()
	_field.name = "Field"
	_field.set_anchors_preset(Control.PRESET_FULL_RECT)
	_field.field_pressed.connect(_on_field_pressed)
	add_child(_field)

	var root := VBoxContainer.new()
	root.name = "Root"
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)

	# Top bar — HUD + tool buttons.
	var bar := HBoxContainer.new()
	bar.name = "TopBar"
	bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(bar)

	_hud = Label.new()
	_hud.name = "HUD"
	_hud.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_hud.add_theme_font_size_override("font_size", 17)
	bar.add_child(_hud)
	bar.add_child(_spacer())

	_tool_light = _mk_button("✦ 光源", bar)
	_tool_light.name = "ToolLight"
	_tool_light.toggle_mode = true
	_tool_light.button_pressed = true
	_tool_light.visible = _touch
	_theme_button(_tool_light, UI_LIGHT)
	_tool_light.pressed.connect(func(): _set_tool("light"))
	_tool_poison = _mk_button("☠ 毒域", bar)
	_tool_poison.name = "ToolPoison"
	_tool_poison.toggle_mode = true
	_tool_poison.visible = _touch
	_theme_button(_tool_poison, UI_POISON)
	_tool_poison.pressed.connect(func(): _set_tool("poison"))

	# Second row: core actions; goal/speed/replay fold into 更多.
	var row := HBoxContainer.new()
	row.name = "UtilBar"
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(row)
	var pause_btn := _mk_button("暂停", row)
	pause_btn.name = "Pause"
	_theme_button(pause_btn, UI_ACTION)
	pause_btn.pressed.connect(_toggle_pause)
	var reset_btn := _mk_button("重置观测", row)
	reset_btn.name = "Reset"
	_theme_button(reset_btn, UI_TEXT_DIM)
	reset_btn.pressed.connect(func(): _new_round(_seed))
	var seed_btn := _mk_button("换种子", row)
	seed_btn.name = "Reseed"
	_theme_button(seed_btn, UI_TEXT_DIM)
	seed_btn.pressed.connect(func(): _new_round(_pick_seed()))
	var share_btn := _mk_button("复制战绩", row)
	share_btn.name = "Share"
	_theme_button(share_btn, UI_LIGHT)
	share_btn.pressed.connect(_copy_result)
	_mute_btn = _mk_button("声音", row)
	_mute_btn.name = "Mute"
	_theme_button(_mute_btn, UI_ACTION)
	_mute_btn.pressed.connect(_toggle_mute)
	_more_btn = _mk_button("更多 ▾", row)
	_more_btn.name = "More"
	_more_btn.toggle_mode = true
	_theme_button(_more_btn, UI_TEXT_DIM)
	_more_btn.pressed.connect(_toggle_more)
	_speed_btn = _mk_button("速度 x1", row)
	_speed_btn.name = "Speed"
	_speed_btn.visible = false
	_theme_button(_speed_btn, UI_ACTION)
	_speed_btn.pressed.connect(func(): _cycle_speed(_speed_btn))
	_replay_btn = _mk_button("重放本局", row)
	_replay_btn.name = "Replay"
	_replay_btn.visible = false
	_theme_button(_replay_btn, UI_POISON)
	_replay_btn.pressed.connect(_replay_round)

	_goal_label = Label.new()
	_goal_label.name = "Goal"
	_goal_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_goal_label.add_theme_font_size_override("font_size", 16)
	_goal_label.add_theme_color_override("font_color", Color(0.98, 0.86, 0.62, 0.95))
	_goal_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_goal_label.visible = false
	root.add_child(_goal_label)

	_hint = Label.new()
	_hint.name = "Hint"
	_hint.text = "尘埃只是物质；光给能量，毒域做扰动。\n选光源点一次，看近处尘埃回应。"
	_hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_hint.add_theme_font_size_override("font_size", 20)
	_hint.add_theme_color_override("font_color", Color(0.85, 0.92, 1.0, 0.9))
	_hint.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(_hint)
	root.add_child(_spacer())

	_toast = Label.new()
	_toast.name = "Toast"
	_toast.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_toast.add_theme_font_size_override("font_size", 15)
	_toast.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(_toast)

	# Result panel (hidden until the round ends).
	_result_panel = PanelContainer.new()
	_result_panel.name = "ResultPanel"
	_result_panel.visible = false
	_result_panel.set_anchors_preset(Control.PRESET_CENTER)
	_result_panel.add_theme_stylebox_override("panel", _flat_style(
		Color(0.03, 0.06, 0.10, 0.97), Color(0.98, 0.82, 0.45, 0.45)))
	add_child(_result_panel)
	var vb := VBoxContainer.new()
	vb.name = "VBox"
	vb.add_theme_constant_override("separation", 10)
	_result_panel.add_child(vb)
	_result_text = Label.new()
	_result_text.name = "ResultText"
	_result_text.add_theme_font_size_override("font_size", 18)
	_result_text.add_theme_color_override("font_color", UI_TEXT)
	vb.add_child(_result_text)
	var rb := HBoxContainer.new()
	rb.name = "Actions"
	rb.alignment = BoxContainer.ALIGNMENT_CENTER
	vb.add_child(rb)
	var copy := _mk_button("复制战绩", rb)
	copy.name = "ResultCopy"
	_theme_button(copy, UI_LIGHT)
	copy.pressed.connect(_copy_result)
	var again := _mk_button("再观测一次", rb)
	again.name = "ResultAgain"
	_theme_button(again, UI_ACTION)
	again.pressed.connect(func(): _new_round(_pick_seed()))
	var same := _mk_button("同种子重开", rb)
	same.name = "ResultSame"
	_theme_button(same, UI_TEXT_DIM)
	same.pressed.connect(func(): _new_round(_seed))
	var replay := _mk_button("重放本局", rb)
	replay.name = "ResultReplay"
	_theme_button(replay, UI_POISON)
	replay.pressed.connect(_replay_round)

	# Opening intro overlay: shown once at boot, blocks the field and holds the
	# sim until dismissed, so the 90s window never ticks away while reading.
	_intro = Control.new()
	_intro.name = "Intro"
	_intro.set_anchors_preset(Control.PRESET_FULL_RECT)
	_intro.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(_intro)
	var dim := ColorRect.new()
	dim.name = "Dim"
	dim.color = Color(0.015, 0.03, 0.05, 0.92)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	dim.mouse_filter = Control.MOUSE_FILTER_STOP
	_intro.add_child(dim)
	var center := CenterContainer.new()
	center.name = "Center"
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_intro.add_child(center)
	var card := PanelContainer.new()
	card.name = "Card"
	card.custom_minimum_size = Vector2(640, 0)
	card.add_theme_stylebox_override("panel", _flat_style(
		Color(0.03, 0.06, 0.10, 0.97), Color(0.98, 0.82, 0.45, 0.55)))
	center.add_child(card)
	var ivb := VBoxContainer.new()
	ivb.name = "VBox"
	ivb.add_theme_constant_override("separation", 12)
	card.add_child(ivb)
	var title := Label.new()
	title.name = "IntroTitle"
	title.text = "微尘"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.add_theme_font_size_override("font_size", 40)
	title.add_theme_color_override("font_color", UI_LIGHT)
	ivb.add_child(title)
	var tag := Label.new()
	tag.name = "IntroTag"
	tag.text = "没有一颗尘埃，知道星云的形状。"
	tag.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	tag.add_theme_font_size_override("font_size", 19)
	tag.add_theme_color_override("font_color", Color(0.98, 0.86, 0.62, 0.95))
	ivb.add_child(tag)
	var body := Label.new()
	body.name = "IntroBody"
	body.text = INTRO_BODY
	body.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	body.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	body.custom_minimum_size = Vector2(560, 0)
	body.add_theme_font_size_override("font_size", 17)
	body.add_theme_color_override("font_color", Color(0.86, 0.92, 1.0, 0.95))
	ivb.add_child(body)
	var go := Button.new()
	go.name = "IntroStart"
	go.text = "放下第一束光"
	go.custom_minimum_size = Vector2(230, 52)
	go.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	go.add_theme_font_size_override("font_size", 20)
	go.add_theme_color_override("icon_color", UI_LIGHT)
	_theme_button(go, UI_LIGHT)
	go.button_down.connect(func(): _play_sfx("click"))
	go.pressed.connect(_close_intro)
	ivb.add_child(go)


func _mk_button(text: String, parent: Control) -> Button:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size = Vector2(92, 44)
	b.add_theme_font_size_override("font_size", 16)
	# Every button gets the light click on press-down (before the action fires).
	b.button_down.connect(func(): _play_sfx("click"))
	# Neutral base tint until a specific accent is applied via _theme_button.
	_theme_button(b, UI_TEXT_DIM)
	parent.add_child(b)
	return b


func _spacer() -> Control:
	var s := Control.new()
	s.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	s.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return s


func _relayout() -> void:
	var vp := get_viewport_rect().size
	_compact = vp.y <= 660.0
	_hint.add_theme_font_size_override("font_size", 16 if _compact else 20)
	_result_panel.custom_minimum_size = Vector2(minf(560.0, vp.x * 0.86), 0)


func _toggle_more() -> void:
	# Fold goal/speed/replay away from the first screen; one tap brings them back.
	# Own state, not button_pressed: pressed.emit() doesn't flip a toggle button.
	_more_open = not _more_open
	_more_btn.button_pressed = _more_open
	_speed_btn.visible = _more_open
	_replay_btn.visible = _more_open
	_goal_label.visible = _more_open
	_more_btn.text = "更多 ▴" if _more_open else "更多 ▾"


func _set_tool(tool: String) -> void:
	_tool = tool
	_tool_light.button_pressed = tool == "light"
	_tool_poison.button_pressed = tool == "poison"
	_show_toast("已选择：%s，点击场地放置" % ("光源" if tool == "light" else "毒域"))


func _toggle_pause() -> void:
	if _state.get("status") != "observing":
		return
	_paused = not _paused
	_show_toast("已暂停 — 尘埃静止，再按一次继续" if _paused else "继续观测")


func _cycle_speed(btn: Button) -> void:
	_speed = SPEED_STEPS[(SPEED_STEPS.find(_speed) + 1) % SPEED_STEPS.size()]
	btn.text = "速度 x%d" % _speed
	_show_toast("模拟速度 x%d — 现象判定不变，只是更快" % _speed)


func _close_intro() -> void:
	_intro.visible = false
	_show_toast("先放一束光，看近处尘埃如何回应")


func _on_field_pressed(pos: Vector2, button: int) -> void:
	if _state.is_empty() or _state.get("status") != "observing":
		return
	if _intro.visible:
		return
	if _replaying:
		_show_toast("正在重放本局，等它演完或点重置")
		return
	var world: Vector2 = _field.field_to_world(pos)
	if world.x < 0.0:
		return
	# Desktop: left = light, right = poison, fixed — no tool selection needed.
	# Touch (no right button): taps follow the selected tool button.
	var tool := "poison"
	if button == MOUSE_BUTTON_LEFT:
		tool = _tool if _touch else "light"
	var res := _sim.apply_tool(_state, tool, world.x, world.y)
	if res.get("ok", false):
		_replay_inputs.append({"tick": int(_state["tick"]), "tool": tool, "x": world.x, "y": world.y})
		_hint.visible = false
		_field.add_burst(world, tool)
		_play_sfx(tool)
		_field.set_state(_state)
		_show_toast("放下了%s — 看尘埃如何回应" % ("一束光" if tool == "light" else "一片毒域"))
	else:
		_show_toast(str(res.get("err", "无法放置")))

func _touch_layout() -> bool:
	return DisplayServer.is_touchscreen_available()


func _new_round(seed: int) -> void:
	_seed = seed
	_state = _sim.new_round(seed)
	_acc = 0.0
	_paused = false
	_tool = "light"
	_replay_inputs = []
	_replay_index = 0
	_replaying = false
	_announced = {}
	_tool_light.button_pressed = true
	_tool_poison.button_pressed = false
	_hint.visible = true
	_result_panel.visible = false
	_result_shown = false
	_field.set_state(_state)


func _replay_round() -> void:
	# Restart on the same seed, then re-apply the logged interventions at their
	# original ticks. The sim is deterministic, so the trajectory is identical.
	if _replay_inputs.is_empty():
		_show_toast("本局还没有记录任何干预")
		return
	_state = _sim.new_round(_seed)
	_acc = 0.0
	_paused = false
	_replay_index = 0
	_replaying = true
	_announced = {}
	_result_panel.visible = false
	_result_shown = false
	_field.set_state(_state)
	_show_toast("重放本局 — 同种子同操作，逐帧一致")


func _copy_result() -> void:
	_last_share = _sim.result_text(_state)
	DisplayServer.clipboard_set(_last_share)
	_show_toast("战绩已复制，可以贴给朋友比较同一种子")


func _show_toast(text: String) -> void:
	_toast.text = text
	_toast_until = Time.get_ticks_msec() + 2600


func _check_births() -> void:
	# When the count grows, the newest particles (appended at the tail by split)
	# get a short sparkle so "尘埃分裂" is visible without reading the HUD.
	var n: int = int(_state.get("count", 0))
	if n <= _last_count:
		_last_count = n
		return
	var xs: PackedFloat32Array = _state["x"]
	var ys: PackedFloat32Array = _state["y"]
	for i in range(_last_count, n):
		_field.add_birth(Vector2(xs[i], ys[i]))
	_last_count = n


func _process(delta: float) -> void:
	if _toast.text != "" and Time.get_ticks_msec() > _toast_until:
		_toast.text = ""
	if _state.is_empty():
		return
	if not _paused and not _intro.visible and _state.get("status") == "observing":
		# Fixed-step accumulator: x1 runs exactly 30 ticks/s regardless of the
		# render frame rate. Speed multiplies the accumulated sim time, so x2/x4
		# genuinely advance the sim faster; the cap prevents spiral-of-death.
		_acc = minf(_acc + delta * _speed, Sim.DT * 12.0 * _speed)
		var ticks := int(_acc / Sim.DT)
		var guard := (2 + _speed * 2) * maxi(1, ticks)
		while ticks > 0 and _state.get("status") == "observing" and guard > 0:
			_acc -= Sim.DT
			ticks -= 1
			guard -= 1
			_apply_replay_inputs()
			_sim.step(_state)
		_field.set_state(_state)
		_check_births()
	elif _state.get("status") == "finished" and not _result_panel.visible and not _result_shown:
		var baseline := _sim.result_baseline(_state)
		_result_text.text = _sim.result_text(_state) + _state.get("reason", "") + "\n" + baseline
		_result_panel.visible = true
		_result_shown = true
	_refresh_hud()
	_update_music_layer(delta)


func _apply_replay_inputs() -> void:
	# During replay, pending logged inputs fire at their recorded ticks; live
	# inputs are blocked so the re-run cannot diverge from the recording.
	if not _replaying:
		return
	var live: Dictionary = _state
	while _replay_index < _replay_inputs.size():
		var entry: Dictionary = _replay_inputs[_replay_index]
		if int(entry["tick"]) > int(live["tick"]):
			break
		_sim.apply_tool(live, str(entry["tool"]), float(entry["x"]), float(entry["y"]))
		_replay_index += 1
	if _replay_index >= _replay_inputs.size():
		_replaying = false


func _refresh_hud() -> void:
	if _state.is_empty():
		return
	var left := maxi(0, Sim.MAX_TICKS - int(_state.get("tick", 0)))
	var now: Array = []
	for k in _state.get("phenomenon_now", []):
		now.append(PHENOMENON_NAMES.get(k, k))
	var ph := "—" if now.is_empty() else "·".join(now)
	_hud.text = "微尘 %d · 光 %d · 毒 %d · %ds · 稳定 %ds · %s" % [
		int(_state.get("count", 0)),
		int(_state.get("light_budget", 0)),
		int(_state.get("poison_budget", 0)),
		left / 30,
		int(_state.get("stable_ticks", 0)) / 30,
		ph,
	]
	var goal: Dictionary = _state.get("goal", {})
	if not goal.is_empty() and _goal_label.visible:
		var mark := "✓" if bool(goal["done"]) else "…"
		_goal_label.text = "目标：%s %s" % [goal["label"], mark]
	_check_announcements()


func _check_announcements() -> void:
	# First time a phenomenon appears, name it where it happens, not in the log.
	for k in _state.get("phenomenon_now", []):
		if not _announced.has(k):
			_announced[k] = true
			_play_sfx("phenomenon")
			_show_toast("出现了%s — 它不是被放进去的，是长出来的" % PHENOMENON_NAMES.get(k, k))


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel"):
		if _intro.visible:
			_close_intro()
		elif _result_panel.visible:
			_result_panel.visible = false
		else:
			_toggle_pause()
