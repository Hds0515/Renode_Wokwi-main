import type { DevicePackageSource } from '../../../src/lib/device-package-types';

/**
 * Independent Device Package source for the board UART terminal.
 *
 * This package is a virtual instrument rather than a dragged component. It keeps
 * UART terminal panels and event parsing in the same package system as sensors
 * and displays.
 */
export const UART_TERMINAL_DEVICE_PACKAGE_SOURCE = {
  source: {
    packagePath: 'packages/devices/uart-terminal',
  },
  kind: 'uart-terminal',
  title: 'UART Terminal',
  subtitle: 'Virtual serial instrument',
  description:
    'A board-level virtual instrument package that binds the selected board UART to the Electron terminal and unified runtime event stream.',
  version: '1.0.0',
  category: 'instrument',
  visual: {
    icon: 'terminal',
    accentColor: '#a78bfa',
    defaultWidth: 180,
    defaultHeight: 104,
    terminalLayout: 'virtual-instrument',
    library: {
      visible: false,
      order: 300,
      group: 'Virtual Instruments',
      draggable: false,
      addMode: 'board-instrument',
    },
  },
  pins: [
    {
      id: 'tx',
      label: 'TX',
      role: 'uart-tx',
      direction: 'output',
      requiredPadCapabilities: ['uart-tx'],
      netKind: 'uart',
      protocols: ['uart'],
      terminal: {
        side: 'left',
        order: 0,
        handleId: 'uart-terminal:tx',
        connectable: false,
        dragGesture: 'virtual-board-instrument',
      },
    },
    {
      id: 'rx',
      label: 'RX',
      role: 'uart-rx',
      direction: 'input',
      requiredPadCapabilities: ['uart-rx'],
      netKind: 'uart',
      protocols: ['uart'],
      terminal: {
        side: 'right',
        order: 1,
        handleId: 'uart-terminal:rx',
        connectable: false,
        dragGesture: 'virtual-board-instrument',
      },
    },
  ],
  electricalRules: {
    requiresPower: false,
    requiresGround: false,
    voltageDomains: [],
    compatibleProtocols: ['uart'],
    busPairing: 'uart-tx-rx',
    outputContention: 'not-applicable',
  },
  protocol: {
    primary: 'uart',
    buses: ['uart'],
    transactionModel: 'uart-stream',
  },
  renodeBackend: {
    type: 'virtual-uart-terminal',
    manifest: 'board-runtime',
    model: 'socket-terminal',
  },
  runtimePanel: {
    controls: ['uart-terminal'],
    visualizers: ['uart-terminal', 'runtime-timeline'],
    eventParsers: ['uart-line-buffer'],
  },
  exampleFirmware: {
    mode: 'board-uart-terminal',
    generatedDriver: 'generated-board-uart-printf',
    requiredIncludes: ['stdint.h'],
  },
  validationFixture: {
    representative: 'uart-instrument',
    expectedManifest: 'board-runtime',
    expectedPanels: ['uart-terminal', 'runtime-timeline'],
    smokeExampleId: null,
  },
} as const satisfies DevicePackageSource;

export default UART_TERMINAL_DEVICE_PACKAGE_SOURCE;
