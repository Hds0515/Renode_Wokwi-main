# Renode Local Visualizer

`Renode Local Visualizer` is a local-only desktop MVP for MCU simulation.

If you are studying the implementation, start with [docs/source-code-guide.md](docs/source-code-guide.md).

It keeps the visual workflow from the original prototype, but moves execution into a local Electron shell:

- Wokwi-like wiring UX: common pads first, full pinout on demand
- board selector for `NUCLEO-H753ZI`, experimental `STM32F4 Discovery`, and experimental `STM32F103 GPIO Lab`
- pin-level placement on the selected board's connector layout
- drag-in peripheral templates, endpoint-terminal-to-pad gestures, and selectable wires on the main canvas
- logical `VCC` / `GND` power rail binding for power-aware peripherals
- local project save/load as `.renode-wokwi.json`
- project schema v2 with a unified Netlist/IR plus component package catalog and SDK metadata
- Device Package schema v3 that unifies visual metadata, pins, electrical rules, protocols, Renode backends, runtime panels, example firmware, and validation fixtures
- Device Package Compiler v1 that compiles independent `packages/devices/*` packages into the runtime catalog while adapting legacy component packages during migration
- schema-driven Device Runtime Panel renderer that composes GPIO, OLED, sensor, UART, and timeline panels from Device Package runtime metadata
- peripheral behavior schema v2 so outputs can be controlled by firmware, a chosen input, or generated demo behavior instead of hard-coded LED/Button rules
- Electrical Rule Engine schema v1 for power rails, voltage domains, bus pairing, output contention, and open-drain I2C checks
- Pin Function Mux schema v1 so routed endpoints select GPIO/I2C/SPI/UART/PWM/ADC pad functions instead of relying only on text labels
- Signal Broker schema v2 with runtime signal manifest metadata
- SimulationClock schema v1 for clocked runtime events with sequence and virtual-time fields
- Bus Transaction Broker schema v1 so GPIO, UART, I2C, and SPI events share one timeline
- Protocol Runtime Registry v1 that groups GPIO, UART, I2C, and SPI runtime devices by protocol and maps them to reusable codecs, panels, and broker backends
- TCP JSONL Transaction Broker Bridge so native Renode plugins or external tools can inject bus transactions into Electron
- SSD1306 OLED component template, I2C transaction decoding, and live framebuffer preview demo
- Sensor Package schema v1 plus Sensor Package SDK v2 with reusable native Renode sensor metadata, monitor-control channels, firmware command metadata, and UI data-flow metadata
- reusable Bus Sensor Runtime that discovers package-backed sensors from the runtime bus manifest, renders channel controls, applies native Renode values, and decodes bus transactions back into visual readings
- SI7021 temperature/humidity sensor template that can be emitted as native Renode `Sensors.SI70xx` on the selected I2C bus, controlled through the Renode monitor, with brokered readouts for the UI timeline
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
- selectable external `Button`, `LED`, `Buzzer`, grouped `RGB LED`, `SSD1306 OLED`, and `SI7021 Sensor` endpoints on the selected board's teaching-friendly pads
- a default pin chooser that surfaces the most common teaching-friendly pads first
- any already-connected pad remains visible even when the full pinout is collapsed
- board top view with a more Wokwi-like workbench area, live hotspots, grouped multi-endpoint devices, and pad highlights
- board schema abstraction for board metadata, visual frames, curated pins, compiler settings, linker scripts, GPIO register model, and Renode platform path
- board-aware generated `main.c`, `board.repl`, `.resc`, compiler args, and bundled example projects
- project document schema v2 for wiring, Netlist/IR, workbench layout, code mode, and component/sensor SDK metadata
- component package catalog plus Component Package SDK v2 for `Button`, `LED`, `Buzzer`, grouped `RGB LED`, `SSD1306 OLED`, and `SI7021 Sensor` pin/capability, power-pin, behavior, terminal placement, runtime broker, and reusable result-panel definitions
- independent Device Package sources for `SI7021`, `SSD1306`, and `UART Terminal` under `packages/devices`, compiled by Device Package Compiler v1 into the UI library and runtime registry
- functional `VCC` / `GND` power rails exposed on each board profile and emitted as Netlist/IR power and ground nets
- behavior schema v2 for reusable output behavior: firmware-controlled GPIO, explicit input mirroring, or generated blink demo logic
- board pad mux metadata for GPIO input/output, I2C, SPI, UART, PWM, ADC, power, ground, and passive/control functions
- an Electrical Rule Engine that blocks unsafe electrical combinations such as mismatched I2C buses, invalid power rails, multiple output drivers, and 5V open-drain pull-ups on 3V3 MCU pins
- Signal Broker schema v2 derived from Netlist/IR GPIO nets and Electron runtime `signal` events
- runtime signal manifest passed from the renderer to Electron so signal events carry net, component, pin, pad, and MCU metadata
- SimulationClock snapshots attached to runtime `signal`, `uart`, `bus`, and `timeline` events
- runtime bus manifest generation for board UART plus discovered I2C/SPI teaching pins and package-backed bus devices
- Protocol Runtime Registry v1 derived from signal and bus manifests, so OLED displays, I2C sensors, UART terminal instruments, and GPIO endpoints are discovered through one protocol-oriented runtime layer
- Bus Sensor Runtime state derived from Sensor Package SDK v2, so native sensor control panels are generated from reusable package channels instead of hard-coded SI7021 UI state
- Bus Transaction Broker panel for UART, I2C, and future SPI protocol events
- `local-wokwi-broker.json` runtime manifest written beside generated `.repl` / `.resc` files so native plugins can discover the broker endpoint
- SSD1306 OLED preview fed by I2C transaction payloads
- reusable Bus Sensor Runtime panel with configurable package channels, native Renode sensor control, generated I2C read/write timeline transactions, and native Renode sensor attachment in generated `.repl`
- UART socket RX line buffering so firmware terminal output appears as complete lines in the transcript and Bus Transaction timeline
- live GPIO Monitor panel for pin state, last source, recent change time, and edge counts
- live Logic Analyzer panel for input/output edge samples
- local `arm-none-eabi-gcc` compilation with generated startup and linker files
- local Renode launch through the bundled `renode/renode/renode.exe` when present
- GDB server enabled on port `3333`

This is intentionally narrower than a full Wokwi replacement. The goal is to finish the local execution chain first and then extend the device library and debugger UX.

The power model is intentionally digital and educational: `VCC` / `GND` validate whether a component is logically powered and make project wiring look closer to real hardware, but they are not SPICE rails and do not simulate impedance, current draw, RC timing, or analog voltage drop.

The SI7021 path now has three layers: a reusable Sensor Package v1 declares the native Renode model and controllable channels, the UI can write temperature/humidity into the live `Sensors.SI70xx` instance through the Renode monitor, and generated MCU firmware reads that native sensor through the MCU I2C controller. The panel can still emit SI70xx-compatible broker transactions for the unified Bus Timeline. This is digital/bus-level simulation, not SPICE analog sensor physics.

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
2. Drag a `Button`, `LED`, `Buzzer`, `RGB LED`, `SSD1306 OLED`, or `SI7021 Sensor` template from the peripheral library into the workbench area below the board, or click the matching add button.
3. Pull the device's named endpoint terminal directly onto a hotspot on the board canvas, or use the pin chooser on the lower half of the UI.
4. Click any existing wire to open the inline wire action popover. From there you can `Rewire`, `Delete`, or press `Delete` / `Backspace`.
5. Drag the device card around the workbench until the layout feels right.
6. For power-aware outputs, choose `VCC` and `GND` rails in the rack below the board. Unpowered components stay visually disabled and produce validation warnings.
7. For `LED`, `Buzzer`, and `RGB LED` endpoints, choose the behavior explicitly: firmware controls GPIO, mirror one selected input, or generated blink demo logic.
8. For `SSD1306 OLED`, connect `SCL` and `SDA` to the board's I2C-capable teaching pins and bind `VCC` / `GND`. The generated runtime manifest will attach the OLED device to that bus and the I2C demo feed will update the framebuffer preview.
9. For `SI7021 Sensor`, connect `SCL` and `SDA`, bind `VCC` / `GND`, compile, then start the simulation. The Bus Sensor Runtime builds sliders from the sensor package channels; click `Apply Channels To Native Renode Sensor` to write the real Renode SI70xx instance, and use each `Read` button to emit decoded timeline transactions for UI-side inspection. Generated firmware still probes the native sensor over MCU I2C and prints readings on UART.
10. If you need a less common GPIO, click `Show Full Pinout`.
11. The app regenerates `main.c`, `board.repl`, and the Renode launch preview from that board and wiring.
12. Use `Save`, `Save As`, or `Load` in the control panel to persist the board choice, wiring, behavior, power rails, and workbench layout.
13. Or choose a bundled board-specific example in `Control -> Project -> Examples` and click `Open Example`.
14. Click `Compile`, then `Start`.
15. Press and hold the external button card in the board canvas and watch only the explicitly mirrored output cards update in real time.
16. Open a board-specific `SSD1306 OLED over I2C` or `SI7021 sensor over I2C` example to verify the complex-bus path.

## Project files

The desktop shell can save and load local `.renode-wokwi.json` files. A saved project currently stores:

- board identity for the selected board profile
- the external peripheral wiring graph
- explicit `wiring.wires[]` entries for each GPIO connection, derived from the endpoint-to-pad assignment
- per-component behavior definitions, including explicit controller selection for output endpoints
- per-component logical power bindings for `VCC` / `GND` rails
- a `pinMux` section with schema v1 function selections inferred from routed endpoints
- a unified `netlist` IR with board component, package-backed component instances, GPIO nets, and endpoint-to-pad references
- `componentPackages` v1 catalog metadata plus `componentPackageSdk` v2 terminal/runtime metadata so future packages can be versioned independently from project files
- `sensorPackages` v1 catalog metadata plus `sensorPackageSdk` v2 channel/control/data-flow metadata for reusable Renode-native sensors
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

This checks the component package catalog and SDK v2 terminal metadata, normalizes all bundled examples to project schema v2, round-trips `netlist -> wiring`, and verifies that Netlist/IR can emit `main.c`, `board.repl`, `.resc` preview, the Renode peripheral manifest, Signal Broker state, runtime bus manifests, and timeline counters.

It also verifies the SI7021 sensor package and SDK v2 channel/control metadata by exporting it into the I2C bus manifest and decoding a Renode SI70xx-compatible temperature transaction.

To validate the native Renode SI7021 path where firmware reads the sensor through the MCU I2C controller, run:

```bash
npm run smoke:si7021
```

This loads the SI7021 examples for the H7/F4/F1 board profiles, generates `Sensors.SI70xx @ i2c1 0x40` in `board.repl`, compiles firmware with the generated I2C driver, writes controlled temperature/humidity values into the live Renode sensor through the monitor, and asserts that the UART terminal prints the controlled `SI7021 T=... RH=...` measurement.

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
  - UART socket traffic line-buffered and normalized as Bus Transaction Broker events
  - native Renode sensor control through queued monitor commands for reusable Sensor Package channels
  - SSD1306 I2C demo transaction feed until the native Renode C# broker is wired in
  - TCP JSONL Transaction Broker Bridge for native C# plugins and external protocol tools
- `electron/preload.cjs`
  - safe renderer API exposed as `window.localWokwi`
  - local project save/load bridge
  - renderer-to-runtime `sendBusTransaction` and `setNativeSensor` bridges used by the SI7021 sensor panel
- `electron/external-control.cjs`
  - minimal client for Renode `ExternalControlServer`
  - GPIO state read/write for live peripherals
- `src/lib/boards.ts`
  - board schemas for identity, connector groups, teaching-friendly pad selection, board canvas coordinates, compiler defaults, linker scripts, and Renode runtime metadata
- `src/lib/firmware.ts`
  - peripheral templates, behavior schema v2, pin function mux schema v1, logical power validation, board-aware generated `main.c`, native SI7021 I2C firmware probing, and Renode `.repl` generation
- `src/lib/electrical-rules.ts`
  - Electrical Rule Engine schema v1 for power, ground, voltage domains, pin mux compatibility, I2C bus pairing, I2C pull-up safety, and output contention
- `src/App.tsx`
  - board selector plus common-pin-first wiring UX for the selected board
  - Wokwi-like endpoint terminal drag handles on single-pin and multi-endpoint devices
  - draggable peripherals, drag-in templates, grouped RGB devices, selectable wires, and endpoint terminal hotspots for more Wokwi-like placement
  - code editor
  - compile/run controls
  - live status/log rendering
- `src/lib/project.ts`
  - `.renode-wokwi.json` project document schema v2
  - project load normalization and forward-compatible warning collection
- `src/lib/component-packs.ts`
  - versioned component package catalog plus SDK v2 terminal metadata with pins, capabilities, power pins, behavior defaults, visual metadata, runtime broker binding, and result-panel hints
- `packages/devices/*`
  - independent reusable Device Package sources; `si7021`, `ssd1306`, and `uart-terminal` now own their visual metadata, pins, electrical rules, protocol model, Renode backend, runtime panels, example firmware, and validation fixtures
- `src/lib/device-package-compiler.ts`
  - Device Package Compiler v1; compiles independent package sources and adapts legacy component packages until they are migrated
- `src/lib/netlist.ts`
  - unified Netlist/IR schema
  - compiler from wiring to Netlist/IR, pin function metadata, power/ground net emission, Netlist validation, Netlist round-trip, and Renode artifact generation
- `src/lib/signal-broker.ts`
  - Signal Broker schema v2, runtime signal manifest generation, edge counting, signal definitions from Netlist/IR, runtime signal reducer, and summary helpers
- `src/lib/runtime-timeline.ts`
  - SimulationClock schema v1, runtime bus manifest generation, unified GPIO/UART/I2C/SPI timeline event types, bus transaction state, and summary helpers
- `src/lib/protocol-runtime-registry.ts`
  - Protocol Runtime Registry v1; joins signal/bus manifests with Device Packages so protocol runtimes can discover GPIO, UART, I2C, and SPI devices through one schema
- `src/lib/ssd1306.ts`
  - minimal SSD1306 command/data decoder and framebuffer state used by the OLED preview and smoke test
- `src/lib/sensor-packages.ts`
  - Sensor Package schema v1 plus SDK v2 catalog; maps the visual SI7021 to Renode `Sensors.SI70xx`, native monitor properties, I2C address, firmware command metadata, UI controls, and runtime data-flow metadata
- `src/lib/bus-sensor-runtime.ts`
  - reusable Bus Sensor Runtime for discovering package-backed I2C sensors from the runtime manifest, initializing channel state, creating native Renode monitor-control requests, emitting package read transactions, and decoding bus events back into channel values
- `src/lib/si70xx.ts`
  - Renode SI70xx-compatible temperature/humidity encoding, decoding, command classification, and SI7021 broker transaction helpers
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
- each external device has one or more draggable endpoint terminals that can be dropped on a board hotspot
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
- Bus Sensor Runtime panel is generated from Sensor Package SDK channels instead of a one-off SI7021-only state model
- I2C/SPI are manifest/schema-ready; SSD1306 has a verified runtime demo path, and SI7021 has a native Renode `Sensors.SI70xx` firmware-read smoke path
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
- compile and register `renode-plugins/LocalWokwi.Broker` against a full Renode source checkout so high-volume I2C/SPI transaction traces come from native Renode peripherals instead of the Electron demo feed
