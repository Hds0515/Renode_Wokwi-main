# STM32F4 Discovery Button -> LED

## CubeMX target

- MCU / Board: `STM32F407VGTx` or STM32F4 Discovery
- Toolchain / IDE: `STM32CubeIDE`

## Expected visual wiring

| Visual device | Canvas pad | MCU pin | CubeMX mode |
| --- | --- | --- | --- |
| Button 1 SIG | `F4A-2` | `PA1` | `GPIO_Input`, Pull-down |
| LED 1 SIG | `F4D-1` | `PB0` | `GPIO_Output`, Push Pull, Low speed |
| UART terminal TX | board runtime | `PA2` | `USART2_TX`, Asynchronous |
| UART terminal RX | board runtime | `PA3` | `USART2_RX`, Asynchronous |

建议在 CubeMX 中设置 User Label：

- `PA1`: `BTN`
- `PB0`: `LED`

## Minimal user code

放在 `main.c` 的 `while (1)` 中：

```c
GPIO_PinState pressed = HAL_GPIO_ReadPin(BTN_GPIO_Port, BTN_Pin);
HAL_GPIO_WritePin(LED_GPIO_Port, LED_Pin, pressed == GPIO_PIN_SET ? GPIO_PIN_SET : GPIO_PIN_RESET);
```

可选 UART 输出：

```c
static const uint8_t msg[] = "F4 user firmware alive\r\n";
HAL_UART_Transmit(&huart2, (uint8_t *)msg, sizeof(msg) - 1, HAL_MAX_DELAY);
```

## Expected simulation result

- 按住画布 Button，LED 亮。
- 松开 Button，LED 灭。
- 如果加入 UART 输出，右侧 UART Terminal 能看到文本。
