# Source Code Learning Guide

这份导览用于学习当前项目的代码结构。它不替代源码注释，而是告诉你应该按什么顺序读、每个文件解决什么问题、以及从“用户拖线”到“Renode 运行 ELF”的链路在哪里。

## 1. 先建立整体流程

当前项目的主链路是：

```text
用户选择板型/拖入外设/连线
-> React 维护 wiring 状态
-> Netlist/IR 编译器生成 CircuitNetlist
-> 生成 C 固件、board.repl、run.resc 预览、manifest
-> Electron 调用 ARM GCC 生成 firmware.elf
-> Electron 启动 Renode 并加载 ELF
-> Renode 通过 GPIO/UART/I2C/传感器事件回传状态
-> React 更新 LED、UART、逻辑分析仪、OLED、传感器面板
```

最重要的入口是：

- `src/App.tsx`: React 主界面和用户工作流。
- `src/lib/netlist.ts`: 可视化连线到 Netlist/IR，再到 Renode artifacts。
- `src/lib/firmware.ts`: 板子/外设模板、生成 C 固件、生成 `.repl/.resc`。
- `packages/devices/*`: 独立 Device Package 源码包，SI7021、SSD1306、UART Terminal 已经迁移到这里。
- `src/lib/device-package-compiler.ts`: Device Package Compiler v1，把独立包编译成运行时 catalog，并兼容尚未迁移的旧 component package。
- `src/lib/device-packages.ts`: Device Package catalog 入口，负责汇总编译结果和提供查询 API。
- `src/lib/device-runtime-registry.ts`: 根据 Device Package 自动生成运行时设备、面板和事件解析器描述。
- `electron/runtime.cjs`: 本地编译、启动 Renode、桥接运行时事件。
- `electron/preload.cjs`: 把安全 IPC API 暴露给前端。

## 2. 前端应该怎么读

从 `src/App.tsx` 开始，但不要一口气从头读到尾。建议按功能块读：

- 顶部 import 和类型定义：理解 UI 依赖哪些 schema、runtime helper。
- `BusSensorRuntimePanel`: 学习传感器控制面板如何从 schema 自动渲染。
- `DeviceRuntimePanelRenderer`: 学习运行时面板如何从 Device Package 的 `runtimePanel` 描述自动组合。
- `WiringWorkbench`: 学习板图、外设、端点和连线手势如何组织。
- `App`: 学习全局状态、保存/加载、编译、启动仿真、事件回调。
- `compileFirmware` 和 `startSimulation`: 理解前端如何进入 Electron/Renode。

关键思想：

- React 只负责用户体验和状态展示。
- React 不直接启动 Renode，也不直接读写本地文件。
- 需要本地权限的事情都通过 `window.localWokwi` 进入 Electron。

## 3. 连线如何变成 Renode 文件

这条链路是项目的核心：

```text
App.tsx wiring
-> createNetlistFromWiring()
-> CircuitNetlist
-> compileNetlistToRenodeArtifacts()
-> main.c / board.repl / run.resc preview / manifests
```

对应文件：

- `src/lib/device-packages.ts`
- `src/lib/device-package-compiler.ts`
- `packages/devices/*`
- `src/lib/device-runtime-registry.ts`
- `src/lib/netlist.ts`
- `src/lib/firmware.ts`
- `src/lib/component-packs.ts`
- `src/lib/sensor-packages.ts`

注意：当前项目不是“不需要 ELF”，而是默认会自动生成 C 代码并编译出 ELF。未来如果加入用户上传 ELF/HEX，这部分会变成可选路径。

## 4. Electron 和 Renode 如何交互

Electron 分三层：

- `electron/main.cjs`: Electron 窗口、菜单、IPC handler、文件保存/加载。
- `electron/preload.cjs`: 安全桥，只暴露允许前端调用的方法。
- `electron/runtime.cjs`: 真正执行本地动作。

`runtime.cjs` 中最重要的方法：

- `compileFirmware`: 写入 `main.c/startup.c/linker.ld`，调用 `arm-none-eabi-gcc`，生成 `firmware.elf`。
- `startSimulation`: 写入 `board.repl/run.resc`，启动 Renode，执行 `sysbus LoadELF`。
- `sendPeripheralEvent`: 把前端按钮等交互送入 Renode GPIO bridge。
- `setNativeSensor`: 通过 Renode monitor 修改原生传感器值。
- `sendBusTransaction`: 把总线读写事件送入统一事件流。

Renode 运行时事件再通过 `local-wokwi:event` 回到 `App.tsx`，前端据此刷新可视化面板。

## 5. 板型、外设和传感器在哪里扩展

新增板型：

- 改 `src/lib/boards.ts`。
- 添加 board schema、可见引脚、Renode platform path、编译参数、UART/I2C/SPI 信息。

新增普通外设：

- 优先新增 `packages/devices/<device>/index.ts`，定义 `visual`、`pins`、`electricalRules`、`protocol`、`renodeBackend`、`runtimePanel`、`exampleFirmware`、`validationFixture`。
- 如果还要兼容旧的拖入模板，再补 `src/lib/firmware.ts` 的外设模板和 `src/lib/component-packs.ts` 的组件包元数据。
- 如需要电源/GND/端点规则，改 `src/lib/electrical-rules.ts`。

新增传感器：

- 优先新增 `packages/devices/<sensor>/index.ts`，让前端元件库和运行时面板从 Device Package Compiler 读取。
- 改 `src/lib/sensor-packages.ts`，定义传感器 package。
- 如果协议类似 SI70xx，可参考 `src/lib/si70xx.ts`。
- 如果要被通用面板控制，补 `src/lib/bus-sensor-runtime.ts` 的 runtime adapter/codec。
- 如果要 MCU 真正读到数据，确保 `src/lib/firmware.ts` 生成相应 I2C/SPI/UART 固件逻辑，且 `.repl` 中挂载 Renode 原生外设或自定义 broker 外设。

## 6. 验证脚本怎么读

验证脚本在 `scripts/`：

- `validate-netlist.cjs`: 校验 Netlist/IR、组件包、传感器包、示例项目。
- `validate-boards.cjs`: 校验板型 schema 和生成工件。
- `smoke-si7021-native.cjs`: 验证 SI7021 原生 Renode 传感器闭环。
- `smoke-test.cjs`: 通用 Renode 运行 smoke test。
- `smoke-broker-bridge.cjs`: Signal Broker/GPIO 桥接验证。
- `smoke-i2c-demo.cjs`: I2C demo 验证。

推荐改完代码后至少运行：

```bash
npm run lint
npm run validate:netlist
npm run build
```

涉及 Renode 或传感器时再运行：

```bash
npm run validate:boards
npm run smoke:si7021
```

## 7. 后续学习建议

第一轮阅读目标不是看懂每一行，而是建立四个问题的答案：

- UI 中的一个线端连接，在哪里变成 Netlist?
- Netlist 在哪里生成 `.repl/.resc/main.c`?
- ELF 在哪里编译，Renode 在哪里 `LoadELF`?
- Renode 的运行事件在哪里回到前端并更新可视化?

这四个问题打通后，再去读具体外设、传感器、逻辑分析仪和板型 schema，会轻松很多。
