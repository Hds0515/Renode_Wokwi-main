# CubeMX User Firmware Guide

这份指南对应项目里的 `User Firmware Mode`。目标是让用户在 STM32CubeMX / STM32CubeIDE 中编写自己的 STM32 固件，编译得到 `.elf`，再导入本项目仿真。

当前项目的职责分工是：

- 画布连线负责生成 Renode 需要的 `.repl/.resc/manifest`。
- 用户 ELF 负责真正的 GPIO/UART/I2C/SPI 控制逻辑。
- Renode 负责运行 MCU 固件和原生外设模型。
- 前端负责把 GPIO、UART、I2C 传感器读数和运行事件可视化。

## 支持范围

当前优先验证两类 STM32 板型：

- `STM32F4 Discovery`: CubeMX 目标建议使用 `STM32F407VGTx`。
- `STM32F103 GPIO Lab`: CubeMX 目标建议使用 `STM32F103RBTx`。如果只做最小 GPIO demo，也可以使用 `STM32F103C8Tx`，但要注意 Flash/RAM 和当前 Renode profile 的差异。

当前已覆盖的用户固件路径：

- Button 控制 LED/Buzzer/RGB GPIO 输出。
- UART 输出到本项目右侧 UART Terminal。
- SI7021 通过 MCU I2C 控制器读取 Renode native `Sensors.SI70xx`。
- BMP180 通过 MCU I2C 控制器读取 Renode native `Sensors.BMP180`。
- BME280、HS3001、SHT45 可先作为 Renode native catalog-generated 传感器挂载和调参，再用 User Firmware 编写对应 I2C 驱动验证。

## 通用步骤

1. 在本项目里选择 `STM32F4 Discovery` 或 `STM32F103 GPIO Lab`。
2. 在画布上拖入外设并连线。User Firmware 模式下，LED/Buzzer/RGB 输出建议保持 `Firmware GPIO` 行为。
3. 打开 STM32CubeMX，选择对应芯片或板卡。
4. 在 CubeMX 里配置和画布完全一致的引脚。
5. `Project Manager -> Toolchain / IDE` 选择 `STM32CubeIDE`。
6. Generate Code，然后在 STM32CubeIDE 中 Build。
7. 找到 `Debug/<project>.elf` 或 `Release/<project>.elf`。
8. 回到本项目，选择 `Firmware Mode -> User Firmware -> Import ELF`。
9. 点击 `Start`。如果固件和画布引脚一致，GPIO/UART/I2C 结果会回到 UI 可视化面板。

## GPIO 最小示例

STM32F4 Discovery 预期连线：

| 外设 | 画布 pad | MCU 引脚 | CubeMX 配置 |
| --- | --- | --- | --- |
| Button SIG | `F4A-2` | `PA1` | `GPIO_Input`, Pull-down |
| LED SIG | `F4D-1` | `PB0` | `GPIO_Output`, Push Pull, Low speed |
| UART TX | board runtime | `PA2` | `USART2_TX`, Asynchronous |
| UART RX | board runtime | `PA3` | `USART2_RX`, Asynchronous |

STM32F103 GPIO Lab 预期连线：

| 外设 | 画布 pad | MCU 引脚 | CubeMX 配置 |
| --- | --- | --- | --- |
| Button SIG | `F1A-1` | `PA0` | `GPIO_Input`, Pull-down |
| LED SIG | `F1B-1` | `PB0` | `GPIO_Output`, Push Pull, Low speed |
| UART TX | board runtime | `PA2` | `USART2_TX`, Asynchronous |
| UART RX | board runtime | `PA3` | `USART2_RX`, Asynchronous |

建议在 CubeMX 中给引脚设置 User Label：

- Button: `BTN`
- LED: `LED`

`while (1)` 最小代码：

```c
GPIO_PinState pressed = HAL_GPIO_ReadPin(BTN_GPIO_Port, BTN_Pin);
HAL_GPIO_WritePin(LED_GPIO_Port, LED_Pin, pressed == GPIO_PIN_SET ? GPIO_PIN_SET : GPIO_PIN_RESET);
```

## UART 输出

两块板当前 runtime 都使用 `USART2`：

| 功能 | MCU 引脚 | CubeMX 配置 |
| --- | --- | --- |
| UART TX | `PA2` | `USART2_TX`, Asynchronous |
| UART RX | `PA3` | `USART2_RX`, Asynchronous |

建议参数：

- Baud rate: `115200`
- Word length: `8 Bits`
- Parity: `None`
- Stop bits: `1`

示例代码：

```c
static const uint8_t msg[] = "User firmware UART alive\r\n";
HAL_UART_Transmit(&huart2, (uint8_t *)msg, sizeof(msg) - 1, 10);
```

启动仿真后，文本应出现在本项目的 UART Terminal 和统一事件流里。

## I2C1 引脚

SI7021、BMP180、BME280、HS3001、SHT45 当前都走 `I2C1`。

| 板型 | SCL | SDA | CubeMX 配置 |
| --- | --- | --- | --- |
| STM32F4 Discovery | `PB6` / `F4D-3` | `PB7` / `F4D-4` | `I2C1`, Standard Mode 100 kHz, Open Drain |
| STM32F103 GPIO Lab | `PB6` / `F1B-4` | `PB7` / `F1B-5` | `I2C1`, Standard Mode 100 kHz, Open Drain |

CubeMX 里需要启用：

- `I2C1`
- `PB6` as `I2C1_SCL`
- `PB7` as `I2C1_SDA`
- Standard Mode `100 kHz`

HAL 的 I2C 地址参数需要左移一位，例如 7-bit `0x40` 要传 `(0x40 << 1)`。

## SI7021 用法

画布操作：

1. 拖入 `SI7021 Sensor`。
2. 把 `SCL` 连到当前板型的 `I2C1_SCL` pad。
3. 把 `SDA` 连到当前板型的 `I2C1_SDA` pad。
4. User Firmware 模式导入 ELF 后启动仿真。
5. 运行中可在 Sensor Runtime 面板里调整 Temperature/Humidity，并点击 `Apply Channels To Native Renode Sensor` 写入 Renode native `Sensors.SI70xx`。

SI7021 地址是 7-bit `0x40`。

最小读取温度示例：

```c
#define SI7021_ADDR        (0x40 << 1)
#define SI7021_TEMP_NOHOLD 0xF3

static HAL_StatusTypeDef si7021_read_temperature_raw(I2C_HandleTypeDef *hi2c, uint8_t raw[2])
{
    uint8_t command = SI7021_TEMP_NOHOLD;
    HAL_StatusTypeDef tx = HAL_I2C_Master_Transmit(hi2c, SI7021_ADDR, &command, 1, 10);
    if (tx != HAL_OK) {
        return tx;
    }

    return HAL_I2C_Master_Receive(hi2c, SI7021_ADDR, raw, 2, 10);
}
```

温度换算参考：

```c
static int32_t si7021_temperature_centi(const uint8_t raw[2])
{
    uint16_t value = ((uint16_t)raw[0] << 8) | raw[1];
    return (int32_t)(((uint32_t)value * 17572u + 32768u) / 65536u) - 4685;
}
```

本项目会在 generated `.repl` 中根据画布连线挂载 Renode native `Sensors.SI70xx`。用户固件必须真实启用 I2C1 并发起读写，才能做到 MCU 固件在 Renode 内部通过 I2C 控制器读到传感器。

## BMP180 用法

BMP180 是本项目新增的 Renode native peripheral package。它通过 `Renode Native Peripheral Catalog v2` 映射到 Renode 原生模型：

```text
Sensors.BMP180 @ i2cX 0x77
```

画布操作：

1. 拖入 `BMP180 Sensor`。
2. 把 `SCL` 连到当前板型的 `I2C1_SCL` pad。
3. 把 `SDA` 连到当前板型的 `I2C1_SDA` pad。
4. 在 User Firmware 模式导入包含 BMP180 驱动的 `.elf`。
5. 启动仿真后，Sensor Runtime 面板可调整 `Temperature` 和 `UncompensatedPressure`，并写入 Renode native `Sensors.BMP180`。

BMP180 地址是 7-bit `0x77`。

BMP180 常用寄存器：

| 名称 | 地址 | 说明 |
| --- | --- | --- |
| `BMP180_REG_ID` | `0xD0` | 芯片 ID，真实 BMP180 通常为 `0x55` |
| `BMP180_REG_CONTROL` | `0xF4` | 控制寄存器 |
| `BMP180_REG_DATA_MSB` | `0xF6` | 数据 MSB |
| `BMP180_CMD_TEMP` | `0x2E` | 启动温度转换 |
| `BMP180_CMD_PRESSURE_OSS0` | `0x34` | 启动压力转换，OSS=0 |

建议把这些宏放在 CubeMX 的 `/* USER CODE BEGIN PD */` 区域：

```c
#define BMP180_ADDR              (0x77 << 1)
#define BMP180_REG_ID            0xD0
#define BMP180_REG_CONTROL       0xF4
#define BMP180_REG_DATA_MSB      0xF6
#define BMP180_CMD_TEMP          0x2E
#define BMP180_CMD_PRESSURE_OSS0 0x34
```

读取寄存器 helper：

```c
static HAL_StatusTypeDef bmp180_read_regs(I2C_HandleTypeDef *hi2c, uint8_t reg, uint8_t *data, uint16_t len)
{
    HAL_StatusTypeDef tx = HAL_I2C_Master_Transmit(hi2c, BMP180_ADDR, &reg, 1, 10);
    if (tx != HAL_OK) {
        return tx;
    }

    return HAL_I2C_Master_Receive(hi2c, BMP180_ADDR, data, len, 10);
}

static HAL_StatusTypeDef bmp180_write_reg(I2C_HandleTypeDef *hi2c, uint8_t reg, uint8_t value)
{
    uint8_t payload[2] = { reg, value };
    return HAL_I2C_Master_Transmit(hi2c, BMP180_ADDR, payload, 2, 10);
}
```

读取芯片 ID：

```c
uint8_t bmp180_id = 0;
HAL_StatusTypeDef id_status = bmp180_read_regs(&hi2c1, BMP180_REG_ID, &bmp180_id, 1);
```

读取未补偿温度 raw 值：

```c
static HAL_StatusTypeDef bmp180_read_uncompensated_temperature(I2C_HandleTypeDef *hi2c, uint16_t *ut)
{
    HAL_StatusTypeDef start = bmp180_write_reg(hi2c, BMP180_REG_CONTROL, BMP180_CMD_TEMP);
    if (start != HAL_OK) {
        return start;
    }

    HAL_Delay(5);

    uint8_t raw[2] = {0};
    HAL_StatusTypeDef read = bmp180_read_regs(hi2c, BMP180_REG_DATA_MSB, raw, 2);
    if (read != HAL_OK) {
        return read;
    }

    *ut = ((uint16_t)raw[0] << 8) | raw[1];
    return HAL_OK;
}
```

读取 OSS=0 的未补偿压力 raw 值：

```c
static HAL_StatusTypeDef bmp180_read_uncompensated_pressure(I2C_HandleTypeDef *hi2c, uint32_t *up)
{
    HAL_StatusTypeDef start = bmp180_write_reg(hi2c, BMP180_REG_CONTROL, BMP180_CMD_PRESSURE_OSS0);
    if (start != HAL_OK) {
        return start;
    }

    HAL_Delay(8);

    uint8_t raw[3] = {0};
    HAL_StatusTypeDef read = bmp180_read_regs(hi2c, BMP180_REG_DATA_MSB, raw, 3);
    if (read != HAL_OK) {
        return read;
    }

    *up = (((uint32_t)raw[0] << 16) | ((uint32_t)raw[1] << 8) | raw[2]) >> 8;
    return HAL_OK;
}
```

重要说明：真实 BMP180 驱动还需要读取 `0xAA` 到 `0xBF` 的校准寄存器，并根据数据手册做温度和压力补偿。上面的代码适合验证 I2C 总线和 Renode native 外设是否连通，不等同于完整商用品质 BMP180 驱动。

## 推荐主循环结构

不要在主循环里用 `HAL_MAX_DELAY` 阻塞 I2C/UART。阻塞后 `while (1)` 不再继续执行，看起来就像 Button/LED 失效。

推荐规则：

1. GPIO 轮询放在 `while (1)` 最前面，保证 Button/LED 响应优先。
2. I2C/UART 使用短 timeout，例如 `10` ms。
3. UART 不要每一轮循环都打印，建议 500 ms 或 1000 ms 打印一次。
4. SI7021/BMP180 不要每一轮循环都读取，建议 200 ms 到 1000 ms 读取一次。
5. LED/Buzzer/RGB 由用户 ELF 控制时，UI 中保持 `Firmware GPIO` 行为，不要选择 `Mirror Input`。
6. 传感器读取失败不能阻塞 GPIO 逻辑，失败后跳过本次读取即可。

一个适合 Button/LED + UART + SI7021/BMP180 的主循环骨架：

```c
uint32_t last_uart_ms = 0;
uint32_t last_sensor_ms = 0;

while (1)
{
    GPIO_PinState pressed = HAL_GPIO_ReadPin(BTN_GPIO_Port, BTN_Pin);
    HAL_GPIO_WritePin(LED_GPIO_Port, LED_Pin, pressed == GPIO_PIN_SET ? GPIO_PIN_SET : GPIO_PIN_RESET);

    uint32_t now = HAL_GetTick();

    if (now - last_uart_ms >= 1000) {
        last_uart_ms = now;
        static const uint8_t msg[] = "User firmware UART alive\r\n";
        HAL_UART_Transmit(&huart2, (uint8_t *)msg, sizeof(msg) - 1, 10);
    }

    if (now - last_sensor_ms >= 500) {
        last_sensor_ms = now;

        uint8_t si7021_raw[2] = {0};
        (void)si7021_read_temperature_raw(&hi2c1, si7021_raw);

        uint16_t bmp180_ut = 0;
        uint32_t bmp180_up = 0;
        (void)bmp180_read_uncompensated_temperature(&hi2c1, &bmp180_ut);
        (void)bmp180_read_uncompensated_pressure(&hi2c1, &bmp180_up);
    }
}
```

如果只连接了 SI7021 或只连接了 BMP180，就删除另一个传感器的读取函数调用。

## Catalog-generated 原生传感器

本项目现在还支持从 `Renode Native Peripheral Catalog v2` 自动生成 Device Package 的三个原生传感器：

| 画布元件 | Renode 原生类型 | 7-bit 地址 | 可调 Monitor 属性 |
| --- | --- | --- | --- |
| `BME280 Sensor` | `I2C.BME280` | `0x76` | `Temperature`、`Humidity`、`Pressure` |
| `HS3001 Sensor` | `Sensors.HS3001` | `0x44` | `Temperature`、`Humidity` |
| `SHT45 Sensor` | `I2C.SHT45` | `0x44` | `Temperature`、`Humidity`、`SerialNumber` |

使用方式和 BMP180 类似：

1. 在画布拖入对应传感器。
2. 将 `SCL`、`SDA` 连到当前板型的 `I2C1_SCL`、`I2C1_SDA`。
3. 选择 `User Firmware` 模式导入你用 CubeMX/IDE 编译出的 `.elf`。
4. 启动仿真后，右侧 Sensor Runtime 会根据 catalog channel 自动生成滑块。
5. 点击 `Apply Channels To Native Renode Sensor` 会把数值写入 Renode 原生外设的 monitor property。

注意：这三个 catalog-generated 传感器当前不会自动生成完整 HAL 驱动代码，也不会伪造 UI 侧 I2C 读数。它们符合“MCU 固件通过 I2C 控制器访问 Renode 原生外设”的仿真逻辑；具体寄存器读写流程需要你在 User Firmware 中按器件数据手册实现。

## User Firmware Validation v2 面板怎么看

在 `User Firmware` 模式下，右侧会显示 `User Firmware Validation v2`。它不是编译器，也不会替你改 CubeMX 工程，而是把当前画布连线翻译成用户固件需要满足的合同：

1. `Pin hints` 会列出当前连线对应的 CubeMX pin mode，例如 `GPIO_Input`、`GPIO_Output`、`USART2_TX/RX`、`I2C1_SCL/SDA`。
2. `Native sensors` 会统计已经形成完整 I2C 合同的 Renode 原生传感器。
3. 每个 native sensor contract 会显示 7-bit I2C 地址、Renode 类型、HAL handle、SCL/SDA 引脚和 codec 状态。
4. `native controls` 表示 UI 滑块可以通过 Renode monitor property 写入仿真传感器。
5. 如果显示 `uart validation` 或缺少 codec，说明 MCU 固件仍然可以通过 I2C 读 Renode 原生外设，但 UI 暂时不能直接把该器件 transaction 解码成漂亮读数，需要通过 UART 输出或后续补 codec 验证。

当前 v2 验证覆盖：

| 场景 | 验证含义 |
| --- | --- |
| `button-led` | 当前连线能推导出 GPIO 输入和 GPIO 输出的 CubeMX 配置 |
| `uart-output` | 当前板型能推导出 USART2 TX/RX 配置 |
| `si7021-i2c` | 保留 SI7021 兼容场景，方便学习最早的 sensor demo |
| `native-sensor-i2c` | 任意 Renode 原生 I2C sensor package 连到 I2C1 后，都能生成地址、HAL handle、Renode native path 和运行时预期 |

## Native Sensor Runtime v2 面板怎么看

运行仿真后，Sensor Runtime 现在会按 package/runtime contract 展示，而不是只服务 SI7021：

1. `Native ready` 表示有多少传感器已经有 Renode native path，用户 ELF 可以通过 MCU I2C 读。
2. `Decoders` 表示有多少传感器已经有 UI 侧 protocol codec，可以把 I2C transaction 解码成温度、湿度、压力等读数。
3. `Apply Channels To Native Renode Sensor` 会把滑块值写到 Renode 原生外设的 monitor property。
4. `Read ...` 是 UI 侧 demo/timeline 辅助读，不等同于用户 ELF 真实读传感器；真实仿真仍以 MCU 固件 I2C 访问为准。
5. `Native applies` 和 `Transactions` 用来帮助你判断“写入 Renode 原生传感器”和“总线 transaction 解码”是不是都在工作。

## 真实仿真逻辑注意点

这些建议不是为了单纯满足 Button/LED demo，而是更符合正常单片机仿真和真实固件逻辑：

1. Renode 运行的是用户 ELF，外设控制逻辑应该来自 MCU 固件，而不是前端硬编码。
2. 画布连线决定 `.repl` 里挂载哪个 Renode 外设、挂在哪条总线和哪个地址。
3. 传感器 UI 滑块代表仿真输入源，会写入 Renode native sensor 的 monitor property。
4. MCU 必须通过 I2C 控制器发起读写，才能真正读到传感器。
5. 短 timeout、限频读取、错误不阻塞，是用户固件在仿真和真实硬件上都更稳的写法。
6. BMP180 的完整温压结果应使用官方补偿算法，当前 guide 中的 raw 读取代码只用于最小连通性验证。
