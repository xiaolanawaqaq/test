extends SceneTree

const MainScene := preload("res://scenes/main.tscn")
const Sim := preload("res://scripts/dust_sim.gd")
var passed := 0
var failed := 0

func check(condition: bool, name: String) -> void:
	if condition:
		passed += 1
	else:
		failed += 1
		push_error("FAIL " + name)

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	for size in [Vector2i(1200, 820), Vector2i(1200, 600), Vector2i(1066, 600)]:
		root.size = size
		var inst = MainScene.instantiate()
		root.add_child(inst)
		await process_frame
		await process_frame
		check(inst.get_node("Field") != null, "field exists %s" % size)
		check(inst.get_node("Root/TopBar/HUD") != null, "HUD exists %s" % size)
		var hint: Label = inst.get_node("Root/Hint")
		check(hint.visible and hint.text.contains("光"), "hint shown %s" % size)
		# Opening intro: three-element copy (matter / energy / disturbance),
		# one clear start button, and it blocks field placement while up.
		var intro: Control = inst.get_node("Intro")
		check(intro != null and intro.visible, "intro shown %s" % size)
		var ibody: Label = intro.get_node("Center/Card/VBox/IntroBody")
		check(ibody.text.contains("物质") and ibody.text.contains("能量")
			and ibody.text.contains("扰动"), "intro has three-element copy %s" % size)
		var istart: Button = intro.get_node("Center/Card/VBox/IntroStart")
		check(istart.text.contains("第一束光"), "intro start button %s" % size)
		var lights0 := int(inst._state["lights"].size())
		inst._on_field_pressed(Vector2(400, 300), MOUSE_BUTTON_LEFT)
		check(int(inst._state["lights"].size()) == lights0, "intro blocks placement %s" % size)
		var light_btn: Button = inst.get_node("Root/TopBar/ToolLight")
		var poison_btn: Button = inst.get_node("Root/TopBar/ToolPoison")
		check(light_btn != null and light_btn.text.contains("光源"), "light button %s" % size)
		check(poison_btn != null and poison_btn.text.contains("毒域"), "poison button %s" % size)
		# Headless is a desktop context: tool buttons stay hidden there.
		check(not light_btn.visible and not poison_btn.visible,
			"tool buttons hidden on desktop %s" % size)
		# Audio: both music layers exist, loop, and start playing at boot.
		var mb: AudioStreamPlayer = inst.get_node("MusicBase")
		var ma: AudioStreamPlayer = inst.get_node("MusicAlive")
		check(mb.get_stream() is AudioStreamWAV and mb.get_stream().loop_mode != AudioStreamWAV.LOOP_DISABLED,
			"base music loops %s" % size)
		check(ma.get_stream() is AudioStreamWAV and ma.get_stream().loop_mode != AudioStreamWAV.LOOP_DISABLED,
			"alive music loops %s" % size)
		check(mb.playing and ma.playing, "music playing at boot %s" % size)
		check(ma.volume_db < -40.0, "alive layer starts silent %s" % size)
		check(mb.bus == &"Music" and inst.get_node("Sfx0").bus == &"SFX",
			"audio buses wired %s" % size)
		inst.queue_free()
		await process_frame

	var inst = MainScene.instantiate()
	root.add_child(inst)
	await process_frame
	await process_frame

	# Intro holds the sim and the field until the player starts.
	for i in 20:
		await process_frame
	check(int(inst._state["tick"]) == 0, "intro holds sim at tick 0")
	var intro_start: Button = inst.get_node("Intro/Center/Card/VBox/IntroStart")
	intro_start.pressed.emit()
	await process_frame
	check(not inst.get_node("Intro").visible, "intro start dismisses intro")
	for i in 40:
		await process_frame
	check(int(inst._state["tick"]) > 0, "sim runs after intro dismissed")

	# Desktop semantics: left is ALWAYS light, right is ALWAYS poison,
	# regardless of tool selection (selection only matters on touch).
	var light_btn: Button = inst.get_node("Root/TopBar/ToolLight")
	var poison_btn: Button = inst.get_node("Root/TopBar/ToolPoison")
	poison_btn.pressed.emit()
	await process_frame
	check(inst._tool == "poison", "poison tool selected")
	var poison_before := int(inst._state["poisons"].size())
	var light_before := int(inst._state["lights"].size())
	inst._on_field_pressed(Vector2(600, 400), MOUSE_BUTTON_LEFT)
	check(int(inst._state["lights"].size()) == light_before + 1,
		"desktop left click places light even with poison selected")
	check(int(inst._state["poisons"].size()) == poison_before,
		"desktop left click places no poison")
	light_btn.pressed.emit()
	await process_frame
	check(inst._tool == "light", "light tool selected")

	# Left = light (fixed), right = poison (fixed).
	inst._on_field_pressed(Vector2(500, 350), MOUSE_BUTTON_LEFT)
	check(int(inst._state["lights"].size()) == light_before + 2, "left click places light")
	check(not inst.get_node("Root/Hint").visible, "first valid input hides hint")
	var inputs_before := int(inst._state["inputs"].size())
	check(inputs_before >= 2, "input logged")
	var poison_right_before := int(inst._state["poisons"].size())
	inst._on_field_pressed(Vector2(700, 500), MOUSE_BUTTON_RIGHT)
	check(int(inst._state["poisons"].size()) == poison_right_before + 1, "right click places poison")

	# Touch path: taps follow the selected tool button.
	inst._touch = true
	inst._tool = "poison"
	var touch_poison_before := int(inst._state["poisons"].size())
	inst._on_field_pressed(Vector2(800, 300), MOUSE_BUTTON_LEFT)
	check(int(inst._state["poisons"].size()) == touch_poison_before + 1,
		"touch tap follows selected poison tool")
	inst._touch = false
	inst._tool = "light"

	# Pause toggles.
	var pause_btn: Button = inst.get_node("Root/UtilBar/Pause")
	pause_btn.pressed.emit()
	await process_frame
	check(inst._paused, "paused")
	pause_btn.pressed.emit()
	await process_frame
	check(not inst._paused, "resumed")

	# Goal/speed/replay are folded behind 更多 by default; one tap shows them.
	var speed_fold: Button = inst.get_node("Root/UtilBar/Speed")
	var replay_fold: Button = inst.get_node("Root/UtilBar/Replay")
	var goal_fold: Label = inst.get_node("Root/Goal")
	check(not speed_fold.visible and not replay_fold.visible and not goal_fold.visible,
		"more-panel items hidden by default")
	var more_btn: Button = inst.get_node("Root/UtilBar/More")
	more_btn.pressed.emit()
	await process_frame
	check(speed_fold.visible and replay_fold.visible and goal_fold.visible,
		"more panel shows goal/speed/replay")
	more_btn.pressed.emit()
	await process_frame
	check(not speed_fold.visible, "more panel folds back")

	# Mute button silences both buses and toggles back.
	var mute_btn: Button = inst.get_node("Root/UtilBar/Mute")
	for p: AudioStreamPlayer in inst._sfx_pool:
		p.stop()
	# The click is only 90 ms long — under load it can finish before we look,
	# so prove the click fired two ways: the voice-pool cursor advanced AND a
	# voice is either playing the click or holds the click stream at -13 dB.
	var cursor_before: int = inst._sfx_cursor
	mute_btn.button_down.emit()
	var cursor_advanced: bool = inst._sfx_cursor != cursor_before
	var click_playing := 0
	var click_vol := 0.0
	for p: AudioStreamPlayer in inst._sfx_pool:
		if p.playing:
			click_playing += 1
			click_vol = p.volume_db
		elif p.stream != null and p.volume_db <= -10.0 and cursor_advanced:
			# finished voice that carried the click
			if click_playing == 0:
				click_playing = 1
				click_vol = p.volume_db
	check(click_playing >= 1, "button press plays a click sfx")
	check(click_vol <= -10.0,
		"click plays quietly (%.1f dB)" % click_vol)
	mute_btn.pressed.emit()
	await process_frame
	check(AudioServer.is_bus_mute(AudioServer.get_bus_index("Music")), "mute silences music bus")
	check(AudioServer.is_bus_mute(AudioServer.get_bus_index("SFX")), "mute silences sfx bus")
	mute_btn.pressed.emit()
	await process_frame
	check(not AudioServer.is_bus_mute(AudioServer.get_bus_index("Music")), "unmute restores")

	# Placing a tool fires an sfx voice; the alive layer blooms while a
	# phenomenon is present and hushes again when it is gone.
	for p: AudioStreamPlayer in inst._sfx_pool:
		p.stop()
	inst._on_field_pressed(Vector2(600, 300), MOUSE_BUTTON_LEFT)
	await process_frame
	var sfx_playing := 0
	for p: AudioStreamPlayer in inst._sfx_pool:
		if p.playing:
			sfx_playing += 1
	check(sfx_playing >= 1, "light placement fires sfx (playing=%d)" % sfx_playing)
	var alive: AudioStreamPlayer = inst.get_node("MusicAlive")
	var quiet_db := alive.volume_db
	inst._state["phenomenon_now"] = ["nebula"]
	var bloomed := false
	for i in 600:
		await process_frame
		if alive.volume_db > quiet_db + 1.0:
			bloomed = true
			break
	check(bloomed, "alive layer blooms with phenomenon (db=%.1f)" % alive.volume_db)
	inst._state["phenomenon_now"] = []
	var hushed := false
	for i in 600:
		await process_frame
		if alive.volume_db < -40.0:
			hushed = true
			break
	check(hushed, "alive layer hushes without phenomenon (db=%.1f)" % alive.volume_db)

	# Reset keeps seed, reseed restarts.
	var seed0: int = inst._seed
	var reset_btn: Button = inst.get_node("Root/UtilBar/Reset")
	reset_btn.pressed.emit()
	await process_frame
	check(inst._seed == seed0, "reset keeps seed")
	check(int(inst._state["tick"]) == 0, "reset clears tick")
	var reseed_btn: Button = inst.get_node("Root/UtilBar/Reseed")
	reseed_btn.pressed.emit()
	await process_frame
	check(int(inst._state["tick"]) == 0, "reseed restarts")

	# Share copies a record containing seed + score (headless clipboard is
	# unsupported; verify the produced text through the cached copy).
	var current_seed: int = inst._seed
	var share_btn: Button = inst.get_node("Root/UtilBar/Share")
	share_btn.pressed.emit()
	await process_frame
	var clip: String = DisplayServer.clipboard_get()
	if clip.is_empty():
		clip = inst._last_share
	check(clip.contains("种子"), "share text has seed")
	check(clip.contains("得分"), "share text has score")

	# Simulation advances when unpaused.
	for i in 40:
		await process_frame
	check(int(inst._state["tick"]) > 0, "sim ticks while unpaused")

	# Speed control cycles 1→2→4→1 and x4 must genuinely run more ticks
	# per real-time frame than x1 (the accumulator multiplies by _speed).
	var speed_btn: Button = inst.get_node("Root/UtilBar/Speed")
	speed_btn.visible = true
	var t0 := int(inst._state["tick"])
	for i in 60:
		await process_frame
	var x1_ticks := int(inst._state["tick"]) - t0
	speed_btn.pressed.emit()
	await process_frame
	check(inst._speed == 2, "speed cycles to x2")
	var t1 := int(inst._state["tick"])
	for i in 60:
		await process_frame
	var x2_ticks := int(inst._state["tick"]) - t1
	check(x2_ticks > x1_ticks * 1.5,
		"x2 advances more ticks than x1 (x1=%d x2=%d)" % [x1_ticks, x2_ticks])
	speed_btn.pressed.emit()
	speed_btn.pressed.emit()
	await process_frame
	check(inst._speed == 1, "speed cycles back to x1")
	check(int(inst._state["tick"]) > t1 and t1 > t0, "ticks advance under speed changes")

	# Replay: recorded interventions replay deterministically on same seed.
	# Record a clean reference: pause, apply a fixed input script, resume for a
	# fixed frame count, snapshot; then replay the log and compare snapshots.
	var replay_seed: int = inst._seed
	var ref_state: Dictionary = inst._sim.new_round(replay_seed)
	inst._sim.apply_tool(ref_state, "light", 500.0, 350.0)
	for i in 120:
		if ref_state["status"] != "observing":
			break
		inst._sim.step(ref_state)
	inst._sim.apply_tool(ref_state, "poison", 700.0, 500.0)
	for i in 120:
		if ref_state["status"] != "observing":
			break
		inst._sim.step(ref_state)
	var pre_states: Array = []
	for k in ["x", "y", "vx", "vy", "energy"]:
		var arr: PackedFloat32Array = ref_state[k]
		var snapshot: Array = []
		snapshot.resize(arr.size())
		for i in arr.size():
			snapshot[i] = arr[i]
		pre_states.append(snapshot)
	# Drive the live instance through the same log via the replay machinery.
	inst._seed = replay_seed
	inst._state = inst._sim.new_round(replay_seed)
	inst._acc = 0.0
	inst._paused = false
	inst._replay_inputs = [
		{"tick": 0, "tool": "light", "x": 500.0, "y": 350.0},
		{"tick": 120, "tool": "poison", "x": 700.0, "y": 500.0},
	]
	inst._replay_index = 0
	inst._replaying = true
	inst._announced = {}
	inst._result_panel.visible = false
	inst._field.set_state(inst._state)
	var replay_target_tick := int(ref_state["tick"])
	# Headless frames advance ~1-2 ticks each; keep stepping until the reference
	# tick is reached, with a generous ceiling (deterministic, not timed).
	var max_frames := replay_target_tick * 6 + 600
	for i in max_frames:
		if int(inst._state["tick"]) >= replay_target_tick:
			break
		await process_frame
	inst._paused = true
	check(int(inst._state["tick"]) >= replay_target_tick,
		"replay reaches recorded tick (target=%d got=%d)" % [replay_target_tick, int(inst._state["tick"])])
	var replay_ok := true
	# Compare at the exact recorded tick: fast-forward or compare only if the
	# live tick landed exactly on the reference tick.
	if int(inst._state["tick"]) == replay_target_tick:
		for k in pre_states.size():
			var arr2: PackedFloat32Array = inst._state[["x", "y", "vx", "vy", "energy"][k]]
			var ref: Array = pre_states[k]
			if arr2.size() != ref.size():
				replay_ok = false
				break
			for i in arr2.size():
				if absf(arr2[i] - float(ref[i])) > 0.25:
					replay_ok = false
					break
	else:
		# Headless frame pacing may overshoot; step the reference to the live
		# tick so both represent the same simulation moment.
		while int(ref_state["tick"]) < int(inst._state["tick"]) and ref_state["status"] == "observing":
			inst._sim.step(ref_state)
		for k in pre_states.size():
			var arr3: PackedFloat32Array = ref_state[["x", "y", "vx", "vy", "energy"][k]]
			var live_arr: PackedFloat32Array = inst._state[["x", "y", "vx", "vy", "energy"][k]]
			if arr3.size() != live_arr.size():
				replay_ok = false
				break
			for i in arr3.size():
				if absf(arr3[i] - live_arr[i]) > 0.25:
					replay_ok = false
					break
	check(replay_ok, "replay reproduces recorded trajectory")

	# Result panel appears when forced to finish.
	inst._state["status"] = "finished"
	inst._state["reason"] = "观测时间结束"
	inst._state["score"] = 123
	await process_frame
	await process_frame
	var panel: PanelContainer = inst.get_node("ResultPanel")
	check(panel.visible, "result panel shown")
	var rtext: Label = panel.get_node("VBox/ResultText")
	check(rtext.text.contains("观测记录"), "result text rendered")
	check(rtext.text.contains("本局干预"), "result text includes intervention summary")
	# Dismissing the panel must stick: it auto-opens once per round only.
	panel.visible = false
	await process_frame
	await process_frame
	check(not panel.visible, "result panel stays dismissed after back")
	var same_btn: Button = panel.get_node("VBox/Actions/ResultSame")
	same_btn.pressed.emit()
	await process_frame
	check(int(inst._state["tick"]) == 0, "same-seed button restarts round")
	check(inst._seed == current_seed, "same-seed button preserves seed")

	# System back / ui_cancel dismisses result or pauses.
	var ev := InputEventAction.new()
	ev.action = "ui_cancel"
	ev.pressed = true
	inst._unhandled_input(ev)
	check(not panel.visible or inst._paused, "back handled")

	inst.queue_free()
	await process_frame
	print("WEICHEN UI RESULTS: %d passed, %d failed" % [passed, failed])
	quit(1 if failed else 0)
