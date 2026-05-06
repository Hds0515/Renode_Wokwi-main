/**
 * Device Package Renode Backend Compiler v1.
 *
 * This is the package-native Renode generation layer. It receives the
 * DevicePackage manifest produced by the Netlist compiler and dispatches each
 * component by `renodeBackend.type`, producing `.repl` fragments plus structured
 * runtime backend descriptors for native plugins and Electron brokers.
 */
import type { BoardSchema } from './boards';
import type { DevicePackageProtocol, DevicePackageRenodeBackend } from './device-packages';
import type { NetlistRenodeDevicePackageBinding } from './netlist';
import { findRenodeNativePeripheralCatalogEntry } from './renode-native-peripheral-catalog';
import {
  buildRenodeSensorPeripheralName,
  findSensorPackage,
} from './sensor-packages';

export const DEVICE_PACKAGE_RENODE_BACKEND_COMPILER_SCHEMA_VERSION = 1;

export type DevicePackageRenodeBackendCompilerDiagnostic = {
  severity: 'error' | 'warning' | 'info';
  code:
    | 'missing-gpio-pin'
    | 'missing-bus'
    | 'bus-mismatch'
    | 'unsupported-backend'
    | 'broker-only-backend'
    | 'virtual-instrument';
  message: string;
  componentId: string;
  devicePackageKind: string;
  pinId?: string | null;
};

export type DevicePackageRenodeReplFragment = {
  id: string;
  componentId: string;
  devicePackageKind: string;
  backendType: DevicePackageRenodeBackend['type'];
  protocol: DevicePackageProtocol;
  label: string;
  status: 'emitted' | 'broker-only' | 'virtual-instrument' | 'skipped';
  renodeName: string | null;
  busName: string | null;
  address: number | null;
  text: string;
};

export type DevicePackageRenodeSignalBackend = {
  componentId: string;
  devicePackageKind: string;
  pinId: string;
  peripheralId: string;
  label: string;
  direction: 'input' | 'output' | 'bidirectional' | null;
  renodeName: string;
  renodeModel: string;
  gpioPortName: string;
  gpioNumber: number;
  mcuPinId: string;
};

export type DevicePackageRenodeNativePeripheralBackend = {
  componentId: string;
  devicePackageKind: string;
  label: string;
  renodeName: string;
  renodeType: string;
  nativeCatalogId: string | null;
  busName: string;
  address: number;
  modelLine: string | null;
};

export type DevicePackageRenodeBusBrokerBackend = {
  componentId: string;
  devicePackageKind: string;
  label: string;
  protocol: Exclude<DevicePackageProtocol, 'gpio' | 'power' | 'ground' | 'virtual'>;
  model: string;
  busName: string | null;
  address: number | null;
  pins: NetlistRenodeDevicePackageBinding['pins'];
};

export type DevicePackageRenodeVirtualInstrumentBackend = {
  componentId: string;
  devicePackageKind: string;
  label: string;
  protocol: DevicePackageProtocol;
  model: string;
  boardRuntimeBinding: string | null;
};

export type DevicePackageRenodeBackendCompilerSummary = {
  componentCount: number;
  signalBrokerCount: number;
  nativePeripheralCount: number;
  busTransactionBrokerCount: number;
  virtualInstrumentCount: number;
  emittedReplFragmentCount: number;
  diagnosticCount: number;
};

export type DevicePackageRenodeBackendCompilerArtifacts = {
  schemaVersion: typeof DEVICE_PACKAGE_RENODE_BACKEND_COMPILER_SCHEMA_VERSION;
  generatedFor: {
    boardId: string;
    boardName: string;
    renodePlatformPath: string;
  };
  boardRepl: string;
  replFragments: readonly DevicePackageRenodeReplFragment[];
  signalBackends: readonly DevicePackageRenodeSignalBackend[];
  nativePeripheralBackends: readonly DevicePackageRenodeNativePeripheralBackend[];
  busBrokerBackends: readonly DevicePackageRenodeBusBrokerBackend[];
  virtualInstrumentBackends: readonly DevicePackageRenodeVirtualInstrumentBackend[];
  diagnostics: readonly DevicePackageRenodeBackendCompilerDiagnostic[];
  summary: DevicePackageRenodeBackendCompilerSummary;
};

function sanitizeRenodeIdentifier(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_]/g, '_');
  return /^[a-zA-Z_]/.test(sanitized) ? sanitized : `_${sanitized}`;
}

function formatHex(value: number): string {
  return `0x${value.toString(16).toUpperCase()}`;
}

function normalizeMcuPinId(value: string | null | undefined): string | null {
  const match = String(value ?? '').trim().toUpperCase().match(/^P([A-K])([0-9]|1[0-5])$/);
  return match ? `P${match[1]}${Number(match[2])}` : null;
}

function resolveGpioPin(mcuPinId: string | null | undefined): { portLetter: string; gpioPortName: string; number: number } | null {
  const normalized = normalizeMcuPinId(mcuPinId);
  if (!normalized) {
    return null;
  }
  const portLetter = normalized[1];
  const number = Number(normalized.slice(2));
  return {
    portLetter,
    gpioPortName: `gpioPort${portLetter}`,
    number,
  };
}

function normalizeRenodeBusName(protocol: DevicePackageProtocol, busId: string | null | undefined): string | null {
  const raw = String(busId ?? '').trim();
  if (!raw) {
    return null;
  }
  if (protocol === 'i2c') {
    const match = raw.match(/I2C(\d*)/i);
    return match ? `i2c${match[1] || ''}`.toLowerCase() : null;
  }
  if (protocol === 'spi') {
    const match = raw.match(/SPI(\d*)/i);
    return match ? `spi${match[1] || ''}`.toLowerCase() : null;
  }
  if (protocol === 'uart') {
    const match = raw.match(/(?:USART|UART|LPUART)(\d*)/i);
    return match ? `usart${match[1] || ''}`.toLowerCase() : null;
  }
  return null;
}

function getConnectedPins(binding: NetlistRenodeDevicePackageBinding) {
  return binding.pins.filter((pin) => pin.padId && pin.mcuPinId);
}

function getPinByRole(binding: NetlistRenodeDevicePackageBinding, role: string) {
  return binding.pins.find((pin) => pin.pinRole === role) ?? null;
}

function getBusNameFromPins(binding: NetlistRenodeDevicePackageBinding, protocol: DevicePackageProtocol) {
  const busNames = Array.from(
    new Set(
      binding.pins
        .map((pin) => normalizeRenodeBusName(protocol, pin.busId))
        .filter((busName): busName is string => Boolean(busName))
    )
  );
  return {
    busName: busNames[0] ?? null,
    allBusNames: busNames,
  };
}

function getSignalRenodeName(binding: NetlistRenodeDevicePackageBinding, pin: NetlistRenodeDevicePackageBinding['pins'][number]) {
  const peripheralId = pin.peripheralId ?? `${binding.componentId}-${pin.pinId}`;
  if (binding.renodeBackend.replPeripheral === 'Miscellaneous.Button' || pin.direction === 'input') {
    return `externalButton__${sanitizeRenodeIdentifier(peripheralId)}`;
  }
  if (binding.devicePackageKind === 'buzzer') {
    return `externalBuzzer__${sanitizeRenodeIdentifier(peripheralId)}`;
  }
  return `externalLed__${sanitizeRenodeIdentifier(peripheralId)}`;
}

function compileSignalBrokerBackend(binding: NetlistRenodeDevicePackageBinding): {
  fragments: DevicePackageRenodeReplFragment[];
  signalBackends: DevicePackageRenodeSignalBackend[];
  diagnostics: DevicePackageRenodeBackendCompilerDiagnostic[];
  gpioMappings: Map<string, string[]>;
} {
  const fragments: DevicePackageRenodeReplFragment[] = [];
  const signalBackends: DevicePackageRenodeSignalBackend[] = [];
  const diagnostics: DevicePackageRenodeBackendCompilerDiagnostic[] = [];
  const gpioMappings = new Map<string, string[]>();
  const connectedPins = getConnectedPins(binding).filter((pin) => pin.netKind === 'gpio');

  if (connectedPins.length === 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'missing-gpio-pin',
      message: `${binding.label} has a signal-broker backend but no connected GPIO pin.`,
      componentId: binding.componentId,
      devicePackageKind: binding.devicePackageKind,
    });
  }

  connectedPins.forEach((pin) => {
    const gpio = resolveGpioPin(pin.mcuPinId);
    if (!gpio) {
      diagnostics.push({
        severity: 'error',
        code: 'missing-gpio-pin',
        message: `${binding.label} ${pin.pinLabel} is not mapped to a valid MCU GPIO pin.`,
        componentId: binding.componentId,
        devicePackageKind: binding.devicePackageKind,
        pinId: pin.pinId,
      });
      return;
    }

    const renodeModel = binding.renodeBackend.replPeripheral ?? binding.renodeBackend.model;
    const renodeName = getSignalRenodeName(binding, pin);
    const direction = pin.direction ?? null;
    const isInput = renodeModel === 'Miscellaneous.Button' || direction === 'input';
    const text = isInput
      ? [
          `// ${binding.label} ${pin.pinLabel}: ${pin.mcuPinId}`,
          `${renodeName}: ${renodeModel} @ ${gpio.gpioPortName}`,
          `    -> ${gpio.gpioPortName}@${gpio.number}`,
          '',
        ].join('\n')
      : [`// ${binding.label} ${pin.pinLabel}: ${pin.mcuPinId}`, `${renodeName}: ${renodeModel} @ ${gpio.gpioPortName}`, ''].join('\n');

    if (!isInput) {
      const mappings = gpioMappings.get(gpio.portLetter) ?? [];
      mappings.push(`    ${gpio.number} -> ${renodeName}@0`);
      gpioMappings.set(gpio.portLetter, mappings);
    }

    signalBackends.push({
      componentId: binding.componentId,
      devicePackageKind: binding.devicePackageKind,
      pinId: pin.pinId,
      peripheralId: pin.peripheralId ?? `${binding.componentId}-${pin.pinId}`,
      label: `${binding.label} ${pin.pinLabel}`,
      direction,
      renodeName,
      renodeModel,
      gpioPortName: gpio.gpioPortName,
      gpioNumber: gpio.number,
      mcuPinId: pin.mcuPinId ?? '',
    });
    fragments.push({
      id: `signal:${binding.componentId}:${pin.pinId}`,
      componentId: binding.componentId,
      devicePackageKind: binding.devicePackageKind,
      backendType: 'signal-broker',
      protocol: 'gpio',
      label: `${binding.label} ${pin.pinLabel}`,
      status: 'emitted',
      renodeName,
      busName: null,
      address: null,
      text,
    });
  });

  return { fragments, signalBackends, diagnostics, gpioMappings };
}

function compileNativePeripheralBackend(binding: NetlistRenodeDevicePackageBinding): {
  fragment: DevicePackageRenodeReplFragment;
  nativeBackend: DevicePackageRenodeNativePeripheralBackend | null;
  diagnostics: DevicePackageRenodeBackendCompilerDiagnostic[];
} {
  const diagnostics: DevicePackageRenodeBackendCompilerDiagnostic[] = [];
  const sensorPackage = findSensorPackage(binding.renodeBackend.sensorPackage);
  const catalogEntry = findRenodeNativePeripheralCatalogEntry(
    binding.renodeBackend.nativeCatalogId ?? sensorPackage?.native.nativeCatalogId
  );
  const { busName, allBusNames } = getBusNameFromPins(binding, binding.protocol.primary);
  const address = binding.renodeBackend.address ?? catalogEntry?.defaultAddress ?? sensorPackage?.native.defaultAddress ?? binding.protocol.defaultAddress ?? null;
  const nativeRenodeType = binding.renodeBackend.nativeRenodeType ?? catalogEntry?.renodeType ?? sensorPackage?.native.renodeType ?? null;
  const renodeName = sensorPackage
    ? buildRenodeSensorPeripheralName(sensorPackage.kind, binding.componentId)
    : catalogEntry
      ? `${catalogEntry.propertyPath.peripheralNamePrefix}__${sanitizeRenodeIdentifier(binding.componentId)}`
    : `${sanitizeRenodeIdentifier(binding.devicePackageKind)}__${sanitizeRenodeIdentifier(binding.componentId)}`;
  const modelLine =
    (catalogEntry?.modelProperty ?? sensorPackage?.native.modelProperty) &&
    (catalogEntry?.modelValue ?? sensorPackage?.native.modelValue)
      ? `    ${catalogEntry?.modelProperty ?? sensorPackage?.native.modelProperty}: ${catalogEntry?.modelValue ?? sensorPackage?.native.modelValue}`
      : null;

  if (!busName) {
    diagnostics.push({
      severity: 'error',
      code: 'missing-bus',
      message: `${binding.label} is a native Renode peripheral but its bus pins are not connected to a Renode bus.`,
      componentId: binding.componentId,
      devicePackageKind: binding.devicePackageKind,
    });
  }
  if (allBusNames.length > 1) {
    diagnostics.push({
      severity: 'error',
      code: 'bus-mismatch',
      message: `${binding.label} has pins on multiple buses: ${allBusNames.join(', ')}.`,
      componentId: binding.componentId,
      devicePackageKind: binding.devicePackageKind,
    });
  }
  if (!nativeRenodeType || typeof address !== 'number' || !busName) {
    return {
      fragment: {
        id: `native:${binding.componentId}`,
        componentId: binding.componentId,
        devicePackageKind: binding.devicePackageKind,
        backendType: binding.renodeBackend.type,
        protocol: binding.protocol.primary,
        label: binding.label,
        status: 'skipped',
        renodeName: null,
        busName,
        address,
        text: `// ${binding.label}: native Renode peripheral backend skipped because bus/type/address metadata is incomplete.\n`,
      },
      nativeBackend: null,
      diagnostics,
    };
  }

  const text = [
    `// ${binding.label}: ${binding.devicePackageKind} via ${busName.toUpperCase()}`,
    `${renodeName}: ${nativeRenodeType} @ ${busName} ${formatHex(address)}`,
    ...(modelLine ? [modelLine] : []),
    '',
  ].join('\n');

  return {
    fragment: {
      id: `native:${binding.componentId}`,
      componentId: binding.componentId,
      devicePackageKind: binding.devicePackageKind,
      backendType: binding.renodeBackend.type,
      protocol: binding.protocol.primary,
      label: binding.label,
      status: 'emitted',
      renodeName,
      busName,
      address,
      text,
    },
    nativeBackend: {
      componentId: binding.componentId,
      devicePackageKind: binding.devicePackageKind,
      label: binding.label,
      renodeName,
      renodeType: nativeRenodeType,
      nativeCatalogId: catalogEntry?.id ?? sensorPackage?.native.nativeCatalogId ?? null,
      busName,
      address,
      modelLine,
    },
    diagnostics,
  };
}

function compileBusTransactionBrokerBackend(binding: NetlistRenodeDevicePackageBinding): {
  fragment: DevicePackageRenodeReplFragment;
  busBackend: DevicePackageRenodeBusBrokerBackend;
  diagnostics: DevicePackageRenodeBackendCompilerDiagnostic[];
} {
  const protocol = binding.protocol.primary === 'spi' ? 'spi' : 'i2c';
  const { busName, allBusNames } = getBusNameFromPins(binding, protocol);
  const diagnostics: DevicePackageRenodeBackendCompilerDiagnostic[] = [
    {
      severity: 'info',
      code: 'broker-only-backend',
      message: `${binding.label} uses the Transaction Broker path; no native Renode peripheral is emitted in board.repl yet.`,
      componentId: binding.componentId,
      devicePackageKind: binding.devicePackageKind,
    },
  ];

  if (!busName) {
    diagnostics.push({
      severity: 'warning',
      code: 'missing-bus',
      message: `${binding.label} broker backend has no connected ${protocol.toUpperCase()} bus yet.`,
      componentId: binding.componentId,
      devicePackageKind: binding.devicePackageKind,
    });
  }
  if (allBusNames.length > 1) {
    diagnostics.push({
      severity: 'error',
      code: 'bus-mismatch',
      message: `${binding.label} has broker pins on multiple buses: ${allBusNames.join(', ')}.`,
      componentId: binding.componentId,
      devicePackageKind: binding.devicePackageKind,
    });
  }

  return {
    fragment: {
      id: `broker:${binding.componentId}`,
      componentId: binding.componentId,
      devicePackageKind: binding.devicePackageKind,
      backendType: 'bus-transaction-broker',
      protocol,
      label: binding.label,
      status: 'broker-only',
      renodeName: null,
      busName,
      address: binding.renodeBackend.address ?? binding.protocol.defaultAddress ?? null,
      text: `// ${binding.label}: ${binding.renodeBackend.model} is visualized through the ${protocol.toUpperCase()} Transaction Broker.\n`,
    },
    busBackend: {
      componentId: binding.componentId,
      devicePackageKind: binding.devicePackageKind,
      label: binding.label,
      protocol,
      model: binding.renodeBackend.model,
      busName,
      address: binding.renodeBackend.address ?? binding.protocol.defaultAddress ?? null,
      pins: binding.pins,
    },
    diagnostics,
  };
}

function compileVirtualInstrumentBackend(
  board: BoardSchema,
  binding: NetlistRenodeDevicePackageBinding
): {
  fragment: DevicePackageRenodeReplFragment;
  virtualBackend: DevicePackageRenodeVirtualInstrumentBackend;
  diagnostics: DevicePackageRenodeBackendCompilerDiagnostic[];
} {
  const boardRuntimeBinding = binding.protocol.primary === 'uart' ? board.runtime.uart?.peripheralName ?? null : null;
  return {
    fragment: {
      id: `virtual:${binding.componentId}`,
      componentId: binding.componentId,
      devicePackageKind: binding.devicePackageKind,
      backendType: 'virtual-uart-terminal',
      protocol: binding.protocol.primary,
      label: binding.label,
      status: 'virtual-instrument',
      renodeName: null,
      busName: boardRuntimeBinding,
      address: null,
      text: `// ${binding.label}: virtual instrument bound by runtime script${boardRuntimeBinding ? ` to ${boardRuntimeBinding}` : ''}.\n`,
    },
    virtualBackend: {
      componentId: binding.componentId,
      devicePackageKind: binding.devicePackageKind,
      label: binding.label,
      protocol: binding.protocol.primary,
      model: binding.renodeBackend.model,
      boardRuntimeBinding,
    },
    diagnostics: [
      {
        severity: 'info',
        code: 'virtual-instrument',
        message: `${binding.label} is a virtual instrument configured in run.resc/runtime, not a board.repl peripheral.`,
        componentId: binding.componentId,
        devicePackageKind: binding.devicePackageKind,
      },
    ],
  };
}

function createBoardRepl(options: {
  board: BoardSchema;
  fragments: readonly DevicePackageRenodeReplFragment[];
  gpioMappings: ReadonlyMap<string, readonly string[]>;
}): string {
  const emittedFragments = options.fragments.filter((fragment) => fragment.text.trim().length > 0);
  const portBlocks = [...options.gpioMappings.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([portLetter, mappings]) => [`gpioPort${portLetter}:`, ...[...mappings].sort(), ''].join('\n'));

  return [
    `using "${options.board.runtime.renodePlatformPath}"`,
    '',
    '// External lab peripherals attached from the Device Package Renode Backend Compiler v1.',
    '',
    ...(emittedFragments.length > 0 ? emittedFragments.map((fragment) => fragment.text) : ['// No external Device Package backends are connected.', '']),
    ...portBlocks,
  ].join('\n');
}

export function compileDevicePackageRenodeBackends(options: {
  board: BoardSchema;
  devicePackageManifest: readonly NetlistRenodeDevicePackageBinding[];
}): DevicePackageRenodeBackendCompilerArtifacts {
  const replFragments: DevicePackageRenodeReplFragment[] = [];
  const signalBackends: DevicePackageRenodeSignalBackend[] = [];
  const nativePeripheralBackends: DevicePackageRenodeNativePeripheralBackend[] = [];
  const busBrokerBackends: DevicePackageRenodeBusBrokerBackend[] = [];
  const virtualInstrumentBackends: DevicePackageRenodeVirtualInstrumentBackend[] = [];
  const diagnostics: DevicePackageRenodeBackendCompilerDiagnostic[] = [];
  const gpioMappings = new Map<string, string[]>();

  options.devicePackageManifest.forEach((binding) => {
    switch (binding.renodeBackend.type) {
      case 'signal-broker': {
        const result = compileSignalBrokerBackend(binding);
        replFragments.push(...result.fragments);
        signalBackends.push(...result.signalBackends);
        diagnostics.push(...result.diagnostics);
        result.gpioMappings.forEach((mappings, portLetter) => {
          gpioMappings.set(portLetter, [...(gpioMappings.get(portLetter) ?? []), ...mappings]);
        });
        return;
      }
      case 'renode-native-sensor':
      case 'renode-native-peripheral': {
        const result = compileNativePeripheralBackend(binding);
        replFragments.push(result.fragment);
        if (result.nativeBackend) {
          nativePeripheralBackends.push(result.nativeBackend);
        }
        diagnostics.push(...result.diagnostics);
        return;
      }
      case 'bus-transaction-broker': {
        const result = compileBusTransactionBrokerBackend(binding);
        replFragments.push(result.fragment);
        busBrokerBackends.push(result.busBackend);
        diagnostics.push(...result.diagnostics);
        return;
      }
      case 'virtual-uart-terminal': {
        const result = compileVirtualInstrumentBackend(options.board, binding);
        replFragments.push(result.fragment);
        virtualInstrumentBackends.push(result.virtualBackend);
        diagnostics.push(...result.diagnostics);
        return;
      }
      default:
        diagnostics.push({
          severity: 'error',
          code: 'unsupported-backend',
          message: `${binding.label} uses unsupported backend type ${String(binding.renodeBackend.type)}.`,
          componentId: binding.componentId,
          devicePackageKind: binding.devicePackageKind,
        });
    }
  });

  const emittedReplFragmentCount = replFragments.filter((fragment) => fragment.status === 'emitted').length;
  return {
    schemaVersion: DEVICE_PACKAGE_RENODE_BACKEND_COMPILER_SCHEMA_VERSION,
    generatedFor: {
      boardId: options.board.id,
      boardName: options.board.name,
      renodePlatformPath: options.board.runtime.renodePlatformPath,
    },
    boardRepl: createBoardRepl({ board: options.board, fragments: replFragments, gpioMappings }),
    replFragments,
    signalBackends,
    nativePeripheralBackends,
    busBrokerBackends,
    virtualInstrumentBackends,
    diagnostics,
    summary: {
      componentCount: options.devicePackageManifest.length,
      signalBrokerCount: signalBackends.length,
      nativePeripheralCount: nativePeripheralBackends.length,
      busTransactionBrokerCount: busBrokerBackends.length,
      virtualInstrumentCount: virtualInstrumentBackends.length,
      emittedReplFragmentCount,
      diagnosticCount: diagnostics.length,
    },
  };
}
