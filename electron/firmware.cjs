const PORT_BASE_ADDRESS = 0x58020000;
const PORT_STRIDE = 0x400;
const GPIO_PORT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
const BOARD_REPL_PATH = 'platforms/boards/nucleo_h753zi.repl';

const DEFAULT_DEMO_WIRING = {
  buttonPadId: 'CN10-3',
  ledPadId: 'CN7-10',
};

const PAD_MCU_PIN_MAP = {
  'CN7-8': 'PD9',
  'CN7-9': 'PD8',
  'CN7-10': 'PA5',
  'CN7-11': 'PA6',
  'CN7-12': 'PA7',
  'CN7-13': 'PD14',
  'CN7-14': 'PF15',
  'CN7-15': 'PF14',
  'CN7-16': 'PF13',
  'CN7-17': 'PG14',
  'CN7-18': 'PE11',
  'CN7-19': 'PE9',
  'CN7-20': 'PF3',
  'CN8-2': 'PC8',
  'CN8-4': 'PC9',
  'CN8-6': 'PC10',
  'CN8-8': 'PC11',
  'CN8-10': 'PC12',
  'CN8-12': 'PD2',
  'CN8-14': 'PG2',
  'CN8-16': 'PG3',
  'CN9-1': 'PA3',
  'CN9-2': 'PC0',
  'CN9-3': 'PC3',
  'CN9-4': 'PB1',
  'CN9-5': 'PB9',
  'CN9-6': 'PB8',
  'CN9-7': 'PF4',
  'CN9-8': 'PF5',
  'CN9-9': 'PF10',
  'CN9-10': 'PE15',
  'CN9-11': 'PF11',
  'CN9-12': 'PF12',
  'CN9-13': 'PD15',
  'CN9-14': 'PE13',
  'CN9-15': 'PF15',
  'CN9-16': 'PA9',
  'CN9-17': 'PA10',
  'CN9-18': 'PG13',
  'CN9-19': 'PB13',
  'CN9-20': 'PB12',
  'CN9-23': 'PD6',
  'CN9-24': 'PD5',
  'CN9-25': 'PD4',
  'CN9-26': 'PD7',
  'CN9-27': 'PB3',
  'CN9-28': 'PB5',
  'CN9-29': 'PB4',
  'CN9-30': 'PB10',
  'CN10-3': 'PG12',
  'CN10-4': 'PG10',
  'CN10-5': 'PA3',
  'CN10-6': 'PB6',
  'CN10-7': 'PA7',
  'CN10-8': 'PA6',
  'CN10-9': 'PA5',
  'CN10-11': 'PB9',
  'CN10-12': 'PB8',
  'CN10-14': 'PC6',
  'CN10-15': 'PA15',
  'CN10-16': 'PC7',
  'CN10-17': 'PB5',
  'CN10-18': 'PB4',
  'CN10-19': 'PB10',
  'CN10-20': 'PA8',
  'CN10-21': 'PA9',
  'CN10-22': 'PC7',
  'CN10-23': 'PB2',
  'CN10-24': 'PB1',
  'CN10-25': 'PE8',
  'CN10-26': 'PE10',
  'CN10-27': 'PE12',
  'CN10-28': 'PE14',
  'CN10-29': 'PE15',
  'CN10-30': 'PE7',
  'CN10-31': 'PE9',
  'CN10-32': 'PG14',
  'CN10-33': 'PG9',
  'CN10-34': 'PG13',
};

function formatHex(value) {
  return `0x${value.toString(16).toUpperCase()}`;
}

function normalizeMcuPinId(candidate) {
  const normalized = String(candidate || '').trim().toUpperCase();
  return /^P[A-K](?:1[0-5]|[0-9])$/.test(normalized) ? normalized : null;
}

function resolvePadMcuPin(padId) {
  const fromMap = PAD_MCU_PIN_MAP[String(padId).trim()];
  if (fromMap) {
    return fromMap;
  }

  throw new Error(`Unsupported board pad id for CLI helpers: ${padId}`);
}

function resolvePinFromPadId(padId) {
  const mcuPinId = resolvePadMcuPin(padId);
  const normalized = normalizeMcuPinId(mcuPinId);
  const portLetter = normalized[1];
  const number = Number(normalized.slice(2));
  const portIndex = GPIO_PORT_LETTERS.indexOf(portLetter);

  return {
    padId,
    mcuPinId: normalized,
    portLetter,
    portIndex,
    number,
    baseAddress: PORT_BASE_ADDRESS + portIndex * PORT_STRIDE,
  };
}

function generateDemoMainSource(wiring = DEFAULT_DEMO_WIRING) {
  const button = resolvePinFromPadId(wiring.buttonPadId);
  const led = resolvePinFromPadId(wiring.ledPadId);

  return `// Auto-generated demo firmware for the Renode NUCLEO-H753ZI workbench.
// External button pad: ${button.padId} -> ${button.mcuPinId}
// External LED pad: ${led.padId} -> ${led.mcuPinId}

typedef unsigned int uint32_t;

#define RCC_BASE            0x58024400u
#define RCC_AHB4ENR         (*(volatile uint32_t *)(RCC_BASE + 0xE0u))

#define LED_GPIO_BASE       ${formatHex(led.baseAddress)}u
#define BUTTON_GPIO_BASE    ${formatHex(button.baseAddress)}u
#define LED_PIN             ${led.number}u
#define BUTTON_PIN          ${button.number}u
#define LED_PORT_ENABLE     ${led.portIndex}u
#define BUTTON_PORT_ENABLE  ${button.portIndex}u

#define GPIO_MODER(base)    (*(volatile uint32_t *)((base) + 0x00u))
#define GPIO_PUPDR(base)    (*(volatile uint32_t *)((base) + 0x0Cu))
#define GPIO_IDR(base)      (*(volatile uint32_t *)((base) + 0x10u))
#define GPIO_BSRR(base)     (*(volatile uint32_t *)((base) + 0x18u))

static void enable_gpio_clocks(void) {
    RCC_AHB4ENR |= (1u << LED_PORT_ENABLE) | (1u << BUTTON_PORT_ENABLE);
}

static void configure_led(void) {
    GPIO_MODER(LED_GPIO_BASE) &= ~(3u << (LED_PIN * 2u));
    GPIO_MODER(LED_GPIO_BASE) |=  (1u << (LED_PIN * 2u));
}

static void configure_button(void) {
    GPIO_MODER(BUTTON_GPIO_BASE) &= ~(3u << (BUTTON_PIN * 2u));
    GPIO_PUPDR(BUTTON_GPIO_BASE) &= ~(3u << (BUTTON_PIN * 2u));
    GPIO_PUPDR(BUTTON_GPIO_BASE) |=  (2u << (BUTTON_PIN * 2u));
}

static void set_led(int on) {
    if(on) {
        GPIO_BSRR(LED_GPIO_BASE) = (1u << LED_PIN);
    } else {
        GPIO_BSRR(LED_GPIO_BASE) = (1u << (LED_PIN + 16u));
    }
}

int main(void) {
    enable_gpio_clocks();
    configure_led();
    configure_button();

    while(1) {
        const int pressed = (GPIO_IDR(BUTTON_GPIO_BASE) & (1u << BUTTON_PIN)) != 0;
        set_led(pressed);
    }
}
`;
}

const DEFAULT_MAIN_SOURCE = generateDemoMainSource(DEFAULT_DEMO_WIRING);

const DEFAULT_STARTUP_SOURCE = `typedef unsigned int uint32_t;

extern int main(void);

extern uint32_t _estack;
extern uint32_t _sidata;
extern uint32_t _sdata;
extern uint32_t _edata;
extern uint32_t _sbss;
extern uint32_t _ebss;

void Reset_Handler(void);
void Default_Handler(void);

void NMI_Handler(void) __attribute__((weak, alias("Default_Handler")));
void HardFault_Handler(void) __attribute__((weak, alias("Default_Handler")));
void MemManage_Handler(void) __attribute__((weak, alias("Default_Handler")));
void BusFault_Handler(void) __attribute__((weak, alias("Default_Handler")));
void UsageFault_Handler(void) __attribute__((weak, alias("Default_Handler")));
void SVC_Handler(void) __attribute__((weak, alias("Default_Handler")));
void DebugMon_Handler(void) __attribute__((weak, alias("Default_Handler")));
void PendSV_Handler(void) __attribute__((weak, alias("Default_Handler")));
void SysTick_Handler(void) __attribute__((weak, alias("Default_Handler")));

__attribute__((section(".isr_vector")))
void (*const vector_table[])(void) = {
    (void (*)(void))(&_estack),
    Reset_Handler,
    NMI_Handler,
    HardFault_Handler,
    MemManage_Handler,
    BusFault_Handler,
    UsageFault_Handler,
    0,
    0,
    0,
    0,
    SVC_Handler,
    DebugMon_Handler,
    0,
    PendSV_Handler,
    SysTick_Handler,
};

void Reset_Handler(void) {
    uint32_t *src = &_sidata;
    uint32_t *dst = &_sdata;

    while(dst < &_edata) {
        *dst++ = *src++;
    }

    dst = &_sbss;
    while(dst < &_ebss) {
        *dst++ = 0;
    }

    (void)main();

    while(1) {
    }
}

void Default_Handler(void) {
    while(1) {
    }
}
`;

const DEFAULT_LINKER_FILENAME = 'stm32h753zi.ld';
const DEFAULT_GCC_ARGS = ['-mcpu=cortex-m7', '-mthumb'];

const DEFAULT_LINKER_SCRIPT = `ENTRY(Reset_Handler)

MEMORY
{
    FLASH (rx)  : ORIGIN = 0x08000000, LENGTH = 2048K
    RAM   (rwx) : ORIGIN = 0x20000000, LENGTH = 128K
}

_estack = ORIGIN(RAM) + LENGTH(RAM);

SECTIONS
{
    .isr_vector :
    {
        KEEP(*(.isr_vector))
    } > FLASH

    .text :
    {
        *(.text*)
        *(.rodata*)
        . = ALIGN(4);
        _etext = .;
    } > FLASH

    _sidata = LOADADDR(.data);

    .data :
    {
        . = ALIGN(4);
        _sdata = .;
        *(.data*)
        . = ALIGN(4);
        _edata = .;
    } > RAM AT > FLASH

    .bss (NOLOAD) :
    {
        . = ALIGN(4);
        _sbss = .;
        *(.bss*)
        *(COMMON)
        . = ALIGN(4);
        _ebss = .;
    } > RAM
}
`;

function generateBoardRepl(wiring = DEFAULT_DEMO_WIRING) {
  const button = resolvePinFromPadId(wiring.buttonPadId);
  const led = resolvePinFromPadId(wiring.ledPadId);

  return [
    `using "${BOARD_REPL_PATH}"`,
    '',
    `externalButton: Miscellaneous.Button @ gpioPort${button.portLetter}`,
    `    -> gpioPort${button.portLetter}@${button.number}`,
    '',
    `externalLed: Miscellaneous.LED @ gpioPort${led.portLetter}`,
    '',
    `gpioPort${led.portLetter}:`,
    `    ${led.number} -> externalLed@0`,
    '',
  ].join('\n');
}

module.exports = {
  DEFAULT_DEMO_WIRING,
  DEFAULT_MAIN_SOURCE,
  DEFAULT_STARTUP_SOURCE,
  DEFAULT_LINKER_FILENAME,
  DEFAULT_LINKER_SCRIPT,
  DEFAULT_GCC_ARGS,
  generateDemoMainSource,
  generateBoardRepl,
};
