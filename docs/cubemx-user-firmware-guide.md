# CubeMX User Firmware Guide

这份指南对应 `User Firmware Mode`。目标是让用户在 STM32CubeMX / STM32CubeIDE 中编写自己的 STM32 固件，编译得到 `.elf`，再导入本项目仿真。画布连线仍然负责生成 Renode `.repl/.resc/manifest`，但 GPIO/I2C/UART 的真实控制逻辑来自用户 ELF。

## 支持范围 v1

当前验证包优先覆盖两块实验板型：

- `STM32F4 Discovery`: CubeMX 目标建议使用 `STM32F407VGTx`。
- `STM32F103 GPIO Lab`: CubeMX 目标建议使用 `STM32F103RBTx`。如果只做最小 GPIO demo，也可以用 `STM32F103C8Tx`，但要注意 Flash/RAM 与当前 Renode profile 的差异。

当前先验证三条路径：

- Button 控制 LED/output。
- UART 输出到本项目右侧 UART Terminal。
- SI7021 通过 MCU I2C 控制器读取，Renode 侧挂载 native `Sensors.SI70xx`。

## 通用步骤

1. 在本项目里选择 `STM32F4 Discovery` 或 `STM32F103 GPIO Lab`。
2. 在画布上拖入外设并连线。User Firmware 模式下，LED/Buzzer/RGB 输出建议保持 `Firmware GPIO` 行为。
3. 打开 STM32CubeMX，选择对应芯片或板卡。
4. 在 CubeMX 里配置和画布完全一致的引脚。
5. `Project Manager -> Toolchain / IDE` 选择 `STM32CubeIDE`。
6. Generate Code，然后在 STM32CubeIDE 中 Build。
7. 找到 `Debug/<project>.elf` 或 `Release/<project>.elf`。
8. 回到本项目，`Firmware Mode -> User Firmware -> Import ELF`。
9. 点击 `Start`。如果固件和画布引脚一致，GPIO/UART/I2C 结果会回到 UI 可视化面板。

## STM32F4 Discovery 最小 GPIO

预期画布连线：

| 外设 | 画布 pad | MCU 引脚 | CubeMX 配置 |
| --- | --- | --- | --- |
| Button SIG | `F4A-2` | `PA1` | `GPIO_Input`, Pull-down |
| LED SIG | `F4D-1` | `PB0` | `GPIO_Output`, Push Pull, Low speed |
| UART TX | board runtime | `PA2` | `USART2_TX`, Asynchronous |
| UART RX | board runtime | `PA3` | `USART2_RX`, Asynchronous |

`while (1)` 最小代码：

```c
GPIO_PinState pressed = HAL_GPIO_ReadPin(BTN_GPIO_Port, BTN_Pin);
HAL_GPIO_WritePin(LED_GPIO_Port, LED_Pin, pressed == GPIO_PIN_SET ? GPIO_PIN_SET : GPIO_PIN_RESET);
```

如果没有给 User Label，CubeMX 默认宏通常类似 `GPIO_PIN_1` 和 `GPIO_PIN_0`。为了教程稳定，建议在 CubeMX 里把 `PA1` User Label 设置为 `BTN`，把 `PB0` User Label 设置为 `LED`。

## STM32F103 GPIO Lab 最小 GPIO

预期画布连线：

| 外设 | 画布 pad | MCU 引脚 | CubeMX 配置 |
| --- | --- | --- | --- |
| Button SIG | `F1A-1` | `PA0` | `GPIO_Input`, Pull-down |
| LED SIG | `F1B-1` | `PB0` | `GPIO_Output`, Push Pull, Low speed |
| UART TX | board runtime | `PA2` | `USART2_TX`, Asynchronous |
| UART RX | board runtime | `PA3` | `USART2_RX`, Asynchronous |

`while (1)` 最小代码：

```c
GPIO_PinState pressed = HAL_GPIO_ReadPin(BTN_GPIO_Port, BTN_Pin);
HAL_GPIO_WritePin(LED_GPIO_Port, LED_Pin, pressed == GPIO_PIN_SET ? GPIO_PIN_SET : GPIO_PIN_RESET);
```

## UART 输出

两块板的当前 runtime 都使用 `USART2`：

- TX: `PA2`
- RX: `PA3`
- 建议参数：`115200`, `8 data bits`, `No parity`, `1 stop bit`

示例代码：

```c
static const uint8_t msg[] = "User firmware UART alive\r\n";
HAL_UART_Transmit(&huart2, (uint8_t *)msg, sizeof(msg) - 1, 10);
```

启动仿真后，文本应出现在本项目的 UART Terminal 和统一事件流里。

## SI7021 I2C

两块板当前都使用 `I2C1`：

| 板型 | SCL | SDA | CubeMX 配置 |
| --- | --- | --- | --- |
| STM32F4 Discovery | `PB6` / `F4D-3` | `PB7` / `F4D-4` | `I2C1`, Standard Mode 100 kHz, Open Drain |
| STM32F103 GPIO Lab | `PB6` / `F1B-4` | `PB7` / `F1B-5` | `I2C1`, Standard Mode 100 kHz, Open Drain |

SI7021 地址是 7-bit `0x40`，HAL 传参需要左移一位：

```c
#define SI7021_ADDR        (0x40 << 1)
#define SI7021_TEMP_NOHOLD 0xF3

uint8_t command = SI7021_TEMP_NOHOLD;
uint8_t raw[2] = {0};
HAL_StatusTypeDef tx = HAL_I2C_Master_Transmit(&hi2c1, SI7021_ADDR, &command, 1, 10);
if (tx == HAL_OK) {
    HAL_StatusTypeDef rx = HAL_I2C_Master_Receive(&hi2c1, SI7021_ADDR, raw, 2, 10);
    (void)rx;
}
```

本项目会在 generated `.repl` 中根据画布连线挂载 Renode native `Sensors.SI70xx`。用户固件必须真的启用 I2C1 并发起读写，才能做到“MCU 固件在 Renode 内部通过 I2C 控制器读到传感器”。

## Renode + HAL 使用注意点

在真实单片机上，`HAL_MAX_DELAY` 有时可以接受；但在 Renode 仿真里，如果某个外设模型没有完全实现 HAL 正在等待的状态位，`HAL_I2C_*` 或 `HAL_UART_*` 可能会一直阻塞。阻塞以后，`while (1)` 不再继续执行，看起来就像 Button/LED 失效。

建议遵守下面的规则：

1. GPIO 轮询放在 `while (1)` 最前面，保证 Button/LED 响应优先。
2. I2C/UART 不要使用 `HAL_MAX_DELAY`，先使用较短 timeout，例如 `10` ms。
3. UART 不要每一轮循环都打印，建议 500 ms 或 1000 ms 打印一次。
4. SI7021 不要每一轮循环都读取，建议 200 ms 到 1000 ms 读取一次。
5. LED/Buzzer/RGB 由用户 ELF 控制时，UI 中保持 `Firmware GPIO` 行为，不要选择 `Mirror Input`。
6. `#define SI7021_ADDR`、`#define SI7021_TEMP_NOHOLD` 建议放在 `/* USER CODE BEGIN PD */` 区域，不要放在 `while (1)` 中间。
7. 如果 SI7021 读数偶尔失败，但 Button/LED 仍能响应，说明固件没有卡死，这是 User Firmware MVP 阶段可以接受的调试状态。

推荐的非阻塞式主循环结构：

```c
#define SI7021_ADDR        (0x40 << 1)
#define SI7021_TEMP_NOHOLD 0xF3

uint32_t last_uart_ms = 0;
uint32_t last_i2c_ms = 0;

while (1)
{
    GPIO_PinState pressed = HAL_GPIO_ReadPin(GPIOA, GPIO_PIN_0);
    HAL_GPIO_WritePin(GPIOB, GPIO_PIN_0, pressed == GPIO_PIN_SET ? GPIO_PIN_SET : GPIO_PIN_RESET);

    uint32_t now = HAL_GetTick();

    if (now - last_uart_ms >= 1000) {
        last_uart_ms = now;
        static const uint8_t msg[] = "User firmware UART alive\r\n";
        HAL_UART_Transmit(&huart2, (uint8_t *)msg, sizeof(msg) - 1, 10);
    }

    if (now - last_i2c_ms >= 500) {
        last_i2c_ms = now;

        uint8_t command = SI7021_TEMP_NOHOLD;
        uint8_t raw[2] = {0};

        HAL_StatusTypeDef tx = HAL_I2C_Master_Transmit(&hi2c1, SI7021_ADDR, &command, 1, 10);
        if (tx == HAL_OK) {
            HAL_StatusTypeDef rx = HAL_I2C_Master_Receive(&hi2c1, SI7021_ADDR, raw, 2, 10);
            (void)rx;
        }
    }
}
```


