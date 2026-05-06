# Source Code Learning Guide

这份文档用于帮助你学习当前项目的代码结构。它不是完整 API 文档，也不替代源码注释，而是给你一条稳定的阅读路线：先理解用户操作如何变成 Netlist，再看 Netlist 如何生成 Renode 文件，最后看 Renode 运行事件如何回到前端并更新可视化。

当前项目的目标是：基于 Renode 做一个本地端 STM32 可视化仿真平台。它更接近“数字逻辑、GPIO、UART、I2C、SPI、传感器协议级仿真平台”，不是 Proteus 的 SPICE 模拟电路引擎。

## 1. 主链路

```text
用户选择板型、拖入外设、拖线到 MCU 引脚
-> React 在 App.tsx 维护 wiring / board / runtime UI 状态
-> createNetlistFromWiring() 把 UI wiring 转成 CircuitNetlist
-> compileNetlistToRenodeArtifacts() 生成 board.repl / run.resc / manifests / demo main.c
-> Generated Demo 模式：Electron 调 GCC 编译生成 firmware.elf
-> User Firmware 模式：Electron 导入用户已经编译好的 .elf
-> Electron startSimulation() 启动 Renode 并执行 sysbus LoadELF
-> Renode 通过 GPIO/UART/I2C/SPI/传感器事件回传状态
-> App.tsx 根据 manifest、runtime registry、device package 更新 LED、UART、逻辑分析仪、OLED、传感器面板
```

关键思想：前端不直接生成 Renode monitor 命令；Renode 也不理解画布图形。中间依赖 Netlist/IR、Device Package、Runtime Manifest、Protocol Runtime Registry 做翻译。

## 2. 代码分层

```text
UI 工作流层
src/App.tsx

项目保存和电路 IR 层
src/lib/project.ts
src/lib/netlist.ts

板型 schema 层
src/lib/boards.ts
src/lib/board-schema.ts

Device Package 和协议描述层
packages/devices/*
src/lib/device-package-types.ts
src/lib/device-package-compiler.ts
src/lib/device-packages.ts
src/lib/device-package-native-runtime.ts
src/lib/device-package-renode-backend-compiler.ts
src/lib/renode-native-peripheral-catalog.ts
src/lib/renode-native-device-package-generator.ts

运行时发现和可视化层
src/lib/signal-broker.ts
src/lib/runtime-timeline.ts
src/lib/protocol-runtime-registry.ts
src/lib/device-runtime-registry.ts
src/lib/bus-sensor-runtime.ts
src/lib/ssd1306.ts
src/lib/si70xx.ts
src/lib/bmp180.ts

本地执行层
electron/main.cjs
electron/preload.cjs
electron/runtime.cjs
```

第一次阅读时，不建议从 `App.tsx` 第一行读到底。先按本指南建立全局地图，再回到源码定位具体函数。

## 3. UI 连线在哪里变成 Netlist

入口在 `src/App.tsx`：

```ts
const circuitNetlist = useMemo(
  () => createNetlistFromWiring(wiring, selectedBoard),
  [selectedBoard, wiring]
);
```

真正转换在 `src/lib/netlist.ts`：

- `createNetlistFromWiring()`: 把 UI 的 `DemoWiring` 转成统一 `CircuitNetlist`。
- `createBoardComponent()`: 把当前开发板和可选 MCU 引脚变成 board component。
- `createComponentInstanceFromDevice()`: 把 LED、Button、RGB LED、SSD1306、SI7021、BMP180、BME280、HS3001、SHT45 等工作区元件变成 package-native component。
- `signalNets`: 把 GPIO/I2C/SPI/UART 端点连接到 MCU pad，并保留 protocol/backend metadata。

当前项目已经取消 VCC/GND 的可视化连线和项目保存信息。真正影响 Renode 仿真的连接仍然是 GPIO/I2C/UART/SPI 等数字协议连接。

## 4. Netlist 在哪里生成 Renode 文件

入口在 `src/lib/netlist.ts`：

```ts
compileNetlistToRenodeArtifacts()
```

它负责从 `CircuitNetlist` 生成这些东西：

- `board.repl`: Renode platform 片段和外设挂载关系。
- `run.resc`: Renode 启动脚本预览。
- `devicePackageManifest`: 给 Electron/Renode runtime 消费的 package-native manifest。
- `peripheralManifest`: GPIO/Signal Broker 需要的端点 manifest。
- `busManifest`: UART/I2C/SPI transaction runtime 需要的总线 manifest。
- `main.c`: Generated Demo 模式下的示例固件源码。

相关函数：

- `compileDevicePackageRenodeBackends()`: 根据 `renodeBackend.type` 分发生成 signal/native/bus/virtual backend artifacts。
- `generateRescPreview()`: 生成 run.resc 预览。
- `buildPeripheralManifest()`: 生成 GPIO bridge manifest。
- `createRenodeDevicePackageManifest()`: 生成 package-native manifest。
- `generateDemoMainSource()`: 在 `src/lib/firmware.ts` 中生成 demo C 代码。

当前有两条固件路径：

- `Generated Demo`: 自动生成 C 代码，再由 Electron 调用 `arm-none-eabi-gcc` 编译 ELF。
- `User Firmware`: 不生成控制逻辑，只复用同一份 `.repl/.resc/manifest`，直接导入用户自己的 `.elf`。

## 5. ELF 在哪里编译，Renode 在哪里 LoadELF

前端入口在 `src/App.tsx`：

- `compileFirmware`: Generated Demo / Manual C 模式下发起编译；User Firmware 模式下转为导入 `.elf`。
- `importUserFirmware`: 打开文件选择器，把用户 `.elf` 导入当前 workspace。
- `startSimulation`: 把 Renode artifacts 和当前 ELF 交给 Electron 启动仿真。

本地执行在 `electron/runtime.cjs`：

- `compileFirmware()`: 写入 `main.c/startup.c/linker.ld`，调用 `arm-none-eabi-gcc`，生成 `firmware.elf`。
- `importUserFirmware()`: 校验 `.elf` 文件，复制到 `workspace/user-firmware/`。
- `startSimulation()`: 写入 `board.repl/run.resc`，启动 Renode 子进程。
- `run.resc` 中包含 `sysbus LoadELF @...`，这个 ELF 可以来自自动编译，也可以来自用户导入。

因此，当前项目不是“不需要 ELF”，而是默认帮你自动生成 demo C 并编译 ELF。切换到 `User Firmware` 后，就更接近 Proteus 的“加载用户固件再仿真”工作流。

## 6. Renode 事件在哪里回到前端

后端事件入口在 `electron/runtime.cjs`：

- `emitSignal()`: 把 GPIO 状态变化变成 `signal` 事件。
- `emitUart()` / `emitUartLineBuffered()`: 把 UART socket 输出变成 UART/timeline 事件。
- `emitBusTransaction()`: 把 I2C/SPI/UART transaction 变成统一 timeline 事件。
- `setNativeSensor()`: 通过 Renode monitor 修改 native sensor 属性，例如温度、湿度、压力。

前端接收在 `src/App.tsx`：

```ts
window.localWokwi.onSimulationEvent(...)
```

之后分发到不同 reducer/helper：

- `recordSignalSample()`: 更新 GPIO Monitor 和 Logic Analyzer。
- `recordRuntimeTimelineEvent()`: 更新统一时间线。
- `applySsd1306Transaction()`: 把 I2C 数据解码成 OLED framebuffer。
- `applyBusSensorRuntimeEvent()`: 把 I2C sensor transaction 解码成传感器读数。
- `applyNativeSensorControlValues()`: 把 Renode native sensor 控制结果同步回 UI。

## 7. 前端视觉和连线逻辑怎么分开

最近前端做了 Proteus 风格的 UI 精简，但刻意没有改连线核心逻辑。学习时要把“视觉层”和“交互核心”分开看。

视觉层主要在 `src/App.tsx`：

- `ProteusMcuSymbolPreview`: 画中间 MCU 芯片符号、引脚文字、引脚红色引线。它只读 `visiblePads` 和 `getPadAnchor()` 的位置，不负责改 wiring。
- `ProteusSingleEndpointGraphic`: 画 LED、Button、Buzzer 的 Proteus 风格裸符号。
- `ProteusOledGraphic`: 画 SSD1306 OLED 模块预览。
- `ProteusSensorGraphic`: 画 SI7021/BMP180/BME280 等传感器模块预览。
- `ProteusRgbLedGraphic`: 画 RGB LED 模块预览。
- `ProteusLibraryGraphic`: 元件库中的图形预览。
- `PeripheralLibraryCard`: 左侧元件库卡片。现在只保留图形、名称、添加按钮，删除了说明块。
- `BoardTopView`: 主画布，负责显示 MCU、外设、端点圆点、连线 SVG path、拖拽预览线。
- `WiringWorkbench`: 工作台布局。现在删掉了 `Wokwi-like flow` 五步说明区，并把 `Peripheral Rack`、`Pin Chooser` 压缩成更简洁的工具区。

连线核心逻辑仍然在 `BoardTopView` 内部，不要随便改：

- `beginWireDrag()`: 从外设端点圆点开始拖线。
- `updateWireDrag()`: 拖动过程中更新预览线和 hover pad。
- `endWireDrag()`: 松手时落到 MCU pad 并调用分配逻辑。
- `resolvePadFromClient()`: 把鼠标坐标映射到具体 board pad。
- `getPadAnchor()`: 把 board pad 映射到画布上的锚点坐标。
- `onAssignPad` / `onAssignPadToPeripheral`: 真正修改 wiring 的回调。

如果只是改样式，优先改 JSX 和 Tailwind class，不要改这些函数的参数、调用时机和 pointer capture 逻辑。否则很容易出现“只能第一次连线”“SCL/SDA 只能连一根线”“点击端点不能重新连线”这类问题。

## 8. Device Package 怎么读

推荐从这些文件开始：

- `packages/devices/si7021/index.ts`
- `packages/devices/bmp180/index.ts`
- `packages/devices/ssd1306/index.ts`
- `packages/devices/uart-terminal/index.ts`
- `src/lib/renode-native-device-package-generator.ts`

每个 Device Package 主要描述：

- `visual`: 元件在元件库和画布上的视觉信息。
- `pins`: 元件暴露哪些仿真端点，例如 SIG、SCL、SDA、TX、RX。
- `electricalRules`: 当前只建议表达数字仿真规则，例如方向、总线成对关系、输出冲突；不要把它当作 SPICE 电源/电阻校验。
- `protocol`: 主协议和 transaction model，例如 `i2c`、`framebuffer-i2c`。
- `renodeBackend`: 使用 signal broker、bus transaction broker、native Renode sensor/peripheral，还是 virtual UART terminal。
- `runtimePanel`: UI 应组合哪些运行时面板和事件解析器。
- `exampleFirmware`: demo 固件需要哪些驱动逻辑。
- `validationFixture`: 用哪些示例项目或 smoke test 验证这个包可复用。

编译入口在 `src/lib/device-package-compiler.ts`：

- `compileDevicePackageSource()`
- `compileComponentDevicePackage()`
- `compileDevicePackageCatalog()`

UI native runtime 入口在 `src/lib/device-package-native-runtime.ts`：

- `getDevicePackageLibraryItems()`: 元件库从 Device Package 自动生成。
- `createPeripheralsFromDevicePackage()`: 用户拖入/点击元件时，根据 package 创建 workbench peripheral。
- `getDevicePackagePinForPeripheral()`: 端点标题、拖线标题、引脚能力提示从 package pin 读取。

Renode backend 编译入口在 `src/lib/device-package-renode-backend-compiler.ts`：

- `signal-broker`: Button/LED/GPIO 类。
- `renode-native-sensor` / `renode-native-peripheral`: SI7021、BMP180、BME280、HS3001、SHT45 等 Renode 原生外设。
- `bus-transaction-broker`: SSD1306 这类 broker-only I2C/SPI 可视化外设。
- `virtual-uart-terminal`: UART Terminal 这类虚拟仪器。

## 9. Protocol Runtime Registry 怎么读

`src/lib/protocol-runtime-registry.ts` 解决的问题是：不要让 OLED、传感器、UART、SPI Flash 分别扫描 manifest，而是先按协议统一发现运行时设备。

输入：

- `RuntimeBusManifestEntry[]`: 来自 `createRuntimeBusManifest()`，负责 UART/I2C/SPI。
- `SignalDefinition[]`: 来自 `createSignalDefinitionsFromNetlist()`，负责 GPIO，并携带 `devicePackageKind` / `renodeBackendType`。
- `BoardSchema`: 当前板型信息。

输出：

- `ProtocolRuntimeRegistry`
- `ProtocolRuntimeDevice`
- `ProtocolRuntimeBus`

常见用法：

- `getProtocolRuntimeDevicesByModel(registry, 'ssd1306', 'i2c')`: 找 OLED。
- `getBusSensorRuntimeDevicesFromProtocolRegistry(registry)`: 找 I2C 传感器。
- `ProtocolRuntimeRegistryPanel`: 在前端展示按协议发现到的 runtime 摘要。

后续新增 SPI Flash、I2C EEPROM、更多传感器时，优先让它们被这个 registry 发现，再接具体 codec 和面板。

## 10. 传感器运行时怎么读

传感器相关文件：

- `src/lib/renode-native-peripheral-catalog.ts`: Renode 原生外设 catalog，把 si70xx、bmp180、bme280、hs3001、sht45 映射到真实 Renode 类型、默认地址、monitor 属性和生成 package 所需 metadata。
- `src/lib/renode-native-device-package-generator.ts`: 自动 Device Package 生成器。
- `src/lib/bus-sensor-runtime.ts`: 通用传感器运行时状态和控制逻辑。
- `src/lib/sensor-protocol-codecs.ts`: 传感器协议 codec registry。
- `src/lib/si70xx.ts`: SI70xx 命令、raw 数据、温湿度转换。
- `src/lib/bmp180.ts`: BMP180 协议 helper。
- `packages/devices/si7021/index.ts`: SI7021 独立 Device Package。
- `packages/devices/bmp180/index.ts`: BMP180 独立 Device Package。

SI7021 闭环：

```text
用户拖入 SI7021 并连接 SCL/SDA
-> Netlist 发现 I2C sensor
-> board.repl 挂载 Sensors.SI70xx
-> demo main.c 或用户 ELF 通过 MCU I2C 控制器读取 sensor
-> Renode 内部返回 I2C 数据
-> UART/timeline/sensor runtime 在前端可视化
```

Renode 已有的传感器优先复用 native peripheral。Renode 没有的传感器，再考虑写 C# peripheral，或者先做 broker/codec MVP。

## 11. 新增外设推荐步骤

新增 I2C 传感器：

1. 先查 Renode 是否已有 native peripheral。
2. 如果已有，优先在 `src/lib/renode-native-peripheral-catalog.ts` 加 catalog entry。
3. 如果只需要 monitor 控制和通用可视化，让 `renode-native-device-package-generator.ts` 自动生成 package。
4. 如果需要特殊视觉、面板或协议逻辑，再在 `packages/devices/<sensor>/index.ts` 写独立 package。
5. 如果需要解码 MCU I2C transaction，在 `src/lib/<codec>.ts` 或 `src/lib/sensor-protocol-codecs.ts` 添加 codec。
6. 不要在 `bus-sensor-runtime.ts` 里不断写死新传感器分支，优先走 catalog channels 和 codec registry。
7. 加入 `scripts/validate-device-packages.cjs`、`scripts/validate-netlist.cjs` 或 smoke test。

新增 SPI 器件：

1. 扩展 Device Package 的 `protocol` 和 `pins`，声明 SCK/MISO/MOSI/CS。
2. 让 runtime manifest 能发现 SPI 设备。
3. 让 `protocol-runtime-registry.ts` 识别它的 role、panels、eventParsers。
4. 写 SPI codec 或 Renode C# peripheral。
5. 补 UI 面板和 smoke test。

新增 GPIO 器件：

1. 简单器件可继续走 `signal-broker`。
2. 需要复用和发布时，迁移到 `packages/devices/<device>/index.ts`。
3. 通过 `signal-broker.ts` 的 signal manifest 进入 GPIO Monitor 和 Logic Analyzer。

## 12. 验证脚本

日常修改建议运行：

```bash
npm run lint
npm run validate:cubemx
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

脚本含义：

- `validate-device-packages.cjs`: 校验 Device Package、sensor SDK、native catalog 和 protocol codec。
- `validate-cubemx-pack.cjs`: 校验 User Firmware Validation v2、CubeMX pin hints、native sensor contracts 和 HAL snippet。
- `validate-netlist.cjs`: 校验 Netlist/IR、package-native Renode manifest、Renode Backend Compiler、Protocol Runtime Registry 和示例项目。
- `validate-boards.cjs`: 校验板型 schema、Renode platform path、编译和启动链路。
- `smoke-si7021-native.cjs`: 验证 SI7021 native Renode sensor 闭环。
- `smoke-i2c-demo.cjs`: 验证 SSD1306 I2C transaction 和 OLED framebuffer。
- `smoke-broker-bridge.cjs`: 验证 Signal Broker/GPIO 桥接。

## 13. User Firmware Validation System v2 和 Native Sensor Runtime v2

这次新增的两个 v2 能力，目标是把“用户导入 ELF 后如何证明连线、CubeMX 配置、Renode 原生传感器和 UI 可视化是一致的”做成结构化系统，而不是靠口头说明。

`src/lib/cubemx-validation.ts` 负责 User Firmware Validation System v2：

- `createCubeMxValidationPack(board, wiring)`: 根据当前板型和画布连线生成验证包。
- `USER_FIRMWARE_VALIDATION_SCHEMA_VERSION = 2`: 当前验证包版本。
- `pinHints`: 给 CubeMX 的 GPIO/UART/I2C 引脚模式提示。
- `scenarios`: 判断 Button->LED、UART output、SI7021 compatibility、native sensor I2C read 是否 ready。
- `nativeSensorContracts`: 对每个 Renode 原生 I2C 传感器生成地址、HAL handle、SCL/SDA、Renode 类型、codec 状态和预期结果。
- `snippets`: 生成非阻塞/限频 HAL 示例片段，用来提醒用户固件不要用 `HAL_MAX_DELAY` 卡住 GPIO 轮询。

`src/lib/bus-sensor-runtime.ts` 负责 Native Sensor Runtime v2：

- `BUS_SENSOR_RUNTIME_SCHEMA_VERSION = 2`: 当前传感器运行时状态版本。
- `RuntimeBusSensorDevice.nativeRuntime`: 每个传感器都有一个 runtime contract。
- `attachment`: 表示它是 Renode native、broker-only 还是 visual-only。
- `readiness`: 表示是否完整 ready、缺 Renode path、缺 codec，或者不是 native sensor。
- `canApplyNativeControls`: UI 滑块是否能写入 Renode monitor property。
- `canReadThroughUserFirmware`: 用户 ELF 是否能通过 MCU I2C 读到 Renode 原生外设。
- `canDecodeTransactions`: UI 是否已有协议 codec 能把 I2C transaction 解码成读数。
- `summarizeNativeSensorRuntime()`: 给前端面板和验证脚本汇总 native-ready、codec、apply、transaction 数量。

验证入口：

- `scripts/validate-cubemx-pack.cjs`: 验证 F1/F4 的 User Firmware Validation v2，覆盖 Button/LED、UART、SI7021、BMP180、BME280。
- `scripts/validate-device-packages.cjs`: 验证 Native Sensor Runtime v2 contract，确认 SI7021/BMP180 是完整 ready，BME280 能 native-control 但明确提示缺少协议 codec。
- `scripts/validate-netlist.cjs`: 继续验证示例项目和 Netlist/Renode 生成链路，并断言传感器运行时 schema v2。

理解这个边界很重要：Renode 原生传感器能被用户 ELF 通过真实 MCU I2C 控制器访问；UI 侧是否能把 transaction 解码成漂亮读数，取决于是否已经给该器件实现了 protocol codec。

## 14. 当前项目边界

已经具备：

- 可视化连线到 Netlist/IR。
- 自动生成 C 固件、`.repl`、`.resc`、manifest。
- 本地编译 Generated Demo ELF，或导入用户 `.elf` 再启动 Renode。
- GPIO、UART、I2C 运行事件可视化。
- SI7021 native Renode sensor 闭环。
- BMP180 native Renode peripheral package。
- BME280、HS3001、SHT45 catalog-generated Device Package。
- SSD1306 transaction 到 framebuffer 预览。
- Device Package Compiler 和 Protocol Runtime Registry。
- Proteus 风格 MCU/LED/Button/Buzzer/OLED/Sensor 可视化雏形。

仍建议优先补强：

- 更多 Renode native sensor package，并逐步补 User Firmware 示例。
- SPI runtime 和 SPI Flash/OLED 示例。
- 更完整的 C# Broker plugin。
- GDB 源码级调试 UI。
- 器件属性面板、错误提示和可视化连线手感。
- User Firmware 与板型/芯片型号的兼容性提示。

记住一句话：用户操作不会直接变成 Renode 命令，而是先变成 Netlist 和 Package/Manifest，再由 Electron 和 Renode runtime 执行。
