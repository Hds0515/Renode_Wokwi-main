# Renode Local Visualizer

`Renode Local Visualizer` is a local-only desktop MVP for MCU simulation.

It keeps the visual workflow from the original prototype, but moves execution into a local Electron shell:

- Wokwi-like wiring UX: common pads first, full pinout on demand
- board selector for `NUCLEO-H753ZI`, experimental `STM32F4 Discovery`, and experimental `STM32F103 GPIO Lab`
- pin-level placement on the selected board's connector layout
- drag-in peripheral templates, wire-stub-to-pad gestures, and selectable wires on the main canvas
- logical `VCC` / `GND` power rail binding for power-aware peripherals
- local project save/load as `.renode-wokwi.json`
- project schema v2 with a unified Netlist/IR plus component package catalog metadata
- peripheral behavior schema v2 so outputs can be controlled by firmware, a chosen input, or generated demo behavior instead of hard-coded LED/Button rules
- Signal Broker schema v2 with runtime signal manifest metadata
- SimulationClock schema v1 for clocked runtime events with sequence and virtual-time fields
- Bus Transaction Broker schema v1 so GPIO, UART, I2C, and SPI events share one timeline
- TCP JSONL Transaction Broker Bridge so native Renode plugins or external tools can inject bus transactions into Electron
- SSD1306 OLED component template, I2C transaction decoding, and live framebuffer preview demo
- Renode C# Broker plugin skeleton for the next native in-process I2C/SPI integration stage
- GPIO Monitor for live per-pin level, direction, source, and edge counts
- Logic Analyzer MVP for live digital waveforms from connected GPIO endpoints
- bundled example projects that can be opened from the control panel
- auto-generated Renode `.repl` and `.resc`
- local ARM GCC compilation
- local Renode startup
- bidirectional GPIO interaction through Renode's built-in `ExternalControlServer`
- live log and GPIO state visualization

## Current scope

The current MVP has one validated Renode-backed board plus two Renode-verified experimental STM32F1/F4 GPIO profiles:

- `NUCLEO-H753ZI` is the default validated board.
- `STM32F4 Discovery` uses Renode's board-level `platforms/boards/stm32f4_discovery.repl`.
- `STM32F103 GPIO Lab` uses Renode's `platforms/cpus/stm32f103.repl` CPU/platform profile with Blue Pill-style teaching pins because the bundled Renode tree does not provide a full Blue Pill board file.
- selectable external `Button`, `LED`, `Buzzer`, grouped `RGB LED`, and `SSD1306 OLED` endpoints on the selected board's teaching-friendly pads
- a default pin chooser that surfaces the most common teaching-friendly pads first
- any already-connected pad remains visible even when the full pinout is collapsed
- board top view with a more Wokwi-like workbench area, live hotspots, grouped multi-endpoint devices, and pad highlights
- board schema abstraction for board metadata, visual frames, curated pins, compiler settings, linker scripts, GPIO register model, and Renode platform path
- board-aware generated `main.c`, `board.repl`, `.resc`, compiler args, and bundled example projects
- project document schema v2 for wiring, Netlist/IR, workbench layout, code mode, and component package metadata
- component package catalog for `Button`, `LED`, `Buzzer`, grouped `RGB LED`, and `SSD1306 OLED` pin/capability, power-pin, and behavior definitions
- functional `VCC` / `GND` power rails exposed on each board profile and emitted as Netlist/IR power and ground nets
- behavior schema v2 for reusable output behavior: firmware-controlled GPIO, explicit input mirroring, or generated blink demo logic
- Signal Broker schema v2 derived from Netlist/IR GPIO nets and Electron runtime `signal` events
- runtime signal manifest passed from the renderer to Electron so signal events carry net, component, pin, pad, and MCU metadata
- SimulationClock snapshots attached to runtime `signal`, `uart`, `bus`, and `timeline` events
- runtime bus manifest generation for board UART plus discovered I2C/SPI teaching pins and package-backed bus devices
- Bus Transaction Broker panel for UART, I2C, and future SPI protocol events
- `local-wokwi-broker.json` runtime manifest written beside generated `.repl` / `.resc` files so native plugins can discover the broker endpoint
- SSD1306 OLED preview fed by I2C transaction payloads
- live GPIO Monitor panel for pin state, last source, recent change time, and edge counts
- live Logic Analyzer panel for input/output edge samples
- local `arm-none-eabi-gcc` compilation with generated startup and linker files
- local Renode launch through the bundled `renode/renode/renode.exe` when present
- GDB server enabled on port `3333`

This is intentionally narrower than a full Wokwi replacement. The goal is to finish the local execution chain first and then extend the device library and debugger UX.

The power model is intentionally digital and educational: `VCC` / `GND` validate whether a component is logically powered and make project wiring look closer to real hardware, but they are not SPICE rails and do not simulate impedance, current draw, RC timing, or analog voltage drop.

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

1. Choose a board in `Board Selector`. Switching boards updates the visible pins, compiler target, Renode platform, generated code, and bundled examples.
2. Drag a `Button`, `LED`, `Buzzer`, `RGB LED`, or `SSD1306 OLED` template from the peripheral library into the workbench area below the board, or click the matching add button.
3. Pull the device's cyan wire stub directly onto a hotspot on the board canvas, or use the pin chooser on the lower half of the UI.
4. Click any existing wire to open the inline wire action popover. From there you can `Rewire`, `Delete`, or press `Delete` / `Backspace`.
5. Drag the device card around the workbench until the layout feels right.
6. For power-aware outputs, choose `VCC` and `GND` rails in the rack below the board. Unpowered components stay visually disabled and produce validation warnings.
7. For `LED`, `Buzzer`, and `RGB LED` endpoints, choose the behavior explicitly: firmware controls GPIO, mirror one selected input, or generated blink demo logic.
8. For `SSD1306 OLED`, connect `SCL` and `SDA` to the board's I2C-capable teaching pins and bind `VCC` / `GND`. The generated runtime manifest will attach the OLED device to that bus and the I2C demo feed will update the framebuffer preview.
9. If you need a less common GPIO, click `Show Full Pinout`.
10. The app regenerates `main.c`, `board.repl`, and the Renode launch preview from that board and wiring.
11. Use `Save`, `Save As`, or `Load` in the control panel to persist the board choice, wiring, behavior, power rails, and workbench layout.
12. Or choose a bundled board-specific example in `Control -> Project -> Examples` and click `Open Example`.
13. Click `Compile`, then `Start`.
14. Press and hold the external button card in the board canvas and watch only the explicitly mirrored output cards update in real time.
15. Open a board-specific `SSD1306 OLED over I2C` example to verify the complex-bus path. On start, the runtime emits an I2C write transaction that the UI decodes into the OLED framebuffer preview.

## Project files

The desktop shell can save and load local `.renode-wokwi.json` files. A saved project currently stores:

- board identity for the selected board profile
- the external peripheral wiring graph
- explicit `wiring.wires[]` entries for each GPIO connection, derived from the endpoint-to-pad assignment
- per-component behavior definitions, including explicit controller selection for output endpoints
- per-component logical power bindings for `VCC` / `GND` rails
- a unified `netlist` IR with board component, package-backed component instances, GPIO nets, and endpoint-to-pad references
- `componentPackages` catalog metadata so future packages can be versioned independently from project files
- Wokwi-like workbench card positions
- collapsed/full pinout view state
- generated/manual source mode and manual `main.c` content
- a template catalog version and the template kinds used by this build

The schema keeps the legacy `wiring` field for compatibility, but the Renode generation path now compiles through `src/lib/netlist.ts`. That gives future board templates and richer external devices one stable IR instead of letting UI state leak directly into `.repl` generation.

## Bundled Examples

The `examples/` folder contains ready-to-load NUCLEO project files:

- `button-led.renode-wokwi.json`
- `button-buzzer.renode-wokwi.json`
- `multi-button-rgb.renode-wokwi.json`

The desktop app also generates board-specific bundled examples from `src/lib/examples.ts`, so the example dropdown switches between NUCLEO, STM32F4, and STM32F1 projects with the board selector.

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

To validate every board profile and prove that user-edited peripheral interfaces still simulate, run:

```bash
npm run validate:boards
```

This checks each board's referenced Renode platform file, remaps the bundled button-to-LED example onto alternate selectable pins, regenerates `main.c` and `board.repl`, compiles with that board's GCC/linker settings, launches Renode, presses the remapped button through ExternalControl, and waits for the remapped LED on/off events.

To validate the schema compiler without launching Renode, run:

```bash
npm run validate:netlist
```

This checks the component package catalog, normalizes all bundled examples to project schema v2, round-trips `netlist -> wiring`, and verifies that Netlist/IR can emit `main.c`, `board.repl`, `.resc` preview, the Renode peripheral manifest, Signal Broker state, runtime bus manifests, and timeline counters.

To validate the SSD1306 I2C transaction path without opening Electron, run:

```bash
npm run smoke:i2c
```

This loads the NUCLEO SSD1306 example, compiles firmware, starts Renode, emits the runtime I2C demo transaction, decodes the SSD1306 payload, and asserts that the virtual OLED framebuffer changes.

To validate the native-plugin-facing TCP JSONL bridge, run:

```bash
npm run smoke:broker
```

This starts the same Renode workspace with the built-in demo feed disabled, connects to the Transaction Broker Bridge as an external client, sends an SSD1306 I2C write transaction, and verifies that the OLED framebuffer updates from broker input.

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
  - runtime `signal` events for button injection and Renode LED polling, enriched by `signalManifest`
  - SimulationClock snapshots and unified `timeline` events for GPIO/UART runtime activity
  - UART socket traffic normalized as Bus Transaction Broker events
  - SSD1306 I2C demo transaction feed until the native Renode C# broker is wired in
  - TCP JSONL Transaction Broker Bridge for native C# plugins and external protocol tools
- `electron/preload.cjs`
  - safe renderer API exposed as `window.localWokwi`
  - local project save/load bridge
- `electron/external-control.cjs`
  - minimal client for Renode `ExternalControlServer`
  - GPIO state read/write for live peripherals
- `src/lib/boards.ts`
  - board schemas for identity, connector groups, teaching-friendly pad selection, board canvas coordinates, compiler defaults, linker scripts, and Renode runtime metadata
- `src/lib/firmware.ts`
  - peripheral templates, behavior schema v2, logical power validation, board-aware generated `main.c`, and Renode runtime manifest generation
- `src/App.tsx`
  - board selector plus common-pin-first wiring UX for the selected board
  - draggable peripherals, drag-in templates, grouped RGB devices, selectable wires, and wire-stub hotspots for more Wokwi-like placement
  - code editor
  - compile/run controls
  - live status/log rendering
- `src/lib/project.ts`
  - `.renode-wokwi.json` project document schema v2
  - project load normalization and forward-compatible warning collection
- `src/lib/component-packs.ts`
  - versioned component package catalog with pins, capabilities, power pins, behavior defaults, visual metadata, and Renode GPIO runtime binding
- `src/lib/netlist.ts`
  - unified Netlist/IR schema
  - compiler from wiring to Netlist/IR, power/ground net emission, Netlist validation, Netlist round-trip, and Renode artifact generation
- `src/lib/signal-broker.ts`
  - Signal Broker schema v2, runtime signal manifest generation, edge counting, signal definitions from Netlist/IR, runtime signal reducer, and summary helpers
- `src/lib/runtime-timeline.ts`
  - SimulationClock schema v1, runtime bus manifest generation, unified GPIO/UART/I2C/SPI timeline event types, bus transaction state, and summary helpers
- `src/lib/ssd1306.ts`
  - minimal SSD1306 command/data decoder and framebuffer state used by the OLED preview and smoke test
- `renode-plugins/LocalWokwi.Broker`
  - standalone C# Broker plugin skeleton with an I2C transaction broker, JSON-line/TCP transaction sinks, and integration notes for adapting it to Renode's native `II2CPeripheral` APIs
- `src/lib/examples.ts`
  - board-specific bundled project catalog used by the control-panel example opener
- `src/lib/firmware.ts`
  - board-aware pad lookup, workbench device grouping, and first external-peripheral template schema
  - generated firmware template from selected board pads
  - startup/runtime files
  - `.repl` / `.resc` preview generation

## What is real now

- compile action calls local `arm-none-eabi-gcc`
- run action launches Renode as a child process
- renderer no longer uses the old fake LED simulation loop
- connector-pad selection regenerates both bare-metal firmware and Renode platform wiring
- board selector switches visible pins, generated firmware, `.repl`, `.resc`, compiler args, linker script, and bundled examples
- default pin selection follows the Wokwi idea of exposing the most useful pads first
- external devices can be dragged in from the library and repositioned directly on the board canvas
- each external device has a draggable wire stub that can be dropped on a board hotspot
- placed wires are selectable, can be deleted, and can be put back into rewire mode from the board canvas
- grouped devices such as `RGB LED` share one workbench card while still exposing multiple GPIO endpoints
- projects can be saved and loaded locally as `.renode-wokwi.json`
- project loading now normalizes compatible files, upgrades them into project schema v2, and reports schema/pad/reference warnings in the log
- bundled examples can be opened from the control panel and mirrored as project files under `examples/`
- `wiring` now compiles into a unified Netlist/IR before emitting Renode files and generated firmware
- Signal Broker records UI-predicted button edges plus Electron runtime button/LED `signal` events into one timeline
- SimulationClock gives runtime events a monotonic sequence plus host-estimated virtual time so UI panels do not rely on unsynchronized wall-clock-only samples
- Bus Transaction Broker records UART RX/TX/status traffic and SSD1306 I2C demo transactions into the same unified event stream as GPIO samples
- external clients can stream protocol transactions through the TCP JSONL broker bridge and update the same UI panels as built-in runtime events
- I2C/SPI are manifest/schema-ready; SSD1306 has a verified runtime demo path, while the native Renode C# plugin is currently a skeleton awaiting direct Renode API binding
- SSD1306 OLED examples are generated for each board and render decoded I2C payloads into a live frontend framebuffer preview
- GPIO Monitor uses Signal Broker schema v2 to show each connected pin's level, direction, source, last change, and edge count
- Logic Analyzer renders the most recent GPIO signal window from the Signal Broker sample stream
- `npm run validate:netlist` validates component packages, Netlist round-trips, examples, and Renode artifacts
- button presses go through Renode external control
- LED state is polled back from Renode and updates the board view
- `npm run smoke` validates compile -> simulate -> interact -> debug end to end
- `npm run validate:boards` validates NUCLEO-H753ZI, STM32F4 Discovery, and STM32F103 GPIO Lab platform paths plus remapped-button-to-LED simulation

## What is still next

- more exact board artwork polish and richer silkscreen detail
- expand the STM32F1/F4 board profiles from GPIO teaching coverage toward richer board-specific peripherals and hardware examples
- explicit project schema migrations when v3 fields are introduced
- waveform panels and richer virtual instruments
- richer device libraries
- compile and register `renode-plugins/LocalWokwi.Broker` against a full Renode source checkout so I2C/SPI transactions come from native Renode peripherals instead of the Electron demo feed
