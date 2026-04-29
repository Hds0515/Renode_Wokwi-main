# STM32F103 GPIO Lab SI7021 over I2C

## CubeMX target

- MCU: `STM32F103RBTx` preferred
- Toolchain / IDE: `STM32CubeIDE`

## Expected visual wiring

| Visual device | Canvas pad | MCU pin | CubeMX mode |
| --- | --- | --- | --- |
| SI7021 SCL | `F1B-4` | `PB6` | `I2C1_SCL`, Open Drain, 100 kHz |
| SI7021 SDA | `F1B-5` | `PB7` | `I2C1_SDA`, Open Drain, 100 kHz |
| SI7021 VCC | `F1P-1` | `3V3` | visual power rail |
| SI7021 GND | `F1P-3` or `F1P-4` | `GND` | visual ground rail |
| UART terminal TX | board runtime | `PA2` | `USART2_TX`, Asynchronous |
| UART terminal RX | board runtime | `PA3` | `USART2_RX`, Asynchronous |

## Minimal I2C read skeleton

```c
#define SI7021_ADDR        (0x40 << 1)
#define SI7021_TEMP_NOHOLD 0xF3

uint8_t command = SI7021_TEMP_NOHOLD;
uint8_t raw[2] = {0};
HAL_I2C_Master_Transmit(&hi2c1, SI7021_ADDR, &command, 1, HAL_MAX_DELAY);
HAL_I2C_Master_Receive(&hi2c1, SI7021_ADDR, raw, 2, HAL_MAX_DELAY);
```

可选，把读数事件打印到 UART：

```c
static const uint8_t msg[] = "SI7021 read complete\r\n";
HAL_UART_Transmit(&huart2, (uint8_t *)msg, sizeof(msg) - 1, HAL_MAX_DELAY);
```

## Expected simulation result

- 生成的 `board.repl` 会挂载 Renode native `Sensors.SI70xx @ i2c1 0x40`。
- 固件通过 MCU I2C1 控制器读 SI7021。
- UI 的 UART Terminal / Bus Transactions / Runtime Timeline 能看到对应活动。
