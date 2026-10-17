## KUMODeck Game Studio — Godot 4 side of the 2D port (Web export only).
##
## HOW TO USE: copy this file into the Godot project and add it as an Autoload
## named "StudioBridge" (Project Settings > Globals > Autoload). Copy
## adapter.js from the same folder to `.studio/adapter.js` next to the
## exported index.html. Outside the browser this node does nothing.
##
## WHY a GDScript part: a Godot game runs inside WebAssembly. JavaScript cannot
## see its nodes, so the editor's port is answered from here through
## JavaScriptBridge. adapter.js turns these answers into the studio's Port2D.
##
## Calling convention: JavaScript calls window.godotStudio.call(json) with
## {"op": ..., "key": ..., "pose": ...}; this script answers synchronously by
## writing a JSON string to window.godotStudio.out before returning. (A
## JavaScriptBridge callback cannot return a value to JavaScript, so the
## answer travels through that property.)
##
## Which nodes are offered (EDIT HERE to change):
##   - nodes in the group "studio", if the game uses that group, otherwise
##   - every visible Node2D that is a direct child of the current scene
##   - never nodes with metadata studio = false (and nothing inside them)
## Keys are node paths relative to the current scene ("Trees/Tree2"): Godot
## node names are unique among siblings, so these are stable unless the scene
## tree is renamed. Metadata "studio_key" overrides the key.
extends Node

var _api: JavaScriptObject
var _callback: JavaScriptObject  # keep a reference or the callback is freed
var _saved_canvas_transform = null
var _was_paused := false


func _ready() -> void:
	if not OS.has_feature("web"):
		return
	# Keep answering while the game's tree is paused for editing.
	process_mode = Node.PROCESS_MODE_ALWAYS
	var window = JavaScriptBridge.get_interface("window")
	if window == null:
		return
	_api = JavaScriptBridge.create_object("Object")
	_callback = JavaScriptBridge.create_callback(_on_call)
	_api.call = _callback
	_api.version = Engine.get_version_info().string
	window.godotStudio = _api


func _on_call(args: Array) -> void:
	var req = JSON.parse_string(str(args[0])) if args.size() > 0 else null
	var out = null
	if typeof(req) == TYPE_DICTIONARY:
		out = _handle(req)
	_api.out = JSON.stringify(out)


func _handle(req: Dictionary):
	match req.get("op", ""):
		"objects":
			return _objects()
		"get":
			var n := _node(req.get("key", ""))
			return _pose(n) if n else null
		"set":
			var n := _node(req.get("key", ""))
			if n:
				_set_pose(n, req.get("pose", {}))
			return n != null
		"parentToScreen":
			var n := _node(req.get("key", ""))
			return _xf(_parent_to_window(n)) if n else null
		"bounds":
			var n := _node(req.get("key", ""))
			return _bounds(n) if n else null
		"pause":
			_was_paused = get_tree().paused
			get_tree().paused = true  # stops game logic; drawing goes on
			return true
		"resume":
			get_tree().paused = _was_paused
			return true
		"setView":
			_set_view(req.get("view", {}))
			return true
		"assets":
			var n := _node(req.get("key", ""))
			return _assets(n) if n else []
	return null


# ------------------------------------------------------------------ objects and keys
func _candidates() -> Array:
	var scene := get_tree().current_scene
	if scene == null:
		return []
	var out := []
	var grouped := get_tree().get_nodes_in_group("studio")
	var list: Array = grouped if grouped.size() > 0 else scene.get_children()
	for n in list:
		if n is Node2D and n.is_visible_in_tree() and not _hidden(n):
			out.append(n)
	return out


func _hidden(n: Node) -> bool:
	var p := n
	while p != null:
		if p.has_meta("studio") and p.get_meta("studio") == false:
			return true
		p = p.get_parent()
	return false


func _key_of(n: Node) -> String:
	if n.has_meta("studio_key"):
		return str(n.get_meta("studio_key"))
	return str(get_tree().current_scene.get_path_to(n))


func _node(key: String) -> Node2D:
	for n in _candidates():
		if _key_of(n) == key:
			return n
	return null


func _objects() -> Array:
	var out := []
	for n in _candidates():
		var group := ""
		if n is Sprite2D and n.texture:
			group = n.texture.resource_path
		out.append({"key": _key_of(n), "label": str(n.name), "kinds": [n.get_class().to_lower()], "group": group})
	return out


# ------------------------------------------------------------------ pose
func _pose(n: Node2D) -> Dictionary:
	var s = n.scale.x if is_equal_approx(n.scale.x, n.scale.y) else [n.scale.x, n.scale.y]
	return {"p": [n.position.x, n.position.y], "r": n.rotation, "s": s}


func _set_pose(n: Node2D, pose: Dictionary) -> void:
	var p = pose.get("p", null)
	if p is Array and p.size() >= 2:
		n.position = Vector2(p[0], p[1])
	if pose.has("r"):
		n.rotation = float(pose["r"])
	var s = pose.get("s", null)
	if s is Array and s.size() >= 2:
		n.scale = Vector2(s[0], s[1])
	elif s != null:
		n.scale = Vector2(float(s), float(s))


# ------------------------------------------------------------------ screen maths
# Window pixels; adapter.js converts them to CSS px of the page.
func _parent_to_window(n: Node2D) -> Transform2D:
	var vp := n.get_viewport()
	var parent := n.get_parent()
	var to_canvas: Transform2D
	if parent is CanvasItem:
		to_canvas = parent.get_global_transform_with_canvas()
	else:
		to_canvas = vp.canvas_transform
	return vp.get_final_transform() * to_canvas


func _xf(t: Transform2D) -> Array:
	return [t.x.x, t.x.y, t.y.x, t.y.y, t.origin.x, t.origin.y]


func _bounds(n: Node2D) -> Dictionary:
	var rect := Rect2(-16, -16, 32, 32)  # fallback: a fingertip-sized box around the pivot
	if n is Sprite2D:
		rect = n.get_rect()
	elif n.has_method("get_rect"):
		rect = n.get_rect()
	var t := n.get_viewport().get_final_transform() * n.get_global_transform_with_canvas()
	var pts := [t * rect.position, t * Vector2(rect.end.x, rect.position.y), t * Vector2(rect.position.x, rect.end.y), t * rect.end]
	var lo: Vector2 = pts[0]
	var hi: Vector2 = pts[0]
	for q in pts:
		lo = lo.min(q)
		hi = hi.max(q)
	return {"x": lo.x, "y": lo.y, "w": hi.x - lo.x, "h": hi.y - lo.y}


# ------------------------------------------------------------------ edit view
# Only the root viewport's canvas transform changes (what is shown), never a
# node. While the tree is paused a Camera2D does not overwrite it.
func _set_view(v: Dictionary) -> void:
	var vp := get_viewport()
	if _saved_canvas_transform == null:
		_saved_canvas_transform = vp.canvas_transform
	var base: Transform2D = _saved_canvas_transform
	var zoom := float(v.get("zoom", 1.0))
	var shift := Vector2(float(v.get("x", 0.0)), float(v.get("y", 0.0)))
	if zoom == 1.0 and shift == Vector2.ZERO:
		vp.canvas_transform = base
		_saved_canvas_transform = null
		return
	# x, y arrive in window pixels; the canvas transform works in viewport
	# units, which differ when the project uses a stretch mode.
	shift /= vp.get_final_transform().get_scale()
	var c := vp.get_visible_rect().size / 2.0
	var view := Transform2D(0.0, Vector2(zoom, zoom), 0.0, c + shift - c * zoom)
	vp.canvas_transform = view * base


func _assets(n: Node2D) -> Array:
	var out := []
	if n.has_meta("studio_asset"):
		out.append({"url": str(n.get_meta("studio_asset")), "how": "other", "sure": true})
	if n is Sprite2D and n.texture and n.texture.resource_path != "":
		# res:// path inside the exported .pck; the studio maps it to the project folder.
		out.append({"url": n.texture.resource_path, "how": "texture", "sure": true})
	return out
