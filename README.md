# Renode Local Visualizer

`Renode Local Visualizer` is a local-only desktop MVP for MCU simulation.

It keeps the visual workflow from the original prototype, but moves execution into a local Electron shell:

- pin-level GPIO placement on a demo board
- auto-generated Renode `.repl` and `.resc`
- local ARM GCC compilation
- local Renode startup
- bidirectional peripheral events through a local socket bridge
- live log and GPIO state visualization

## Current scope

The current MVP targets one Renode-backed demo board:

- `STM32F4 GPIO Explorer`
- selectable external `Button` on any `PAx`..`PKx` pin
- selectable external `LED` on any `PAx`..`PKx` pin
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

## Run

```bash
npm install
npm run dev
```

This starts:

1. the Vite renderer on `http://127.0.0.1:3000`
2. the Electron desktop shell

## Demo flow

1. Click `Place Button`, then click any GPIO pin card such as `PB0` or `PC13`.
2. Click `Place LED`, then click another GPIO pin card such as `PA5` or `PD3`.
3. The app regenerates `main.c`, `board.repl`, and the Renode launch preview from that wiring.
4. Click `Compile`, then `Start`.
5. Press and hold the external button card in the board canvas and watch the LED card update in real time.

## Smoke test

```bash
npm run smoke
```

This verifies the local execution chain without requiring the Electron window:

- compile bare-metal firmware
- generate `.repl` / `.resc`
- launch Renode
- connect the local bridge
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
  - TCP bridge connection management
- `electron/preload.cjs`
  - safe renderer API exposed as `window.localWokwi`
- `src/App.tsx`
  - GPIO demo board UI
  - code editor
  - compile/run controls
  - live status/log rendering
- `src/lib/firmware.ts`
  - generated firmware template from selected GPIO pins
  - startup/runtime files
  - `.repl` / `.resc` preview generation
- `renode_bridge.py`
  - Renode-side Python bridge for button/LED events

## What is real now

- compile action calls local `arm-none-eabi-gcc`
- run action launches Renode as a child process
- renderer no longer uses the old fake LED simulation loop
- GPIO pin selection regenerates both bare-metal firmware and Renode platform wiring
- button presses go to the local bridge
- LED state comes back from Renode and updates the board view
- `npm run smoke` validates compile -> simulate -> interact -> debug end to end

## What is still next

- exact board artwork for specific Nucleo/Discovery layouts
- reusable board/device templates beyond the STM32F4 GPIO demo
- UART terminal and waveform panels
- persistent projects and device libraries
