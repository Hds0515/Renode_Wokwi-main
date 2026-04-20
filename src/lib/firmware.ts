export const DEFAULT_BRIDGE_PORT = 9001;
export const DEFAULT_GDB_PORT = 3333;

const PORT_BASE_ADDRESS = 0x40020000;
const PORT_STRIDE = 0x400;
const GPIO_PORT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'] as const;
const LEFT_BANKS = new Set(['A', 'C', 'E', 'G', 'I', 'K']);

export type GpioPortLetter = (typeof GPIO_PORT_LETTERS)[number];

export type DemoBoardPin = {
  id: string;
  portLetter: GpioPortLetter;
  portIndex: number;
  portLabel: string;
  number: number;
  side: 'left' | 'right';
  baseAddress: number;
};

export type DemoPinBank = {
  id: string;
  title: string;
  side: 'left' | 'right';
  pins: DemoBoardPin[];
};

export type DemoWiring = {
  buttonPinId: string;
  ledPinId: string;
};

function formatHex(value: number): string {
  return `0x${value.toString(16).toUpperCase()}`;
}

function buildPin(portLetter: GpioPortLetter, number: number): DemoBoardPin {
  const portIndex = GPIO_PORT_LETTERS.indexOf(portLetter);
  return {
    id: `P${portLetter}${number}`,
    portLetter,
    portIndex,
    portLabel: `GPIO${portLetter}`,
    number,
    side: LEFT_BANKS.has(portLetter) ? 'left' : 'right',
    baseAddress: PORT_BASE_ADDRESS + portIndex * PORT_STRIDE,
  };
}

function buildBank(portLetter: GpioPortLetter): DemoPinBank {
  return {
    id: `gpio-${portLetter.toLowerCase()}`,
    title: `GPIO${portLetter}`,
    side: LEFT_BANKS.has(portLetter) ? 'left' : 'right',
    pins: Array.from({ length: 16 }, (_, index) => buildPin(portLetter, 15 - index)),
  };
}

export const DEMO_PIN_BANKS: DemoPinBank[] = GPIO_PORT_LETTERS.map(buildBank);
export const DEMO_LEFT_PIN_BANKS = DEMO_PIN_BANKS.filter((bank) => bank.side === 'left');
export const DEMO_RIGHT_PIN_BANKS = DEMO_PIN_BANKS.filter((bank) => bank.side === 'right');

export const DEFAULT_DEMO_WIRING: DemoWiring = {
  buttonPinId: 'PB0',
  ledPinId: 'PA5',
};

export function resolvePin(pinId: string): DemoBoardPin {
  const match = /^P([A-K])(\d{1,2})$/i.exec(pinId.trim());
  if (!match) {
    throw new Error(`Unsupported GPIO pin id: ${pinId}`);
  }

  const portLetter = match[1].toUpperCase() as GpioPortLetter;
  const number = Number(match[2]);
  if (number < 0 || number > 15) {
    throw new Error(`GPIO pin number is out of range: ${pinId}`);
  }

  return buildPin(portLetter, number);
}

export const DEFAULT_MAIN_SOURCE = generateDemoMainSource(DEFAULT_DEMO_WIRING);

export const DEFAULT_STARTUP_SOURCE = `typedef unsigned int uint32_t;

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

export const DEFAULT_LINKER_SCRIPT = `ENTRY(Reset_Handler)

MEMORY
{
    FLASH (rx)  : ORIGIN = 0x08000000, LENGTH = 1024K
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

export function generateDemoMainSource(wiring: DemoWiring): string {
  const button = resolvePin(wiring.buttonPinId);
  const led = resolvePin(wiring.ledPinId);

  return `// Auto-generated demo firmware for Renode STM32F4 GPIO Explorer.
// Press the external button on ${button.id} to drive the external LED on ${led.id}.

typedef unsigned int uint32_t;

#define RCC_BASE            0x40023800u
#define RCC_AHB1ENR         (*(volatile uint32_t *)(RCC_BASE + 0x30u))

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
    RCC_AHB1ENR |= (1u << LED_PORT_ENABLE) | (1u << BUTTON_PORT_ENABLE);
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

export function generateBoardRepl(wiring: DemoWiring): string {
  const button = resolvePin(wiring.buttonPinId);
  const led = resolvePin(wiring.ledPinId);

  return [
    'using "platforms/cpus/stm32f4.repl"',
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

export function generateRescPreview(options: {
  elfPath: string | null;
  gdbPort: number;
  bridgePort: number;
}): string {
  const elfPath = options.elfPath ?? '${workspace}/build/firmware.elf';

  return [
    '$name?="STM32F4 GPIO Explorer"',
    'mach create $name',
    '',
    'machine LoadPlatformDescription @${workspace}/board.repl',
    'using sysbus',
    `sysbus LoadELF @${elfPath}`,
    'include @${workspace}/renode_bridge.py',
    `machine StartGdbServer ${options.gdbPort}`,
    'start',
    '',
  ].join('\n');
}
