# 3D model credits

## toyota-hilux.glb

- **"2022 Toyota Hilux"** by **BHP3D** — https://sketchfab.com/3d-models/2022-toyota-hilux-82bd37c5065040098fb0b86e07fcb959
- Licence: **CC BY 4.0** — https://creativecommons.org/licenses/by/4.0/ (commercial use allowed with credit).
- **Changed:** made smaller for phones (fewer triangles, meshopt compression, WebP textures) with
  `gltf-transform optimize --compress meshopt --texture-compress webp --texture-size 1024 --simplify-ratio 0.3 --simplify-error 0.0008 --palette false --join-named false --instance false`.
- The app shows this credit on the showroom screen (`src/garage/showroom/models.ts`). Keep it there while this model is used.
