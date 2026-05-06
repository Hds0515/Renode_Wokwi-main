/**
 * Circuit Netlist / IR compiler.
 *
 * The UI stores a wiring model that is convenient for dragging parts around.
 * This module converts that visual wiring into a schema-versioned netlist,
 * validates it, round-trips it for saved projects, and compiles it into Renode
 * artifacts such as C source, board.repl, run.resc preview, and manifests.
 */
import { BoardSchema } from './boards';
import {
  COMPONENT_PACKAGE_CATALOG_VERSION,
  COMPONENT_PACKAGE_SCHEMA_VERSION,
} from './component-packs';
import {
  DEFAULT_BRIDGE_PORT,
  DEFAULT_GDB_PORT,
  DemoBoardPad,
  DemoPadCapability,
  DemoPinFunctionKind,
  DemoPinFunctionMux,
  DemoPeripheral,
  DemoPeripheralKind,
  DemoPeripheralManifestEntry,
  DemoPeripheralTemplateKind,
  DemoWiring,
  DemoWiringRuleIssue,
  buildPeripheralManifest,
  buildWorkbenchDevices,
  createDefaultPeripheralBehavior,
  generateDemoMainSource,
  generateRescPreview,
  getPadCapabilities,
  getPeripheralEndpointDefinition,
  getPeripheralTemplateKind,
  getWorkbenchDeviceId,
  isDemoPeripheralTemplateKind,
  resolvePinFunctionForEndpoint,
  synchronizeWiringWires,
  validateWiringRules,
} from './firmware';
import {
  DEVICE_PACKAGE_CATALOG_VERSION,
  DEVICE_PACKAGE_SCHEMA_VERSION,
  DevicePackage,
  DevicePackageKind,
  DevicePackagePin,
  DevicePackageProtocol,
  DevicePackageRenodeBackend,
  findDevicePackage,
  getDevicePackageForTemplate,
} from './device-packages';
import { compileDevicePackageRenodeBackends } from './device-package-renode-backend-compiler';
import type { DevicePackageRenodeBackendCompilerArtifacts } from './device-package-renode-backend-compiler';

export const NETLIST_SCHEMA_VERSION = 1;

export type CircuitComponentKind = 'board' | DevicePackageKind | string;
export type CircuitPinDirection = 'input' | 'output' | 'bidirectional';
export type CircuitPinRole =
  | 'board-pad'
  | 'component-gpio'
  | 'component-i2c'
  | 'component-spi'
  | 'component-uart'
  | 'component-virtual';
export type CircuitNetKind = 'gpio' | 'i2c' | 'spi' | 'uart' | 'virtual';

export type CircuitBoardTarget = {
  id: string;
  name: string;
  family: BoardSchema['family'];
  renodePlatformPath: string;
};

export type CircuitComponentPin = {
  id: string;
  label: string;
  role: CircuitPinRole;
  direction: CircuitPinDirection;
  requiredPadCapabilities: readonly DemoPadCapability[];
  capabilities: readonly DemoPadCapability[];
  netKind?: CircuitNetKind | null;
  protocols?: readonly DevicePackageProtocol[];
  devicePackageKind?: string | null;
  devicePackagePinRole?: string | null;
  renodeBackendType?: string | null;
  endpointId?: string | null;
  padId?: string | null;
  mcuPinId?: string | null;
  selectable?: boolean;
  accentColor?: string | null;
  mux?: DemoPinFunctionMux;
};

export type CircuitComponentInstance = {
  id: string;
  kind: CircuitComponentKind;
  devicePackageKind?: DevicePackageKind | string;
  label: string;
  packageVersion?: number;
  devicePackageVersion?: number;
  pins: CircuitComponentPin[];
  properties?: Record<string, unknown>;
  metadata?: {
    legacyPeripherals?: DemoPeripheral[];
    sourceBindings?: Record<string, string | null>;
    devicePackage?: {
      schemaVersion: typeof DEVICE_PACKAGE_SCHEMA_VERSION;
      catalogVersion: typeof DEVICE_PACKAGE_CATALOG_VERSION;
      kind: string;
      title: string;
      version: string;
      compilerSource: DevicePackage['compiler']['source'];
      protocol: DevicePackage['protocol'];
      renodeBackend: DevicePackageRenodeBackend;
      runtimePanels: readonly string[];
      eventParsers: readonly string[];
    };
  };
};

export type CircuitPinReference = {
  componentId: string;
  pinId: string;
  role: CircuitPinRole;
  peripheralId?: string;
  endpointId?: string | null;
  padId?: string | null;
  pinFunctionId?: string | null;
  pinFunctionKind?: DemoPinFunctionKind | null;
};

export type CircuitNet = {
  id: string;
  kind: CircuitNetKind;
  label: string;
  connections: CircuitPinReference[];
  metadata?: {
    boardId: string;
    peripheralId: string;
    endpointId: string | null;
    padId: string;
    mcuPinId: string | null;
    pinFunctionId?: string | null;
    pinFunctionKind?: DemoPinFunctionKind | null;
    busId?: string | null;
    devicePackageKind?: string | null;
    devicePackagePinId?: string | null;
    protocol?: DevicePackageProtocol | null;
    protocols?: readonly DevicePackageProtocol[];
    renodeBackendType?: DevicePackageRenodeBackend['type'] | null;
    renodeBackendModel?: string | null;
  };
};

export type CircuitNetlist = {
  schemaVersion: typeof NETLIST_SCHEMA_VERSION;
  board: CircuitBoardTarget;
  componentPackages: {
    schemaVersion: typeof COMPONENT_PACKAGE_SCHEMA_VERSION;
    catalogVersion: typeof COMPONENT_PACKAGE_CATALOG_VERSION;
  };
  devicePackages: {
    schemaVersion: typeof DEVICE_PACKAGE_SCHEMA_VERSION;
    catalogVersion: typeof DEVICE_PACKAGE_CATALOG_VERSION;
  };
  components: CircuitComponentInstance[];
  nets: CircuitNet[];
  metadata: {
    generatedAt: string;
    generator: 'demo-wiring-v1';
    sourceSchema: 'DemoWiring';
  };
};

export type CircuitNetlistIssue = {
  id: string;
  severity: 'error' | 'warning';
  code:
    | 'schema-version'
    | 'board-mismatch'
    | 'missing-board-component'
    | 'unknown-component'
    | 'unknown-component-package'
    | 'unknown-pin'
    | 'unknown-board-pad'
    | 'pad-unavailable'
    | 'pad-shared'
    | 'capability-mismatch'
    | `wiring-${DemoWiringRuleIssue['code']}`;
  message: string;
  componentId?: string;
  pinId?: string;
  netId?: string;
  padId?: string;
  capability?: DemoPadCapability;
};

export type NetlistSummary = {
  componentCount: number;
  packageComponentCount: number;
  netCount: number;
  connectionCount: number;
};

export type NetlistRenodeArtifacts = {
  wiring: DemoWiring;
  mainSource: string;
  boardRepl: string;
  peripheralManifest: DemoPeripheralManifestEntry[];
  devicePackageManifest: NetlistRenodeDevicePackageBinding[];
  renodeBackendArtifacts: DevicePackageRenodeBackendCompilerArtifacts;
  rescPreview: string;
};

export type NetlistRenodeDevicePackageBinding = {
  schemaVersion: typeof NETLIST_SCHEMA_VERSION;
  componentId: string;
  label: string;
  devicePackageKind: string;
  devicePackageSchemaVersion: number;
  protocol: DevicePackage['protocol'];
  renodeBackend: DevicePackageRenodeBackend;
  pins: Array<{
    pinId: string;
    pinLabel: string;
    pinRole: string | null;
    direction: CircuitPinDirection | null;
    netKind: CircuitNetKind | null;
    protocols: readonly DevicePackageProtocol[];
    netId: string | null;
    peripheralId: string | null;
    padId: string | null;
    mcuPinId: string | null;
    busId: string | null;
  }>;
};

function getBoardPads(board: BoardSchema): DemoBoardPad[] {
  return board.connectors.all.flatMap((connector) => connector.pins);
}

function clonePeripheral(peripheral: DemoPeripheral): DemoPeripheral {
  const templateKind = getPeripheralTemplateKind(peripheral);
  return {
    ...peripheral,
    behavior: peripheral.behavior ?? createDefaultPeripheralBehavior(templateKind),
    power: undefined,
  };
}

function getDevicePackageForComponentKind(kind: CircuitComponentKind | string | null | undefined): DevicePackage | null {
  if (kind === 'board') {
    return null;
  }
  const directPackage = findDevicePackage(kind);
  if (directPackage) {
    return directPackage;
  }
  return isDemoPeripheralTemplateKind(kind) ? getDevicePackageForTemplate(kind) : null;
}

function getDevicePackageForNetlistComponent(component: CircuitComponentInstance): DevicePackage | null {
  return (
    getDevicePackageForComponentKind(component.metadata?.devicePackage?.kind) ??
    getDevicePackageForComponentKind(component.devicePackageKind) ??
    getDevicePackageForComponentKind(component.kind)
  );
}

export function getNetlistComponentDevicePackageKind(component: CircuitComponentInstance): string | null {
  return getDevicePackageForNetlistComponent(component)?.kind ?? component.metadata?.devicePackage?.kind ?? component.devicePackageKind ?? null;
}

function getCircuitPinRoleForDevicePin(pin: DevicePackagePin): CircuitPinRole {
  if (pin.netKind === 'i2c' || pin.role === 'i2c-scl' || pin.role === 'i2c-sda') {
    return 'component-i2c';
  }
  if (pin.netKind === 'spi' || pin.role.startsWith('spi-')) {
    return 'component-spi';
  }
  if (pin.netKind === 'uart' || pin.role.startsWith('uart-')) {
    return 'component-uart';
  }
  if (pin.netKind === 'virtual' || pin.role === 'virtual-terminal') {
    return 'component-virtual';
  }
  return 'component-gpio';
}

function getCircuitNetKindForDevicePin(pin: DevicePackagePin): CircuitNetKind {
  return pin.netKind === 'power' || pin.netKind === 'ground' ? 'virtual' : pin.netKind;
}

function isComponentPinRole(role: CircuitPinRole): boolean {
  return role !== 'board-pad';
}

function getEndpointKindForDevicePin(devicePackage: DevicePackage, pin: DevicePackagePin): DemoPeripheralKind {
  if (pin.netKind === 'i2c' || pin.protocols.includes('i2c')) {
    return 'i2c';
  }
  if (devicePackage.category === 'input') {
    return 'button';
  }
  return 'led';
}

function getLegacyTemplateKindForDevicePackage(devicePackage: DevicePackage): DemoPeripheralTemplateKind | null {
  if (isDemoPeripheralTemplateKind(devicePackage.legacy.componentPackageKind)) {
    return devicePackage.legacy.componentPackageKind;
  }
  return isDemoPeripheralTemplateKind(devicePackage.kind) ? devicePackage.kind : null;
}

function getDevicePackageMetadata(devicePackage: DevicePackage): NonNullable<CircuitComponentInstance['metadata']>['devicePackage'] {
  return {
    schemaVersion: DEVICE_PACKAGE_SCHEMA_VERSION,
    catalogVersion: DEVICE_PACKAGE_CATALOG_VERSION,
    kind: devicePackage.kind,
    title: devicePackage.title,
    version: devicePackage.version,
    compilerSource: devicePackage.compiler.source,
    protocol: devicePackage.protocol,
    renodeBackend: devicePackage.renodeBackend,
    runtimePanels: [...devicePackage.runtimePanel.controls, ...devicePackage.runtimePanel.visualizers],
    eventParsers: devicePackage.runtimePanel.eventParsers,
  };
}

function createBoardComponent(board: BoardSchema, exposedPadIds: ReadonlySet<string>): CircuitComponentInstance {
  return {
    id: `board:${board.id}`,
    kind: 'board',
    label: board.name,
    pins: getBoardPads(board)
      .filter((pad) => exposedPadIds.has(pad.id))
      .map((pad) => ({
        id: pad.id,
        label: pad.pinLabel,
        role: 'board-pad',
        direction: 'bidirectional',
        requiredPadCapabilities: [],
        capabilities: pad.capabilities,
        padId: pad.id,
        mcuPinId: pad.mcuPinId,
        selectable: pad.selectable,
        accentColor: null,
        mux: pad.mux,
      })),
    properties: {
      renodePlatformPath: board.renodePlatformPath,
      machineName: board.machineName,
    },
  };
}

function findMemberForPackagePin(members: readonly DemoPeripheral[], pin: DevicePackagePin): DemoPeripheral | null {
  return (
    members.find((member) => (member.endpointId ?? 'signal') === pin.id) ??
    members.find(
      (member) => member.kind === getEndpointKindForDevicePin(getDevicePackageForTemplate(getPeripheralTemplateKind(member)), pin)
    ) ??
    members[0] ??
    null
  );
}

function createComponentInstanceFromDevice(device: ReturnType<typeof buildWorkbenchDevices>[number]): CircuitComponentInstance {
  const devicePackage = getDevicePackageForTemplate(device.templateKind);
  const sourceBindings: Record<string, string | null> = {};

  const signalPins = devicePackage.pins
    .filter((pin) => pin.terminal.connectable)
    .map((pin): CircuitComponentPin => {
      const member = findMemberForPackagePin(device.members, pin);
      if (member) {
        sourceBindings[pin.id] = member.sourcePeripheralId ?? null;
      }

      return {
        id: pin.id,
        label: pin.label,
        role: getCircuitPinRoleForDevicePin(pin),
        direction: pin.direction,
        requiredPadCapabilities: pin.requiredPadCapabilities,
        capabilities: [],
        netKind: getCircuitNetKindForDevicePin(pin),
        protocols: pin.protocols,
        devicePackageKind: devicePackage.kind,
        devicePackagePinRole: pin.role,
        renodeBackendType: devicePackage.renodeBackend.type,
        endpointId: pin.id,
        padId: member?.padId ?? null,
        mcuPinId: null,
        selectable: true,
        accentColor: devicePackage.visual.accentColor,
      };
    });

  return {
    id: device.id,
    kind: devicePackage.kind,
    devicePackageKind: devicePackage.kind,
    label: device.label,
    packageVersion: COMPONENT_PACKAGE_CATALOG_VERSION,
    devicePackageVersion: DEVICE_PACKAGE_CATALOG_VERSION,
    pins: signalPins,
    properties: {
      category: devicePackage.category,
      pinCount: signalPins.length,
      powerRequired: false,
    },
    metadata: {
      legacyPeripherals: device.members.map((member) => clonePeripheral(member)),
      sourceBindings,
      devicePackage: getDevicePackageMetadata(devicePackage),
    },
  };
}

/**
 * Converts the drag-and-drop wiring model into the canonical project IR.
 *
 * Read this first when studying how visual operations become something Renode
 * can consume. The function creates board/component nodes, GPIO/I2C signal nets,
 * and metadata that later generators use for .repl, firmware, and manifests.
 */
export function createNetlistFromWiring(wiring: DemoWiring, board: BoardSchema): CircuitNetlist {
  // UI wiring can contain stale derived wires after drag/delete operations.
  // Normalize first so every downstream compiler sees one canonical graph.
  const normalizedWiring = synchronizeWiringWires(wiring);
  const padById = new Map(getBoardPads(board).map((pad) => [pad.id, pad]));
  const exposedPadIds = new Set(
    normalizedWiring.peripherals
      .map((peripheral) => peripheral.padId)
      .filter((padId): padId is string => Boolean(padId))
  );
  const components = [
    createBoardComponent(board, exposedPadIds),
    ...buildWorkbenchDevices(normalizedWiring).map((device) => createComponentInstanceFromDevice(device)),
  ];

  const signalNets = normalizedWiring.peripherals
    .filter((peripheral) => Boolean(peripheral.padId))
    .map((peripheral): CircuitNet => {
      const endpointId = peripheral.endpointId ?? 'signal';
      const padId = peripheral.padId!;
      const pad = padById.get(padId) ?? null;
      const componentId = getWorkbenchDeviceId(peripheral);
      const endpoint = getPeripheralEndpointDefinition(peripheral);
      const devicePackage = getDevicePackageForTemplate(getPeripheralTemplateKind(peripheral));
      const devicePackagePin =
        devicePackage.pins.find((pin) => pin.id === endpointId) ??
        devicePackage.pins.find((pin) => pin.terminal.connectable) ??
        null;
      const componentRole = devicePackagePin ? getCircuitPinRoleForDevicePin(devicePackagePin) : peripheral.kind === 'i2c' ? 'component-i2c' : 'component-gpio';
      const netKind = devicePackagePin ? getCircuitNetKindForDevicePin(devicePackagePin) : peripheral.kind === 'i2c' ? 'i2c' : 'gpio';
      const pinFunction = pad ? resolvePinFunctionForEndpoint(pad, endpoint) : null;

      return {
        // One routed endpoint becomes one logical net. Multi-endpoint devices
        // such as RGB LEDs, OLEDs, and sensors therefore produce multiple nets.
        id: `net:${peripheral.id}:${endpointId}`,
        kind: netKind,
        label: `${peripheral.label} ${peripheral.endpointLabel ?? endpointId}`,
        connections: [
          {
            componentId,
            pinId: endpointId,
            role: componentRole,
            peripheralId: peripheral.id,
            endpointId,
          },
          {
            componentId: `board:${board.id}`,
            pinId: padId,
            role: 'board-pad',
            padId,
            pinFunctionId: pinFunction?.id ?? null,
            pinFunctionKind: pinFunction?.kind ?? null,
          },
        ],
        metadata: {
          boardId: board.id,
          peripheralId: peripheral.id,
          endpointId,
          padId,
          mcuPinId: pad?.mcuPinId ?? null,
          pinFunctionId: pinFunction?.id ?? null,
          pinFunctionKind: pinFunction?.kind ?? null,
          busId: pinFunction?.bus.id ?? null,
          devicePackageKind: devicePackage.kind,
          devicePackagePinId: devicePackagePin?.id ?? endpointId,
          protocol: devicePackagePin?.protocols[0] ?? devicePackage.protocol.primary,
          protocols: devicePackagePin?.protocols ?? devicePackage.protocol.buses,
          renodeBackendType: devicePackage.renodeBackend.type,
          renodeBackendModel: devicePackage.renodeBackend.model,
        },
      };
    });
  const nets = signalNets;

  return {
    schemaVersion: NETLIST_SCHEMA_VERSION,
    board: {
      id: board.id,
      name: board.name,
      family: board.family,
      renodePlatformPath: board.renodePlatformPath,
    },
    componentPackages: {
      schemaVersion: COMPONENT_PACKAGE_SCHEMA_VERSION,
      catalogVersion: COMPONENT_PACKAGE_CATALOG_VERSION,
    },
    devicePackages: {
      schemaVersion: DEVICE_PACKAGE_SCHEMA_VERSION,
      catalogVersion: DEVICE_PACKAGE_CATALOG_VERSION,
    },
    components,
    nets,
    metadata: {
      generatedAt: new Date().toISOString(),
      generator: 'demo-wiring-v1',
      sourceSchema: 'DemoWiring',
    },
  };
}

export function createWiringFromNetlist(netlist: CircuitNetlist): DemoWiring {
  const peripherals: DemoPeripheral[] = [];
  const peripheralById = new Map<string, DemoPeripheral>();

  netlist.components
    .filter((component) => component.kind !== 'board')
    .forEach((component) => {
      const legacyPeripherals = component.metadata?.legacyPeripherals ?? [];
      legacyPeripherals.forEach((peripheral) => {
        const cloned = clonePeripheral(peripheral);
        cloned.padId = null;
        peripherals.push(cloned);
        peripheralById.set(cloned.id, cloned);
      });

      const devicePackage = getDevicePackageForNetlistComponent(component);
      const templateKind = devicePackage ? getLegacyTemplateKindForDevicePackage(devicePackage) : null;
      if (legacyPeripherals.length === 0 && devicePackage && templateKind) {
        const connectablePins = devicePackage.pins.filter((pin) => pin.terminal.connectable);
        connectablePins.forEach((pin, index) => {
          const behavior = createDefaultPeripheralBehavior(templateKind);
          const peripheral: DemoPeripheral = {
            id: connectablePins.length === 1 ? component.id : `${component.id}-${pin.id}`,
            kind: getEndpointKindForDevicePin(devicePackage, pin),
            label: component.label,
            padId: null,
            sourcePeripheralId: null,
            behavior: {
              ...behavior,
              controller: behavior.controller ? { ...behavior.controller } : null,
              powerRequired: false,
            },
            power: undefined,
            templateKind,
            groupId: connectablePins.length === 1 ? null : component.id,
            groupLabel: connectablePins.length === 1 ? null : component.label,
            endpointId: pin.id,
            endpointLabel: pin.label,
            accentColor: devicePackage.visual.accentColor,
          };
          if (peripheralById.has(peripheral.id)) {
            peripheral.id = `${peripheral.id}-${index + 1}`;
          }
          peripherals.push(peripheral);
          peripheralById.set(peripheral.id, peripheral);
        });
      }
    });

  netlist.nets.forEach((net) => {
    const componentConnection = net.connections.find(
      (connection) => isComponentPinRole(connection.role)
    );
    const peripheralId = net.metadata?.peripheralId ?? componentConnection?.peripheralId ?? null;
    const padId =
      net.metadata?.padId ??
      net.connections.find((connection) => connection.role === 'board-pad')?.padId ??
      null;

    if (!peripheralId || !padId) {
      return;
    }

    const peripheral = peripheralById.get(peripheralId);
    if (peripheral) {
      peripheral.padId = padId;
    }
  });

  return synchronizeWiringWires({ peripherals });
}

function pushIssue(issues: CircuitNetlistIssue[], issue: CircuitNetlistIssue) {
  if (!issues.some((current) => current.id === issue.id)) {
    issues.push(issue);
  }
}

export function validateNetlist(netlist: CircuitNetlist, board: BoardSchema): CircuitNetlistIssue[] {
  const issues: CircuitNetlistIssue[] = [];
  const boardComponentId = `board:${board.id}`;
  const boardPads = getBoardPads(board);
  const padById = new Map(boardPads.map((pad) => [pad.id, pad]));
  const componentById = new Map(netlist.components.map((component) => [component.id, component]));

  if (netlist.schemaVersion !== NETLIST_SCHEMA_VERSION) {
    pushIssue(issues, {
      id: 'schema-version',
      severity: 'warning',
      code: 'schema-version',
      message: `Netlist schema v${netlist.schemaVersion} is loaded by a v${NETLIST_SCHEMA_VERSION} compiler.`,
    });
  }

  if (netlist.board.id !== board.id) {
    pushIssue(issues, {
      id: `board-mismatch:${netlist.board.id}:${board.id}`,
      severity: 'error',
      code: 'board-mismatch',
      message: `Netlist targets ${netlist.board.name}, but the active board is ${board.name}.`,
    });
  }

  if (!componentById.has(boardComponentId)) {
    pushIssue(issues, {
      id: `missing-board-component:${boardComponentId}`,
      severity: 'error',
      code: 'missing-board-component',
      componentId: boardComponentId,
      message: `Netlist is missing the board component "${boardComponentId}".`,
    });
  }

  netlist.components.forEach((component) => {
    if (component.kind === 'board') {
      return;
    }
    const devicePackage = getDevicePackageForNetlistComponent(component);
    if (!devicePackage) {
      pushIssue(issues, {
        id: `unknown-component-package:${component.id}:${component.kind}`,
        severity: 'error',
        code: 'unknown-component-package',
        componentId: component.id,
        message: `${component.label} references unknown device package "${component.kind}".`,
      });
      return;
    }

    devicePackage.pins
      .filter((pin) => pin.terminal.connectable)
      .forEach((pin) => {
        if (!component.pins.some((componentPin) => componentPin.id === pin.id)) {
          pushIssue(issues, {
            id: `unknown-pin:${component.id}:${pin.id}`,
            severity: 'error',
            code: 'unknown-pin',
            componentId: component.id,
            pinId: pin.id,
            message: `${component.label} is missing package pin "${pin.id}".`,
          });
        }
      });
  });

  const padNetIds = new Map<string, string>();
  netlist.nets.forEach((net) => {
    net.connections.forEach((connection) => {
      const component = componentById.get(connection.componentId);
      if (!component) {
        pushIssue(issues, {
          id: `unknown-component:${net.id}:${connection.componentId}`,
          severity: 'error',
          code: 'unknown-component',
          componentId: connection.componentId,
          netId: net.id,
          message: `Net "${net.label}" references missing component "${connection.componentId}".`,
        });
        return;
      }

      if (!component.pins.some((pin) => pin.id === connection.pinId)) {
        pushIssue(issues, {
          id: `unknown-pin:${net.id}:${connection.componentId}:${connection.pinId}`,
          severity: 'error',
          code: 'unknown-pin',
          componentId: connection.componentId,
          pinId: connection.pinId,
          netId: net.id,
          message: `Net "${net.label}" references missing pin "${connection.pinId}" on ${component.label}.`,
        });
      }
    });

    const boardConnection = net.connections.find((connection) => connection.role === 'board-pad');
    const componentConnection = net.connections.find((connection) => isComponentPinRole(connection.role));

    if (!boardConnection || !componentConnection) {
      return;
    }

    const padId = boardConnection.padId ?? boardConnection.pinId;
    const pad = padById.get(padId);
    if (!pad) {
      pushIssue(issues, {
        id: `unknown-board-pad:${net.id}:${padId}`,
        severity: 'error',
        code: 'unknown-board-pad',
        netId: net.id,
        padId,
        message: `Net "${net.label}" targets unknown board pad "${padId}".`,
      });
      return;
    }

    if (!pad.selectable) {
      pushIssue(issues, {
        id: `pad-unavailable:${net.id}:${padId}`,
        severity: 'error',
        code: 'pad-unavailable',
        netId: net.id,
        padId,
        message: `Net "${net.label}" targets unavailable board pad "${pad.pinLabel}".`,
      });
    }

    const previousNetId = padNetIds.get(padId);
    if (previousNetId && previousNetId !== net.id) {
      pushIssue(issues, {
        id: `pad-shared:${padId}`,
        severity: 'error',
        code: 'pad-shared',
        netId: net.id,
        padId,
        message: `Board pad "${pad.pinLabel}" is driven by multiple nets.`,
      });
    }
    padNetIds.set(padId, net.id);

    const component = componentById.get(componentConnection.componentId);
    if (!component || component.kind === 'board') {
      return;
    }

    const devicePackage = getDevicePackageForNetlistComponent(component);
    const packagePin = devicePackage?.pins.find((pin) => pin.id === componentConnection.pinId) ?? null;
    if (!packagePin) {
      pushIssue(issues, {
        id: `unknown-pin:${component.id}:${componentConnection.pinId}`,
        severity: 'error',
        code: 'unknown-pin',
        componentId: component.id,
        pinId: componentConnection.pinId,
        netId: net.id,
        message: `${component.label} device package ${component.kind} does not expose pin "${componentConnection.pinId}".`,
      });
      return;
    }

    packagePin.requiredPadCapabilities.forEach((capability) => {
      if (!pad.capabilities.includes(capability)) {
        pushIssue(issues, {
          id: `capability-mismatch:${net.id}:${padId}:${capability}`,
          severity: 'error',
          code: 'capability-mismatch',
          componentId: component.id,
          pinId: componentConnection.pinId,
          netId: net.id,
          padId,
          capability,
          message: `${component.label} ${packagePin.label} requires ${capability}, but ${pad.pinLabel} does not provide it.`,
        });
      }
    });
  });

  validateWiringRules(createWiringFromNetlist(netlist), boardPads).forEach((issue) => {
    pushIssue(issues, {
      id: `wiring:${issue.id}`,
      severity: issue.severity,
      code: `wiring-${issue.code}`,
      message: issue.message,
      componentId: issue.peripheralId ? getWorkbenchDeviceId({ id: issue.peripheralId } as DemoPeripheral) : undefined,
      pinId: issue.endpointId ?? undefined,
      padId: issue.padId,
      capability: issue.capability,
    });
  });

  return issues;
}

export function summarizeNetlist(netlist: CircuitNetlist): NetlistSummary {
  return {
    componentCount: netlist.components.length,
    packageComponentCount: netlist.components.filter((component) => component.kind !== 'board').length,
    netCount: netlist.nets.length,
    connectionCount: netlist.nets.reduce((total, net) => total + net.connections.length, 0),
  };
}

export function createRenodeDevicePackageManifest(netlist: CircuitNetlist): NetlistRenodeDevicePackageBinding[] {
  // This manifest is the package-native handoff from Netlist to Renode-facing
  // tooling. Current .repl generation still uses legacy wiring for compatibility,
  // but new brokers/plugins can consume this structure without knowing old
  // button/led/i2c template names.
  return netlist.components
    .filter((component) => component.kind !== 'board')
    .flatMap((component): NetlistRenodeDevicePackageBinding[] => {
      const devicePackage = getDevicePackageForNetlistComponent(component);
      if (!devicePackage) {
        return [];
      }

      return [
        {
          schemaVersion: NETLIST_SCHEMA_VERSION,
          componentId: component.id,
          label: component.label,
          devicePackageKind: devicePackage.kind,
          devicePackageSchemaVersion: devicePackage.schemaVersion,
          protocol: devicePackage.protocol,
          renodeBackend: devicePackage.renodeBackend,
          pins: component.pins
            .filter((pin) => pin.role !== 'board-pad')
            .map((pin) => {
              const net =
                netlist.nets.find((candidate) =>
                  candidate.connections.some((connection) => connection.componentId === component.id && connection.pinId === pin.id)
                ) ?? null;
              const componentConnection =
                net?.connections.find((connection) => connection.componentId === component.id && connection.pinId === pin.id) ?? null;
              return {
                pinId: pin.id,
                pinLabel: pin.label,
                pinRole: pin.devicePackagePinRole ?? null,
                direction: pin.direction ?? null,
                netKind: pin.netKind ?? net?.kind ?? null,
                protocols: pin.protocols ?? net?.metadata?.protocols ?? [],
                netId: net?.id ?? null,
                peripheralId: componentConnection?.peripheralId ?? net?.metadata?.peripheralId ?? null,
                padId: net?.metadata?.padId ?? null,
                mcuPinId: net?.metadata?.mcuPinId ?? null,
                busId: net?.metadata?.busId ?? null,
              };
            }),
        },
      ];
    });
}

/**
 * Compiles the canonical Netlist/IR into all generated runtime artifacts.
 *
 * This is the boundary between editor data and simulation data: generated C
 * source, board.repl, peripheral manifest, and run.resc preview all originate
 * here. Electron later writes these strings to a temporary workspace.
 */
export function compileNetlistToRenodeArtifacts(options: {
  netlist: CircuitNetlist;
  board: BoardSchema;
  elfPath?: string | null;
  gdbPort?: number;
  bridgePort?: number;
  uartPort?: number | null;
}): NetlistRenodeArtifacts {
  // Renode artifact generation still consumes the legacy wiring shape because
  // firmware.ts owns board-specific C/.repl generation today. Keeping the
  // conversion here isolates that compatibility layer from the rest of the app.
  const boardPads = getBoardPads(options.board);
  const wiring = createWiringFromNetlist(options.netlist);
  const devicePackageManifest = createRenodeDevicePackageManifest(options.netlist);
  const renodeBackendArtifacts = compileDevicePackageRenodeBackends({
    board: options.board,
    devicePackageManifest,
  });

  return {
    wiring,
    mainSource: generateDemoMainSource(wiring, options.board.runtime, boardPads),
    boardRepl: renodeBackendArtifacts.boardRepl,
    peripheralManifest: buildPeripheralManifest(wiring, options.board.runtime, boardPads),
    devicePackageManifest,
    renodeBackendArtifacts,
    rescPreview: generateRescPreview({
      elfPath: options.elfPath ?? null,
      gdbPort: options.gdbPort ?? DEFAULT_GDB_PORT,
      bridgePort: options.bridgePort ?? DEFAULT_BRIDGE_PORT,
      machineName: options.board.machineName,
      uartPeripheralName: options.board.runtime.uart?.peripheralName ?? null,
      uartPort: options.uartPort ?? null,
    }),
  };
}
