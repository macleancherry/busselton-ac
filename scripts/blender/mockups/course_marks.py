"""Course markings mock-up at a town-layout roundabout. Renders before/after from one camera.
python scene.py -- <out_dir> <samples> <w> <h> <glb> [glb...]"""
import sys, math, json
import bpy, bmesh
from mathutils import Vector
src = open('/home/claude/busselton-ac/scripts/blender/render_track.py').read()
src = src[:src.rindex('\nmain()')]
sys.argv = sys.argv  # keep
exec(compile(src, 'render_track.py', 'exec'))

a = sys.argv[sys.argv.index('--') + 1:]
out, samples, W, H = a[0], int(a[1]), int(a[2]), int(a[3])
glbs = a[4:]
AI = json.load(open('/tmp/claude-0/-home-claude/82e9b486-5ffc-54d5-b24a-3e40fd9dff43/scratchpad/cm/town_ai.json'))
bpy.ops.wm.read_factory_settings(use_empty=True)
for f in glbs:
    bpy.ops.import_scene.gltf(filepath=f)
fix_materials()
cam = setup_scene(samples, (W, H))
scene = bpy.context.scene
dg = bpy.context.evaluated_depsgraph_get()

def cast(x, y):
    """Highest physics surface (digit-prefixed mesh) under x, y; road markings count as the road."""
    z0 = 60
    for _ in range(8):
        h = scene.ray_cast(dg, Vector((x, y, z0)), Vector((0, 0, -1)))
        if not h[0]: return (None, '')
        n = h[4].name
        if n[:1].isdigit(): return (h[1].z, n)
        if n.upper().startswith(('MARKINGS', 'RRPM')): return (h[1].z, '1ROAD_' + n)
        z0 = h[1].z - 0.01
    return (None, '')

# Roundabout island centre: vertices of island meshes near the guess.
guess = Vector((394.8, 71.2))
pts = []
for o in bpy.data.objects:
    if o.type == 'MESH' and 'RBISLAN' in o.name.upper():
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            if (Vector((w.x, w.y)) - guess).length < 22: pts.append(w)
C = sum((Vector((p.x, p.y)) for p in pts), Vector((0, 0))) / len(pts)
Ri = max((Vector((p.x, p.y)) - C).length for p in pts)
zC = cast(C.x, C.y)[0]
print(f'island centre {C.x:.1f},{C.y:.1f} radius {Ri:.1f} z {zC:.2f}')

def is_road(n):
    n = n.upper(); return n[:1].isdigit() and ('ROAD' in n or 'STREET' in n) and 'PATH' not in n

def mouth(d):
    """Along direction d from the island: where the ring gives way to the side street, and its kerb-to-kerb extents."""
    d = Vector(d).normalized(); p = Vector((-d.y, d.x))
    r = Ri + 1
    edge = None
    while r < Ri + 30:
        z, n = cast(*(C + d * r))
        if 'STREET' in n.upper() and edge is None: edge = r; break
        r += 0.25
    if edge is None: edge = Ri + 8
    def extent(dist):
        q = C + d * dist; res = []
        for s in (1, -1):
            t = 0
            while t < 15 and is_road(cast(*(q + p * s * (t + 0.2)))[1]): t += 0.2
            res.append(t)
        return q, p, res
    return d, edge, extent

mats = {}
def mat(name, rgb, rough=0.6, emit=0):
    if name in mats: return mats[name]
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = rough
    mats[name] = m; return m
RED = lambda: mat('cm_red', (0.55, 0.015, 0.012), 0.45)
WHITE = lambda: mat('cm_white', (0.82, 0.82, 0.8), 0.45)
GREY = lambda: mat('cm_grey', (0.25, 0.25, 0.25), 0.7)
coll = bpy.data.collections.new('course_marks')

def add_mesh(name, verts, faces, m):
    me = bpy.data.meshes.new(name); me.from_pydata(verts, [], faces); me.update()
    me.materials.append(m)
    ob = bpy.data.objects.new(name, me); coll.objects.link(ob)
    for f in me.polygons: f.use_smooth = False
    return ob

def prism(name, centre, fwd, profile, length, m, z0):
    """Extrude a 2D profile [(across, up)] along fwd for `length`, centred on centre (x, y) at height z0."""
    fwd = Vector(fwd).normalized(); side = Vector((-fwd.y, fwd.x))
    v = []
    for s in (-length / 2, length / 2):
        for (u, h) in profile:
            q = Vector(centre) + fwd * s + side * u
            v.append((q.x, q.y, z0 + h))
    n = len(profile); f = [tuple(range(n))[::-1], tuple(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n; f.append((i, j, n + j, n + i))
    return add_mesh(name, v, f, m)

KERB = [(-0.3, 0.0), (0.3, 0.0), (0.3, 0.012), (0.15, 0.04), (-0.15, 0.04), (-0.3, 0.012)]  # 60 cm wide, 4 cm high
BARRIER = [(-0.2, 0.0), (0.2, 0.0), (0.2, 0.08), (0.1, 0.55), (-0.1, 0.55), (-0.2, 0.08)]  # 40 cm base, 55 cm high

def kerb_line(a, b, tag):
    a, b = Vector(a), Vector(b); L = (b - a).length; d = (b - a).normalized(); n = max(1, round(L / 1.0))
    for i in range(n):
        c = a + d * (L * (i + 0.5) / n)
        z = cast(c.x, c.y)[0]
        prism(f'kerb_{tag}_{i}', c, d, KERB, L / n - 0.01, RED() if i % 2 == 0 else WHITE(), z - 0.005)

def kerb_arc(r, a0, a1, tag, seg=1.0):
    n = max(2, round(abs(a1 - a0) * r / seg))
    for i in range(n):
        t0 = a0 + (a1 - a0) * i / n; t1 = a0 + (a1 - a0) * (i + 1) / n
        p0 = C + Vector((math.cos(t0), math.sin(t0))) * r; p1 = C + Vector((math.cos(t1), math.sin(t1))) * r
        c = (p0 + p1) / 2; z = cast(c.x, c.y)[0]
        prism(f'arc_{tag}_{i}', c, p1 - p0, KERB, (p1 - p0).length - 0.01, RED() if i % 2 == 0 else WHITE(), z - 0.005)

def barrier_line(q, p, ext, tag):
    a = q - p * ext[1]; b = q + p * ext[0]; L = (b - a).length; n = max(1, round(L / 1.6))
    for i in range(n):
        c = a + (b - a) * ((i + 0.5) / n); z = cast(c.x, c.y)[0]
        prism(f'barrier_{tag}_{i}', c, p, BARRIER, L / n - 0.08, RED() if i % 2 == 0 else WHITE(), z)

def chevron_board(name, pos, face_dir, point, w=1.2, h=0.6, bottom=0.45):
    """Red board with white chevrons; faces face_dir (towards the driver); chevrons point 'left'/'right' as seen by the driver."""
    f = Vector(face_dir).normalized(); right = Vector((-f.y, f.x))  # driver's right when looking against f
    z = cast(*pos)[0]
    c = Vector(pos)
    def P(u, v, off=0.0):
        q = c + right * u + f * off; return (q.x, q.y, z + bottom + v)
    # board
    t = 0.03
    v = [P(-w/2, 0, 0), P(w/2, 0, 0), P(w/2, h, 0), P(-w/2, h, 0), P(-w/2, 0, -t), P(w/2, 0, -t), P(w/2, h, -t), P(-w/2, h, -t)]
    add_mesh(name + '_board', v, [(0, 1, 2, 3), (5, 4, 7, 6), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], RED())
    # chevrons (2), slightly proud of the face
    s = 1 if point == 'right' else -1
    nchev = max(2, round(w / 0.45))
    for k in range(nchev):
        u0 = -w / 2 + 0.12 + k * (w - 0.24 - 0.31) / max(1, nchev - 1)
        if s < 0: u0 = u0 + 0.31
        th = 0.13; dx = 0.18
        tip = (u0 + s * dx + 0.0, h / 2); a = 0.08
        pts = [(u0 - s * 0.0, a), (u0 + s * th, a), (u0 + s * (th + dx), h / 2), (u0 + s * th, h - a), (u0, h - a), (u0 + s * dx, h / 2)]
        vv = [P(uu, vv2, 0.004) for (uu, vv2) in pts]
        add_mesh(f'{name}_chev{k}', vv, [tuple(range(6)) if s < 0 else tuple(range(6))[::-1]], WHITE())
    # posts
    for u in (-w/2 + 0.12, w/2 - 0.12):
        q = c + right * u - f * 0.05
        prism(f'{name}_post{u:.1f}', (q.x, q.y), f, [(-0.03, 0), (0.03, 0), (0.03, bottom + h - 0.05), (-0.03, bottom + h - 0.05)], 0.06, GREY(), z)

# Camera: on the AI line about 30 m before the ring, driver's eye 1.15 m over the road.
import os
ei = int(os.environ.get('EYE', 228))
e = AI[ei]; eye = Vector((e[2], -e[4], e[3] + 1.15))
tgt = Vector((C.x - 2, C.y + 2, zC + 0.6))
cam.data.lens = 24
cam.location = eye
cam.rotation_euler = (tgt - eye).to_track_quat('-Z', 'Y').to_euler()
scene.render.filepath = f'{out}/before.png'
if not os.environ.get('TOP'): bpy.ops.render.render(write_still=True)

# --- markings ---
scene.collection.children.link(coll)
# Kent St mouths (directions from OSM), Queen St in and out (from the AI line).
for tag, dvec in (('kent_e', (0.957, 0.29)), ('kent_w', (-0.974, -0.226))):
    d, edge, extent = mouth(dvec)
    q, p, ext = extent(edge + 0.6)
    print(tag, f'edge {edge:.1f} m, width {ext}', 'names', [cast(*(q + p * t))[1][:16] for t in range(-8, 9, 2)])
    kerb_line(q - p * ext[1], q + p * ext[0], tag)
    q2, p2, ext2 = extent(edge + 3.5)
    barrier_line(q2, p2, ext2, tag)
    # chevron board behind the barrier, facing the ring, pointing the way round (clockwise: right)
    cpos = q2 + d * 1.2
    chevron_board(f'chev_{tag}', (cpos.x, cpos.y), -d, 'right', w=1.0, h=0.5, bottom=0.35)
# Island kerb: red-white all round, just inside the island edge.
kerb_arc(Ri - 0.35, 0, 2 * math.pi, 'island')
# Chevron board on the island facing the approach, pointing left (the way into the roundabout).
app = (Vector((eye.x, eye.y)) - C).normalized()
bp = C + app * (Ri - 1.3)
chevron_board('chev_island', (bp.x, bp.y), app, 'left', w=1.8, h=0.6, bottom=0.5)
scene.render.filepath = f'{out}/after.png'
if not os.environ.get('TOP'): bpy.ops.render.render(write_still=True)
if os.environ.get('TOP'):
    cam.data.lens = 30
    cam.location = Vector((C.x, C.y, zC + 70)); cam.rotation_euler = (0, 0, 0)
    scene.render.filepath = f'{out}/top.png'
    bpy.ops.render.render(write_still=True)
