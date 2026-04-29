# CubeMX User Firmware Examples

这个目录不是完整 CubeMX 工程，而是当前仿真平台的 User Firmware Validation Pack v1。它记录每个示例在 CubeMX/CubeIDE 中应该选择的芯片、引脚、HAL 代码位置，以及导入 `.elf` 后在本项目中应该看到的可视化结果。

完整教程见 [../../docs/cubemx-user-firmware-guide.md](../../docs/cubemx-user-firmware-guide.md)。

## 示例索引

| 示例 | 板型 | 验证路径 |
| --- | --- | --- |
| [stm32f4-discovery-button-led.md](stm32f4-discovery-button-led.md) | STM32F4 Discovery | Button -> LED + UART |
| [stm32f103-gpio-lab-button-led.md](stm32f103-gpio-lab-button-led.md) | STM32F103 GPIO Lab | Button -> LED + UART |
| [stm32f4-discovery-si7021.md](stm32f4-discovery-si7021.md) | STM32F4 Discovery | SI7021 I2C + UART |
| [stm32f103-gpio-lab-si7021.md](stm32f103-gpio-lab-si7021.md) | STM32F103 GPIO Lab | SI7021 I2C + UART |

## 本项目中的通用操作

1. 选择对应板型。
2. 打开控制区 `Examples` 中同名或同类示例，或者手动拖入外设并按文档连线。
3. 切换 `Firmware Mode -> User Firmware`。
4. 从 CubeIDE 导入 `Debug/*.elf`。
5. Start 仿真。

如果 UI 的 `CubeMX Contract` 显示 `ready`，说明当前画布连线已经足够生成对应 CubeMX 配置提示。
