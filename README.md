# Renode Local Visualizer

`Renode Local Visualizer` is a local-only desktop MVP for MCU simulation.

It keeps the visual workflow from the original prototype, but moves execution into a local Electron shell:

- Wokwi-like wiring UX: common pads first, full pinout on demand
- pin-level placement on a real `NUCLEO-H753ZI` connector layout
- drag-in peripheral templates and wire-stub-to-pad gestures on the main canvas
- auto-generated Renode `.repl` and `.resc`
- local ARM GCC compilation
- local Renode startup
- bidirectional GPIO interaction through Renode's built-in `ExternalControlServer`
- live log and GPIO state visualization

## Current scope

The current MVP targets one Renode-backed demo board:

- `NUCLEO-H753ZI`
- selectable external `Button` on free pads across `CN7`, `CN8`, `CN9`, `CN10`, `CN11`, and `CN12`
- selectable external `LED` on the same routed header pads
- a default pin chooser that surfaces the most common teaching-friendly pads first
- any already-connected pad remains visible even when the full pinout is collapsed
- board top view with a more Wokwi-like workbench area, live hotspots, and pad highlights
- local `arm-none-eabi-gcc` compilation with generated startup and linker files
- local Renode launch through the bundled `renode/renode/renode.exe` when present
- GDB server enabled on port `3333`

This is intentionally narrower than a full Wokwi replacement. The goal is to finish the local execution chain first and then extend the device library and debugger UX.

## Requirements

- Windows
- Node.js 16+
- `arm-none-eabi-gcc` on `PATH`
- optional: `arm-none-eabi-gdb` on `PATH` for the next debugging stage
- optional: standalone `renode` on `PATH`

If this repository contains `renode/renode/renode.exe`, the desktop app will prefer that bundled Renode runtime over the system one.

The GitHub-published version of this project does not include the bundled Renode runtime because GitHub rejects the large `renode.exe` payload. On a fresh machine, install Renode system-wide and expose `renode` on `PATH`.

## Quick Start On A New PC

1. Install `Node.js`, `Renode`, and `arm-none-eabi-gcc`.
2. Clone this repository.
3. Run `check-env.cmd` to verify the local toolchain.
4. Run `run-dev.cmd` for development mode or `run-start.cmd` for the desktop build.

You can also use npm scripts if you prefer:

```bash
npm run check:env
npm run run:dev
npm run run:start
```

## Run

```bash
npm install
npm run dev
```

This starts:

1. the Vite renderer on `http://127.0.0.1:3000`
2. the Electron desktop shell

The helper launcher `scripts/run-local.ps1` will install dependencies automatically if `node_modules` is missing.

## Demo flow

1. Drag a `Button` template from the peripheral library into the workbench area below the board, or click `Add Button`.
2. Pull the device's cyan wire stub directly onto a hotspot on the board canvas, or use the pin chooser on the lower half of the UI.
3. Drag the device card around the workbench until the layout feels right.
4. Drag in an `LED`, wire it to another pad, and choose which button drives it.
5. If you need a less common GPIO, click `Show Full Pinout`.
6. The app regenerates `main.c`, `board.repl`, and the Renode launch preview from that wiring.
7. Click `Compile`, then `Start`.
8. Press and hold the external button card in the board canvas and watch the LED card update in real time.

## Smoke test

```bash
npm run smoke
```

This verifies the local execution chain without requiring the Electron window:

- compile bare-metal firmware
- generate `.repl` / `.resc`
- launch Renode
- connect Renode external control
- toggle the button and observe the LED
- attach GDB through MI mode

## Build

```bash
npm run build
npm run start
```

`npm run build` only builds the renderer bundle. The Electron main process and preload are plain `.cjs` files and run directly.

## Architecture

- `electron/main.cjs`
  - window bootstrap
  - toolchain detection
  - local compile pipeline
  - Renode process management
  - Renode external-control connection management
- `electron/preload.cjs`
  - safe renderer API exposed as `window.localWokwi`
- `electron/external-control.cjs`
  - minimal client for Renode `ExternalControlServer`
  - GPIO state read/write for live peripherals
- `src/App.tsx`
  - NUCLEO-H753ZI board UI with common-pin-first wiring UX
  - draggable peripherals, drag-in templates, and wire-stub hotspots for more Wokwi-like placement
  - code editor
  - compile/run controls
  - live status/log rendering
- `src/lib/firmware.ts`
  - generated firmware template from selected board pads
  - startup/runtime files
  - `.repl` / `.resc` preview generation

## What is real now

- compile action calls local `arm-none-eabi-gcc`
- run action launches Renode as a child process
- renderer no longer uses the old fake LED simulation loop
- connector-pad selection regenerates both bare-metal firmware and Renode platform wiring
- default pin selection follows the Wokwi idea of exposing the most useful pads first
- external devices can be dragged in from the library and repositioned directly on the board canvas
- each external device has a draggable wire stub that can be dropped on a board hotspot
- button presses go through Renode external control
- LED state is polled back from Renode and updates the board view
- `npm run smoke` validates compile -> simulate -> interact -> debug end to end

## What is still next

- more exact board artwork polish and richer silkscreen detail
- reusable board/device templates beyond the NUCLEO-H753ZI demo
- UART terminal and waveform panels
- persistent projects and device libraries
