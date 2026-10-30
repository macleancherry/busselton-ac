# Baking ambient occlusion (CSP)

Every build ships `baked_shadow_params.ini` in the track folder: the settings for CSP's vertex AO
bakery. Baking adds soft contact shadow under eaves, at wall bases, under trees and where kerbs meet
the road. It's optional: the track works without it, and only CSP shows it.

1. Download the bakery from https://github.com/ac-custom-shaders-patch/acc-bakeryoptix/releases and unzip it.
2. Install the track into Assetto Corsa and close AC.
3. Run the bakery on the track's kn5, from the track folder so it finds the settings:

   ```powershell
   cd "<AC>\content\tracks\<track>"
   & "C:\Tools\bakeryoptix\bakeryoptix.exe" "<track>.kn5"
   ```

   It writes `<track>.vao-patch` next to the kn5, and CSP loads it by itself. With `USE_VULKAN = 1`
   it bakes on the GPU (Vulkan ray tracing); otherwise it falls back to the CPU.
4. Each new build changes the geometry, so bake again after installing it.

For a quick look first, change `RAYS_PER_SAMPLE` to 32 in `baked_shadow_params.ini` (96 is the
default) and put it back for the final bake.
