# Source Code Learning Guide

这份导览用于学习当前项目的代码结构。它不是完整 API 文档，也不替代源码注释，而是帮你建立一个稳定的阅读顺序：先看数据如何流动，再看每个模块负责哪一段，最后再去扩展新板型、新外设和新协议。

## 1. 先记住主链路

当前项目的核心链路是：

```text
用户选择板型、拖入外设、拖线到引脚
-> React 维护 wiring 状态
-> createNetlistFromWiring() 生成 CircuitNetlist
-> compileNetlistToRenodeArtifacts() 生成 main.c / board.repl / run.resc / manifests
-> Generated Demo: Electron compileFirmware() 调用 arm-none-eabi-gcc 生成 firmware.elf
-> User Firmware: Electron importUserFirmware() 复制用户 .elf 到当前 workspace
-> Electron startSimulation() 启动 Renode 并执行 sysbus LoadELF
-> Renode 通过 GPIO/UART/I2C/SPI/传感器事件回传状态
-> App.tsx 根据 manifest 和 runtime registry 更新 LED、UART、逻辑分析仪、OLED、传感器面板
```

这条链路里最重要的思想是：前端不直接理解 Renode 细节，Renode 也不理解画布图形。中间靠 Netlist/IR、Device Package、Runtime Manifest 和 Protocol Runtime Registry 做翻译。

## 2. 代码分层

建议按下面的层次理解项目：

```text
UI 工作流层
src/App.tsx

项目数据和电路 IR 层
src/lib/project.ts
src/lib/netlist.ts

元件包和协议描述层
packages/devices/*
src/lib/device-package-types.ts
src/lib/device-package-compiler.ts
src/lib/device-packages.ts
src/lib/component-packs.ts
src/lib/sensor-packages.ts

运行时发现和可视化层
src/lib/signal-broker.ts
src/lib/runtime-timeline.ts
src/lib/protocol-runtime-registry.ts
src/lib/device-runtime-registry.ts
src/lib/bus-sensor-runtime.ts
src/lib/ssd1306.ts
src/lib/si70xx.ts

本地执行层
electron/main.cjs
electron/preload.cjs
electron/runtime.cjs
```

如果你第一次读，不要从 `App.tsx` 第一行一路读到底。先读这份文档，再按下面的入口逐个击破。

## 3. 四个核心问题

### 问题一：UI 中的线端连接，在哪里变成 Netlist?

入口在 `src/App.tsx`：

```ts
const circuitNetlist = useMemo(() => createNetlistFromWiring(wiring, selectedBoard), [selectedBoard, wiring]);
```

真正转换在 `src/lib/netlist.ts`：

- `createNetlistFromWiring()`: 把 UI 的 `DemoWiring` 转成统一 `CircuitNetlist`。
- `createBoardComponent()`: 把开发板可见引脚变成 board component。
- `createComponentInstanceFromDevice()`: 把 LED、按钮、OLED、SI7021 等工作区元件变成 component。
- `signalNets`: 把 GPIO/I2C 端点连接到 MCU pad。

注意：当前项目不再生成外部 VCC/GND 可视化连线，也不会把 VCC/GND 作为项目保存信息写进 Netlist/IR。真正会影响 Renode 仿真的仍然是 GPIO/I2C/UART/SPI 等数字协议连接。

### 问题二：Netlist 在哪里生成 `.repl/.resc/main.c`?

入口在 `src/lib/netlist.ts`：

```ts
compileNetlistToRenodeArtifacts()
```

它会把 `CircuitNetlist` 临时转回兼容的 wiring 结构，然后调用 `src/lib/firmware.ts` 里的生成器：

- `generateDemoMainSource()`: 生成默认 demo C 固件。
- `generateBoardRepl()`: 生成 board.repl，挂载 GPIO、native Renode sensor、I2C 外设等。
- `generateRescPreview()`: 生成 run.resc 预览。
- `buildPeripheralManifest()`: 生成 GPIO bridge manifest。

当前项目现在有两条固件路径。`Generated Demo` 会继续自动生成 C 代码并编译 ELF；`User Firmware` 会复用同一份 `.repl/.resc/manifest`，但跳过 GCC，直接导入用户已经编译好的 `.elf`。

### 问题三：ELF 在哪里编译，Renode 在哪里 LoadELF?

入口在 `src/App.tsx`：

- `compileFirmware`: Generated Demo / Manual C 模式下发起编译；User Firmware 模式下转为导入 `.elf`。
- `importUserFirmware`: 打开文件选择器，把用户 `.elf` 导入当前 workspace。
- `startSimulation`: 前端发起仿真请求，不关心 ELF 来自编译还是导入。

真正执行在 `electron/runtime.cjs`：

- `compileFirmware()`: 写入 `main.c/startup.c/linker.ld`，调用 `arm-none-eabi-gcc`，生成 `firmware.elf`。
- `importUserFirmware()`: 校验 `.elf` 文件，把它复制到 `workspace/user-firmware/`，并把这个 ELF 作为当前 build artifact。
- `startSimulation()`: 写入 `board.repl/run.resc`，启动 Renode 子进程。
- `run.resc` 内部包含 `sysbus LoadELF @...`，这个路径既可以是自动编译出来的 ELF，也可以是用户导入的 ELF。
- 同时创建 ExternalControlServer、UART socket terminal、GDB server、Transaction Broker Bridge。

这就是为什么项目以前“看起来不需要用户上传 ELF”：因为默认走自动生成 demo C 代码并编译出 ELF。现在可以切换到 `User Firmware`，它更接近 Proteus 的“加载用户固件再仿真”工作流；MVP 阶段先支持 `.elf`，后续再扩展 `.hex/.bin`。

### 问题四：Renode 的运行事件在哪里回到前端并更新可视化?

入口在 `electron/runtime.cjs`：

- `emitSignal()`: 把 GPIO 状态变成 `signal` 事件。
- `emitUart()` 和 `emitUartLineBuffered()`: 把 UART socket 输出变成 UART/timeline 事件。
- `emitBusTransaction()`: 把 I2C/SPI/UART transaction 变成统一 timeline 事件。
- `setNativeSensor()`: 通过 Renode monitor 修改 native sensor 的属性，例如温度和湿度。

前端接收在 `src/App.tsx`：

```ts
window.localWokwi.onSimulationEvent(...)
```

之后分发到不同 reducer：

- `recordSignalSample()`: 更新 GPIO Monitor 和 Logic Analyzer。
- `recordRuntimeTimelineEvent()`: 更新统一时间线。
- `applySsd1306Transaction()`: 把 I2C 数据解码成 OLED framebuffer。
- `applyBusSensorRuntimeEvent()`: 把 I2C sensor transaction 解码成传感器读数。
- `applyNativeSensorControlValues()`: 把 Renode native sensor 控制结果同步回 UI。

## 4. Device Package 应该怎么读

现在推荐从独立包开始读：

- `packages/devices/si7021/index.ts`
- `packages/devices/ssd1306/index.ts`
- `packages/devices/uart-terminal/index.ts`

每个 Device Package 主要描述八类信息：

- `visual`: 元件在元件库和画布上的视觉信息。
- `pins`: 元件暴露哪些 Renode 相关端点，比如 SIG、SCL、SDA、TX、RX。
- `electricalRules`: 历史字段名仍然保留，但当前只建议表达数字仿真规则，比如引脚方向、总线成对关系、输出冲突；不要用它做 VCC/GND/电阻的 SPICE 式校验。
- `protocol`: 主协议和 transaction model，比如 `i2c`、`framebuffer-i2c`。
- `renodeBackend`: 使用 signal broker、bus transaction broker、native Renode sensor，还是 virtual UART terminal。
- `runtimePanel`: UI 应该组合哪些运行时面板和事件解析器。
- `exampleFirmware`: 默认 demo 固件需要什么驱动。
- `validationFixture`: 用哪个示例项目或 smoke test 验证这个包可复用。

编译入口在 `src/lib/device-package-compiler.ts`：

- `compileDevicePackageSource()`: 编译独立包。
- `compileComponentDevicePackage()`: 兼容旧 component package。
- `compileDevicePackageCatalog()`: 合并独立包和旧包，独立包优先。

运行时 catalog 入口在 `src/lib/device-packages.ts`。

## 5. Protocol Runtime Registry 应该怎么读

`src/lib/protocol-runtime-registry.ts` 是后续扩展外设生态的关键。它解决的问题是：不要让 OLED、传感器、UART、SPI Flash 分别扫描 manifest，而是先按协议统一发现运行时设备。

输入：

- `RuntimeBusManifestEntry[]`: 来自 `createRuntimeBusManifest()`，负责 UART/I2C/SPI。
- `SignalDefinition[]`: 来自 `createSignalDefinitionsFromNetlist()`，负责 GPIO。
- `BoardSchema`: 当前板型信息。

输出：

- `ProtocolRuntimeRegistry`: 按 GPIO、UART、I2C、SPI 分组后的运行时视图。
- `ProtocolRuntimeDevice`: 每个运行时设备的统一描述。
- `ProtocolRuntimeBus`: 每条 UART/I2C/SPI 总线的统一描述。

当前用法：

- `getProtocolRuntimeDevicesByModel(registry, 'ssd1306', 'i2c')`: 找 OLED。
- `getBusSensorRuntimeDevicesFromProtocolRegistry(registry)`: 找 I2C 传感器。
- `ProtocolRuntimeRegistryPanel`: 在前端展示协议 runtime 摘要。

后续新增 SPI Flash、I2C EEPROM、更多传感器时，优先让它们被这个 registry 发现，再接具体 codec 和面板。

## 6. 传感器运行时应该怎么读

传感器相关文件：

- `src/lib/sensor-packages.ts`: 传感器 SDK 元数据，例如 SI7021 的 Renode 类型、地址、通道、属性名。
- `src/lib/bus-sensor-runtime.ts`: 通用传感器运行时状态和控制逻辑，不直接写死某一个传感器协议。
- `src/lib/sensor-protocol-codecs.ts`: 传感器协议 codec registry，负责按 package 中声明的 codec 找到对应解析器。
- `src/lib/si70xx.ts`: SI70xx 协议 codec 的底层工具，负责命令、raw 数据、温湿度转换。
- `packages/devices/si7021/index.ts`: SI7021 作为可拖拽 Device Package 的声明。

SI7021 的闭环是：

```text
用户拖入 SI7021 并连接 SCL/SDA
-> Netlist 发现 I2C sensor
-> board.repl 挂载 Sensors.SI70xx
-> main.c 生成 I2C 读取代码
-> Renode 内部 MCU 固件读取 I2C sensor
-> UART 输出温湿度
-> 前端通过 UART/timeline/sensor runtime 可视化
```

如果你添加 Renode 已支持的传感器，优先复用 native Renode peripheral。如果 Renode 没有，就需要写 C# peripheral 或先写 broker/codec 原型。

## 7. 前端应该怎么修改

主要区域在 `src/App.tsx`：

- 顶部 import：能看到 UI 依赖哪些 schema 和 runtime helper。
- `WiringWorkbench`: 板图、元件、端点、拖线手势。
- `DeviceRuntimePanelRenderer`: 根据 Device Package 的 `runtimePanel` 自动组合面板。
- `ProtocolRuntimeRegistryPanel`: 展示按协议发现到的运行时设备。
- `BusSensorRuntimePanel`: 根据 sensor package channel 自动渲染传感器滑块和读数。
- `compileFirmware` / `importUserFirmware`: 准备 Renode 要加载的 ELF，前者编译生成 demo C，后者导入用户已有 `.elf`。
- `startSimulation`: 把 Renode artifacts 和 manifests 交给 Electron 启动仿真。
- `onSimulationEvent`: 接收 Electron/Renode 事件并更新可视化状态。

修改样式时，优先改组件内部 JSX 和 Tailwind class。修改逻辑时，先判断它属于 UI 状态、Netlist 编译、Device Package、Protocol Runtime，还是 Electron/Renode 执行层，不要把 Renode 逻辑直接塞进 UI。

## 8. 新增外设的推荐步骤

新增一个 I2C 传感器时：

1. 在 `packages/devices/<sensor>/index.ts` 添加 Device Package。
2. 在 `src/lib/sensor-packages.ts` 添加 sensor package 和 channel 元数据。
3. 如果协议与 SI70xx 不同，在 `src/lib/<codec>.ts` 或 `src/lib/sensor-protocol-codecs.ts` 添加 codec，并注册到 `SENSOR_PROTOCOL_CODECS`。
4. 不要在 `src/lib/bus-sensor-runtime.ts` 写新的传感器分支；它应该通过 codec registry 自动调用对应的 transaction decode。
5. 确认 `src/lib/runtime-timeline.ts` 能把它加入 runtime bus manifest。
6. 如果要 MCU 真正读到数据，在 `src/lib/firmware.ts` 生成对应固件读写逻辑。
7. 如果 Renode 已支持该传感器，在 `.repl` 中挂 native peripheral。
8. 如果 Renode 不支持，准备 C# peripheral 或 broker-based MVP。
9. 给 `scripts/validate-device-packages.cjs`、`scripts/validate-netlist.cjs` 或 smoke script 加验证。

新增一个 SPI 器件时：

1. 先扩展 Device Package 的 `protocol` 和 `pins`，声明 SCK/MISO/MOSI/CS。
2. 让 `runtime-timeline.ts` 或后续 SPI manifest 生成器发现 SPI 设备。
3. 让 `protocol-runtime-registry.ts` 能识别它的 role、panels、eventParsers。
4. 写 SPI codec 或 Renode C# peripheral。
5. 补 UI 面板和 smoke test。

新增 GPIO 类器件时：

1. 简单器件可以继续走 component adapter。
2. 需要复用和可发布时，迁移到 `packages/devices/<device>/index.ts`。
3. 通过 `signal-broker.ts` 的 signal manifest 进入 GPIO Monitor 和 Logic Analyzer。

## 9. 验证脚本怎么读

验证脚本在 `scripts/`：

- `validate-device-packages.cjs`: 校验 Device Package 是否能完整描述 visual、pins、Renode backend、runtime panel、event parser、sensor SDK 和 protocol codec。
- `validate-netlist.cjs`: 校验 Netlist/IR、组件包、传感器包、Device Package、Protocol Runtime Registry、示例项目。
- `validate-boards.cjs`: 校验板型 schema、Renode platform path、编译和启动链路。
- `smoke-si7021-native.cjs`: 验证 SI7021 native Renode sensor 闭环。
- `smoke-i2c-demo.cjs`: 验证 SSD1306 I2C transaction 和 OLED framebuffer。
- `smoke-broker-bridge.cjs`: 验证 Signal Broker/GPIO 桥接。
- `smoke-test.cjs`: 通用 Renode 运行 smoke test。

日常修改建议运行：

```bash
npm run lint
npm run validate:devices
npm run validate:netlist
npm run build
```

涉及板型、Renode、传感器或总线时再运行：

```bash
npm run validate:boards
npm run smoke:si7021
npm run smoke:i2c
```

## 10. 当前项目边界

当前项目更接近“Renode 数字逻辑和协议级仿真平台”，不是 Proteus 的 SPICE 模拟电路引擎。

已经具备：

- 可视化连线到 Netlist/IR。
- 自动生成 C 固件、`.repl`、`.resc`、manifest。
- 本地编译 Generated Demo ELF，或导入用户 `.elf`，再启动 Renode。
- GPIO、UART、I2C 运行事件可视化。
- SI7021 native Renode sensor 闭环。
- SSD1306 transaction 到 framebuffer 预览。
- Device Package Compiler 和 Protocol Runtime Registry。

仍建议优先补强：

- User Firmware Mode 后续扩展 `.hex/.bin`，并增加固件与板型/芯片的兼容性提示。
- 更多 Renode native sensor package。
- SPI runtime 和 SPI Flash/OLED 示例。
- 更完善的 C# Broker plugin。
- GDB 源码级调试 UI。
- 更像 Proteus/Wokwi 的元件属性面板和错误提示。

读代码时始终抓住一句话：用户操作不直接变成 Renode 命令，而是先变成 Netlist 和 Package/Manifest，再由 Electron 和 Renode runtime 执行。





**一、自动生成 demo 固件的控制逻辑依据什么**
当前项目的 demo 固件不是写死“某个按键控制某个 LED”，而是根据这几类数据动态生成：

1. `wiring / Netlist`
用户在画布上把 Button、LED、OLED、SI7021 等外设连到哪个 MCU 引脚，先变成 `CircuitNetlist`，再生成 `main.c / board.repl / manifest`。
源码入口：[src/lib/netlist.ts](F:/YL/Renode_Wokwi-main/src/lib/netlist.ts:770)

2. 板型 schema
不同板型决定 GPIO 寄存器模型、RCC 地址、可选引脚、USART/I2C 引脚、编译参数等。
F4 / F1 板型定义在：[src/lib/boards.ts](F:/YL/Renode_Wokwi-main/src/lib/boards.ts:378)

3. 外设 behavior
输出类外设有三种控制方式：
`Firmware GPIO`：demo 代码只配置 GPIO，不主动控制，留给用户固件控制。
`Mirror Input`：demo 代码读取某个 Button，然后写 LED/Buzzer/RGB 输出。
`Blink`：demo 代码按 tick 周期自动闪烁输出。

核心生成逻辑在：[src/lib/firmware.ts](F:/YL/Renode_Wokwi-main/src/lib/firmware.ts:2887)

4. Renode `.repl`
`generateBoardRepl()` 会把 Button 变成 Renode 的 `Miscellaneous.Button`，把 LED 变成 `Miscellaneous.LED`，并映射到对应 `gpioPortX@n`。
源码：[src/lib/firmware.ts](F:/YL/Renode_Wokwi-main/src/lib/firmware.ts:3031)

所以：自动 demo 固件的“控制逻辑”来自用户连线 + 用户选择的外设控制方式 + 当前板型 schema。现在新增的 `User Firmware Mode` 会绕过自动生成 C 控制逻辑，只复用 `.repl/.resc/manifest`，真正控制逻辑由你导入的 ELF 决定。
