# The Fold / Walsenburg

A complete playable web prototype of an original first-person spatial puzzle adventure, implemented in React, TypeScript, Three.js, and Vite. The setting is a compact, fictionalized Walsenburg, Colorado, with a historic main street, a Spanish Peaks skyline, lakeshore research sites, and seven connected story locations.

## Play

Run `npm install`, then `npm run dev`, or deploy the output of `npm run build`. Select **Begin your journey**, then **Enter Walsenburg** to grant mouse control. The field guide and settings are available before starting.

| Action | Default control |
| --- | --- |
| Move | WASD |
| Look | Mouse; arrow-key alternative |
| Run | Shift |
| Jump | Space |
| Blue fold | Left mouse button or 1 |
| Orange fold | Right mouse button or 2 |
| Pick up, set down, use a console | E |
| Throw a carried core | F |
| Gravity wheel (after the Vector Shifter): hold, flick, release — or tap, then click | G |
| Reset current puzzle | R |
| Field map and optional hints | Tab |
| Pause and settings | Escape |

When an embedded preview denies pointer lock, drag the world to look, click to place folds, and use the keyboard normally. Touchscreen movement and action controls are also included. Headphones are recommended; audio starts only after a user gesture.

## Implemented Systems

- Seven connected story sites: discovery, momentum, rooftop transit, lakeshore, ridge array, the mountain inversion lab, and a playable final engine sequence.
- A 120 Hz fixed-step controller with conservative capsule bounds, AABB collision, step climbing, gravity, jumping, and ground/air movement.
- Two live portal render targets using transformed cameras, screen-projected sampling, and oblique near-plane clipping. The viewer's pose determines each view, rather than a fixed camera.
- Rigid spatial transformation `destination * halfTurn * inverse(source)` for body position, view orientation, velocity, and core rotation. Momentum is preserved through the connection; collision and gravity still act normally.
- Segmented high-speed movement, aperture collision exclusions, blocked-exit checks, threshold clearing before portal replacement, and a short crossing cooldown.
- Portals can attach to any sufficiently broad, flat, solid box face, including building walls, floors, ceilings, and authored research anchors. The aperture is bounded by the actual face, placed at the impact point, and kept apart from its linked endpoint. Curved or paper-thin scenery is intentionally unsupported because it cannot hold a stable aperture.
- Portal traversal transforms your momentum and viewpoint but preserves the Vector Shifter's gravity direction. Entering a differently oriented portal does not itself change gravity.
- Fold rotation is relative to the shooter. Wall folds stand upright to your current gravity. Floor and ceiling folds, which have no up of their own, turn so their top edge points the way you face. "Floor" means floor to you: with gravity pulling east, the east wall is your floor and the world floor counts as a wall. Rotation is fixed when you fire, so turning while the shot is in flight changes nothing.
- Placement accounts for rotation. A fold is seated by its true elliptical extent at the chosen angle, so a narrow strip can hold a fold lengthwise but not across it. If there is no room, the fold is refused with a hint rather than silently rotated, keeping orientation predictable. Research anchors are at least 3.9 m each way, so they accept every rotation. A tiny blue circle, drawn on top and kept at a constant on-screen size, marks wherever the crosshair meets a surface that can hold a fold.
- Exiting a fold rotated against yours keeps the delivered roll and eases it out over roughly half a second instead of snapping upright; reduced motion snaps immediately. Heading survives exits that point you straight up or down, because it is read from the top of the view rather than reset.
- Pueblo: a second, far larger city roughly 650 m across — about the span of five of the ridge's peaks — reached by the east highway out of Walsenburg. It has a street grid, a steel district, a downtown core with a tiered tower, a civic hall and dome, a stadium, a park, and a river channel crossed by six bridges. Falling in the river returns you to the nearest promenade rather than a story checkpoint, since the city is optional exploration.
- Trinidad: a third city far to the south down the old trail highway, under Fisher's Peak. Victorian brick downtown with a neon theater blade sign, a church with a foldable steeple, a plaza with a fountain and field log, a railyard with nine boxcars, a coal camp with beehive ovens and a timbered mine adit, Trinidad Lake with a dam, the Purgatoire river on three bridges, cottonwoods, and three tethered festival balloons. Its mesa is solid stacked rock you can climb with folds. Lake and river falls return you to the nearest bank.
- City facades, roof caps, street lights, and traffic are instanced, so hundreds of buildings cost a handful of draw calls. Window panes are computed from world position in the facade shader, so a storefront and a hundred-metre tower get identically sized glass instead of a stretched texture. Portals resolve through per-instance transforms, so every broad city wall is a valid fold surface.
- The Deep Fold: a lift on the starting room's back wall (behind you as you wake) descends to a 17-room puzzle complex roughly 780 m long under Walsenburg — a hub, fifteen chambers, and a reward room with a field log. The rules are visual and consistent: white panels hold folds, dark metal never does, glass barriers stop bodies but not shots, and goo returns you to the chamber entrance. Chambers combine goo-pit crossings (low, high, and ceiling exits), glass barriers, cores on high shelves gating doors, and momentum flings (drop down a shaft into a floor fold, rocket out of another beside a high ledge), escalating from tutorial to all-at-once. R resets only the current chamber.
- Floor folds are enterable: entering or exiting a fold now ignores every collider entirely behind its plane, not only the surface it was shot onto, so stacked floors (a slab on the world ground) no longer trap you on the lower layer or block exits. Wall folds are easier to walk into: the aperture test is more forgiving, and wall folds aimed near the floor (or placed on any face under ~6.5 m tall) settle down until their bottom edge meets the floor, relative to your current gravity.
- F-01 holds a compact F-02 in its right hand, aimed forward and steadied by the left; its glow follows the last fold fired.
- The Spanish Peaks are a solid landform rather than a backdrop. The ridge mesh is generated from a single continuous height function, and a stepped collider field is generated from that same function, so nothing can walk through the rock and the walkable apron matches what is on screen. The sheet's border ring is sunk below the valley floor and the whole ridge is faded to ground level at its edges, so the base rises out of the terrain instead of floating above it.
- An accessible research station cut into that ridge. The height function carves the lab plateau and its approach trail out of the mountain, so the rock towers around the facility instead of intersecting it. Its upper observatory teaches a working six-direction Vector Shifter. Press G to change personal gravity, then use ordinary movement, camera orientation, gravity, and collisions to reach ceiling-mounted receivers.
- Console interaction rays deliberately ignore each console's own pedestal. The mountain-lab outer shutter opens automatically and has an independently operable field release, so the entrance is not blocked by a progression dead end.
- Spring-carried field cores, throwing, cube collisions, weight switches, sliding doors with occupancy checks, hatch controls, water recovery, and checkpoints.
- Original NORA dialogue, discoverable field logs, a selectable map with progressive hints, procedural wind/music/effects, stereo-panned interaction sounds, and optional system speech.
- Versioned local saves, corrupt-data fallbacks, settings, reduced motion, subtitles, adjustable field of view, mouse sensitivity, render scale, graphics quality, and fullscreen.
- Walkable building interiors: Every downtown Walsenburg building has a seamless, open walk-in entrance from the sidewalk, authentic interior flooring, overhead lighting, themed fixtures, and an interior portal-compatible white back wall:
  - **Huerfano Mercantile**: Dry goods service counter, brass cash register, flour sacks, stacked barrels, and tall wall grocery shelves.
  - **Second Street Coffee**: L-shaped espresso bar with chrome steam wands, bar stools, cafe tables, blackboard specials menu, and back armchair lounge.
  - **Mesa Theater**: Popcorn warmer concession stand, foyer archway into a grand cinema auditorium with tiered seating rows, stage, backstage stairs to the roof transit lab, and a 10m-wide Silver Projection Screen that takes portals!
  - **High Country Hardware**: Heavy timber workbench with steel vise, hardware tool pegboards, industrial paint racks, and lumber stacks.
  - **San Isabel Supply**: Central topographic relief map table, outfitter backpacks, camping tent display, wall snowshoes, and an overhead suspended canoe.
  - **Corner Books**: Aisles of floor-to-ceiling wooden bookshelves, rolling library ladder, vintage typewriter desk, and reading nook with tufted armchair and rug.
  - **The Walsenburg Post**: Historic cast-iron rotary newspaper printing press, bundles of newsprint, editor's desk with green banker's lamp, and archive filing cabinets.
  - **Peaks Motor Lodge**: Front check-in counter with brass bell, room key cubby rack, waiting sofa, and an open hallway into Guest Room 101 with queen bed, nightstand, dresser, and retro TV.
  - In addition, Pueblo's **Civic Hall** features an open classical rotunda with marble columns, council dais, and Colorado seal, while Trinidad features the **Fox Theater** auditorium with projection screen, **Holy Trinity Church** with wooden pews and altar cross, and the **Trinidad Depot** passenger waiting hall with benches and ticket booth!
- World Save & Load Manager:
  - Save multiple expedition profiles with custom names.
  - View all worlds with stage progress, chapter location, playtime, and timestamp.
  - Export worlds to `.json` backup files or import community/backup save files with a single click.
  - In-game save management: overwrite current slot or create a new world branch anytime from the pause menu or title screen.
- 9 Graphics quality presets (from simple to realistic):
  `lowest`, `wimpy`, `low`, `medium`, `high`, `higher`, `highest`, `ultra`, and `"do you want your pc to explode"`.
  Configures dynamic sun shadows, shadow map resolution (512 to 4096), portal render target size (256px to 1280px), recursive corridor depth (1 to 5 levels), and supersampling pixel ratios (up to 2.5x).
- Visual pass:
  - Lighting comes from the sky itself. The Sky shader is baked once into a prefiltered environment map, so ambient light carries the sky's colour and glass, water, metal, and city windows reflect it. The sun is a late-afternoon key light aligned with the sky's visible sun, and on High quality its shadow map follows the player, snapped to whole texels so edges do not crawl.
  - Textures are projected from world position along each face's dominant axis rather than per-box UVs, so bricks, concrete panels, and paving show at real-world scale on everything from a planter to a 90 m street. Open ground adds a broad colour drift to hide tiling.
  - A procedural cloud dome rides with the camera at the far plane, so terrain always sits in front of it. Water has per-pixel ripples; grass is root-shaded and sways in the wind; mountains are coloured by slope as well as height, with snow only where it can settle; foliage and boulders are flat-shaded. Towers show floor-slab banding and smooth, reflective glazing.
  - Portals have a constant-width rim band with flowing additive glow, a soft colour wash on the surrounding wall, an animated vortex while unlinked, an iris that opens the view when the connection forms, an overshoot on opening, and a collapsing rim when moved. Their render targets are half-float, so a view through a fold tone-maps exactly like the same view seen directly.
  - Effects use one point cloud and a single draw call: shots leave a continuous glowing trail from the device's aperture, fold openings throw sparks out across the surface, and refused or non-portal hits fizzle in grey.
  - F-02, the field device, is a new model: a lathe-turned ceramic shell, a glass core chamber with a spinning crystal and wireframe lattice, three emitter prongs that flare on firing, per-fold status lights, a gravity dial whose needle tracks the Vector Shifter, and a grip, power cell, and feed lines. It draws in its own pass after the world, with depth cleared, so it never clips into walls, and it is lit by the same sun and sky. It sways behind your turns, bobs with your stride, lifts when you fall, lowers while you carry a core, kicks on firing, and shudders when a shot is refused. Shots are cast so they leave its aperture on screen.
- Spatially chunked static geometry, instanced field cores and grass, a default low-cost rendering profile, compact portal targets, reduced-resolution adaptation on slower displays, no default shadow pass or antialiasing, reduced-frequency placement raycasts, pooled projectiles, and resource disposal.

## Project Structure

- `src/App.tsx`: title screen, game state, HUD, and menu routing.
- `src/game/engine.ts`: simulation, input, interactions, progression, and checkpoints.
- `src/game/portals.ts`: portal geometry, spatial transforms, live rendering, and aperture tests.
- `src/game/gravity.ts`: six-direction gravity basis, camera, and movement orientation.
- `src/game/world.ts`: connected procedural world, free-surface placement, mountain lab, props, and puzzle mechanisms.
- `src/game/types.ts`: settings, save migrations, seven objectives, original dialogue, and research notes.
- `src/game/audio.ts`: original procedural soundscape and optional narration.
- `src/game/checks.ts`: deterministic spatial transform self-checks, run when the engine initializes.
- `src/components/`: accessible dialogs, field guide, local map, settings, and game host.
- `desktop/`: sandboxed Electron wrapper and Windows x64 packaging instructions.

## Scope And Verification

The Vite production build has been verified in the available environment. Performance improvements are structural; measured before/after frame-rate benchmarks are not available here. A browser automation runtime, GPU gameplay test runner, and Windows compiler/desktop are not provided, so an end-to-end playthrough and the packaged Windows executable have **not** been tested here. The five portal-transform self-checks run in the browser at engine startup and report failures to the console; they are not a replacement for collision, rendering, or gameplay testing.

`tests/portal-math.test.ts` also covers all 36 cardinal surface pairings, fast swept crossings, backface rejection, crossing cooldown, disconnected portals, floor apertures, selective backing-collider exclusions, the camera/movement bases for all six gravity directions, shooter-relative fold rotation in ordinary and sideways gravity, upright exits from floor folds, rotation-aware seating, and heading recovery when looking straight up. Run it locally with `npx --yes --package tsx tsx --test tests/portal-math.test.ts`. These Node tests are supplied but have not been executed by the current build-only tool environment. Use `npx tsc --noEmit` for a separate strict TypeScript check.

This is a compact prototype, not the full commercial-scale adventure described in the brief. The scene is an original, stylized procedural interpretation rather than a surveyed town reconstruction. The generated title artwork is concept art, not a gameplay screenshot. Distant mountain terrain is a 3D vista; the ridge trail, cut-rock field station, and observatory are explorable, but the entire mountain range is not. The lake is a checkpoint-recovery hazard, not a swimming simulation.

Portals render recursively: a fold visible inside its own view shows the next level of the corridor. The chain is geometrically exact — the disc samples its texture by the rendering camera's screen position, and every portal camera shares the viewer's projection, so level n can display level n+1 with no approximation. Passes run deepest-first through ping-pong render targets (2 per-frame levels on Performance, 3 on Balanced, 4 on High), and the deepest level shows last frame's final texture, so a still corridor deepens by one level every frame toward the horizon. Sun shadows now update once per frame rather than once per pass, which offsets most of the recursion's cost.

The player has a body: F-01, a ceramic survey robot in the device's design language, with a glowing visor and chest core, a procedural walk cycle, a fall tuck with heel thrusters, and a carry pose. It is hidden from the first-person camera (so it can never block your view) but visible to portal cameras — step up to a linked fold and you can watch yourself, and through a recursive corridor, a queue of yourselves. On High quality it also casts your shadow.

The player collision shape uses conservative gravity-aligned capsule bounds against axis-aligned geometry, and cores use a lightweight box solver rather than a general rigid-body engine. The Vector Shifter moves the player, not the entire simulated universe; weighted test cores continue to use ordinary environmental gravity. Half-body duplicate rendering while straddling a portal plane is not implemented. Water does not use planar reflections. Lasers, destructible geometry, runtime world streaming, authored human voice recordings, and a signed installer are outside this prototype's scope.

All gameplay geometry, surface textures, field-device geometry, dialogue, and synthesized sounds are original to this project. Local Barlow Condensed, Manrope, and IBM Plex Mono font packages retain their upstream open-font licenses. Three.js, React, and other dependencies retain their respective package licenses.

For Windows build instructions and the release test checklist, see `desktop/README.md`.