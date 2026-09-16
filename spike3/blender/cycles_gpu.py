"""Small helper to force Cycles onto the CUDA GPU (falls back to CPU).

Usage (inside Blender only -- `bpy` is imported inside the function so this
module stays import-safe for a plain `python3 -m py_compile`):

    from cycles_gpu import enable_cuda
    enable_cuda(bpy.context.scene)

Notes for this machine (RTX 5090, Blender 5.0.1, driver-only CUDA):
the first-ever CUDA render JIT-compiles sm_120 kernels, which can take a few
minutes; the result is cached in ~/.cache/cycles/kernels and later renders are
fast. No CUDA toolkit is required. A no-code-change alternative is
`blender ... -- --cycles-device CUDA`.
"""


def enable_cuda(scene=None, verbose=True):
    """Switch Cycles to CUDA GPU rendering; fall back to CPU if unavailable.
    Returns 'GPU' or 'CPU'."""
    import bpy
    if scene is None:
        scene = bpy.context.scene
    addon = bpy.context.preferences.addons.get("cycles")
    if addon is None:
        raise RuntimeError(
            "cycles addon not found in bpy.context.preferences.addons; "
            "cannot enable CUDA"
        )
    prefs = addon.preferences
    prefs.compute_device_type = "CUDA"
    prefs.refresh_devices()
    cuda = [d for d in prefs.devices if d.type == "CUDA"]
    is_cycles = getattr(scene.render, "engine", None) == "CYCLES"
    if cuda:
        for d in prefs.devices:
            d.use = d.type == "CUDA"  # CPU off so it does not slow GPU tiles
        if is_cycles and hasattr(scene, "cycles"):
            scene.cycles.device = "GPU"
        if verbose:
            print(f"[cycles_gpu] CUDA device(s): {[d.name for d in cuda]} -> GPU")
        return "GPU"
    prefs.compute_device_type = "NONE"
    for d in prefs.devices:
        d.use = d.type == "CPU"  # keep a usable CPU device for fallback
    if is_cycles and hasattr(scene, "cycles"):
        scene.cycles.device = "CPU"
    if verbose:
        print("[cycles_gpu] no CUDA device, using CPU")
    return "CPU"
