# Heavy 3D files

A web game downloads every model before the player sees it. Most game models are a few MB; a model made by an AI
service is often 20–50 MB (big textures, hundreds of thousands of triangles). The editor's Assets page marks a 3D file
over 10 MB as heavy and has an **Ask my AI to make it lighter** button, which sends you one line like:

> Make assets/rowboat.glb lighter for the game (it's 45.7 MB now), and keep how it looks.

Follow these steps for that request, and also before you load any `.glb` / `.gltf` over 10 MB in the game code.

## 1. See what is heavy

No packages needed. This prints each texture's size and the triangle count:

```sh
node -e '
const fs = require("fs"); const b = fs.readFileSync(process.argv[1]);
const jl = b.readUInt32LE(12); const j = JSON.parse(b.subarray(20, 20 + jl)); const bin = b.subarray(28 + jl);
for (const im of j.images || []) { const v = j.bufferViews[im.bufferView]; const d = bin.subarray(v.byteOffset || 0);
  const wh = im.mimeType === "image/png" ? `${d.readUInt32BE(16)}x${d.readUInt32BE(20)}` : "";
  console.log("texture", im.mimeType, wh, (v.byteLength / 1e6).toFixed(1) + " MB"); }
let t = 0; for (const m of j.meshes || []) for (const p of m.primitives) t += (p.indices !== undefined ? j.accessors[p.indices].count : j.accessors[p.attributes.POSITION].count) / 3;
console.log("triangles", t, "| file", (b.length / 1e6).toFixed(1) + " MB");' assets/rowboat.glb
```

Rough targets for a web game: textures at 1024 px (2048 only for something the camera gets close to), and
5,000–30,000 triangles for a prop, more only for the hero object.

## 2. Ask the user, then make a lighter copy

Tell the user in one sentence what you will do ("I'll make a lighter copy, about 4 MB: smaller textures and fewer
triangles; the original stays"). Never overwrite the original; write `<name>-light.glb` next to it and use that in
the code. Ask before deleting the original.

Use the first way that is available:

**Blender** (check with `blender --version`, or on a Mac `/Applications/Blender.app/Contents/MacOS/Blender --version`).
Save this as a temporary `lighten.py` (outside the game folder) and run
`blender -b -P lighten.py -- assets/rowboat.glb assets/rowboat-light.glb 30000 1024`:

```python
# Make a .glb lighter for a web game: fewer triangles, smaller textures. Writes a NEW file.
#   blender -b -P lighten.py -- in.glb out.glb [triangles=30000] [texture px=1024]
import bpy, sys
a = sys.argv[sys.argv.index('--') + 1:]
src, dst = a[0], a[1]
tris = int(a[2]) if len(a) > 2 else 30000
px = int(a[3]) if len(a) > 3 else 1024
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
before = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
ratio = min(1.0, tris / max(1, before))
for o in meshes:
    # Skinned or shape-keyed meshes keep their triangles: decimating them breaks the animation.
    if ratio < 1 and not o.data.shape_keys and not any(m.type == 'ARMATURE' for m in o.modifiers):
        o.modifiers.new('lighten', 'DECIMATE').ratio = ratio
for img in bpy.data.images:
    w, h = img.size
    if max(w, h) > px:
        s = px / max(w, h)
        img.scale(max(1, round(w * s)), max(1, round(h * s)))
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_apply=True, export_image_format='AUTO')
print(f'lighten: {before} -> about {round(before * ratio)} triangles, textures <= {px} px, wrote {dst}')
```

(Tried on a 50.8 MB model with a 4096 px texture and 261,120 triangles: 3.9 MB, 1024 px, 30,000 triangles.)

**KUMODeck**, when the user has connected it (§7 of the skill): its 3D tools can make a version of a model with fewer
faces. It is paid with the user's credits, so say so before, and follow the connector's or plugin's guide for the
steps.

**Neither:** a glTF optimizer from npm can do the same, but it downloads a package. Ask the user first, as for any
install. If they say no, tell them the file is heavy and how long it may take to load, and leave it.

## 3. Check

- Run step 1 on the new file: the size and the numbers went down.
- Load the light file in the game instead of the original, open the game, and compare: same shape and colors, nothing
  missing. If it looks broken (holes, smeared texture), go back up (more triangles, 2048 px) and try again.
- Tell the user the result in one line: "rowboat-light.glb is 3.9 MB (was 45.7 MB) and looks the same. The game uses
  it now; the original is still in assets/."
