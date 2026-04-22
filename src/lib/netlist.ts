import { BoardSchema } from './boards';
import {
  COMPONENT_PACKAGE_CATALOG_VERSION,
  COMPONENT_PACKAGE_SCHEMA_VERSION,
  ComponentPackagePin,
  getComponentPackage,
  getComponentPackagePin,
} from './component-packs';
import {
  DEFAULT_BRIDGE_PORT,
  DEFAULT_GDB_PORT,
  DemoBoardPad,
  DemoPadCapability,
  DemoPeripheral,
  DemoPeripheralManifestEntry,
  DemoPeripheralTemplateKind,
  DemoWiring,
  DemoWiringRuleIssue,
  buildPeripheralManifest,
  buildWorkbenchDevices,
  createDefaultPeripheralBehavior,
  generateBoardRepl,
  generateDemoMainSource,
  generateRescPreview,
  getPadCapabilities,
  getPeripheralPowerBinding,
  getPeripheralTemplateKind,
  getWorkbenchDeviceId,
  isDemoPeripheralTemplateKind,
  synchronizeWiringWires,
  validateWiringRules,
} from './firmware';

export const NETLIST_SCHEMA_VERSION = 1;

export type CircuitComponentKind = 'board' | DemoPeripheralTemplateKind;
export type CircuitPinDirection = 'input' | 'output' | 'bidirectional';
export type CircuitPinRole = 'board-pad' | 'board-power' | 'board-ground' | 'component-gpio' | 'component-i2c' | 'component-power';
export type CircuitNetKind = 'gpio' | 'i2c' | 'power' | 'ground';

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
  endpointId?: string | null;
  padId?: string | null;
  mcuPinId?: string | null;
  selectable?: boolean;
  accentColor?: string | null;
};

export type CircuitComponentInstance = {
  id: string;
  kind: CircuitComponentKind;
  label: string;
  packageVersion?: number;
  pins: CircuitComponentPin[];
  properties?: Record<string, unknown>;
  metadata?: {
    legacyPeripherals?: DemoPeripheral[];
    sourceBindings?: Record<string, string | null>;
  };
};

export type CircuitPinReference = {
  componentId: string;
  pinId: string;
  role: CircuitPinRole;
  peripheralId?: string;
  endpointId?: string | null;
  padId?: string | null;
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
  };
};

export type CircuitNetlist = {
  schemaVersion: typeof NETLIST_SCHEMA_VERSION;
  board: CircuitBoardTarget;
  componentPackages: {
    schemaVersion: typeof COMPONENT_PACKAGE_SCHEMA_VERSION;
    catalogVersion: typeof COMPONENT_PACKAGE_CATALOG_VERSION;
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
  rescPreview: string;
};

function getBoardPads(board: BoardSchema): DemoBoardPad[] {
  return board.connectors.all.flatMap((connector) => connector.pins);
}

function clonePeripheral(peripheral: DemoPeripheral): DemoPeripheral {
  const templateKind = getPeripheralTemplateKind(peripheral);
  return {
    ...peripheral,
    behavior: peripheral.behavior ?? createDefaultPeripheralBehavior(templateKind),
    power: peripheral.power ?? {
      schemaVersion: 1,
      vccPadId: null,
      gndPadId: null,
      voltage: null,
    },
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
        role: pad.role === 'power' ? 'board-power' : pad.role === 'ground' ? 'board-ground' : 'board-pad',
        direction: 'bidirectional',
        requiredPadCapabilities: [],
        capabilities: pad.capabilities,
        padId: pad.id,
        mcuPinId: pad.mcuPinId,
        selectable: pad.selectable,
        accentColor: null,
      })),
    properties: {
      renodePlatformPath: board.renodePlatformPath,
      machineName: board.machineName,
    },
  };
}

function findMemberForPackagePin(members: readonly DemoPeripheral[], pin: ComponentPackagePin): DemoPeripheral | null {
  return (
    members.find((member) => (member.endpointId ?? 'signal') === pin.id) ??
    members.find((member) => member.kind === pin.legacyPeripheralKind) ??
    members[0] ??
    null
  );
}

function createComponentInstanceFromDevice(device: ReturnType<typeof buildWorkbenchDevices>[number]): CircuitComponentInstance {
  const componentPackage = getComponentPackage(device.templateKind);
  const sourceBindings: Record<string, string | null> = {};
  const power = getPeripheralPowerBinding(device.members[0]);

  const signalPins = componentPackage.pins.map((pin): CircuitComponentPin => {
    const member = findMemberForPackagePin(device.members, pin);
    if (member) {
      sourceBindings[pin.id] = member.sourcePeripheralId ?? null;
    }

    return {
      id: pin.id,
      label: pin.label,
      role: pin.role === 'gpio-signal' ? 'component-gpio' : 'component-i2c',
      direction: pin.direction,
      requiredPadCapabilities: pin.requiredPadCapabilities,
      capabilities: [],
      endpointId: pin.id,
      padId: member?.padId ?? null,
      mcuPinId: null,
      selectable: true,
      accentColor: pin.accentColor,
    };
  });
  const powerPins = componentPackage.powerPins.map((pin): CircuitComponentPin => ({
    id: pin.id,
    label: pin.label,
    role: 'component-power',
    direction: 'bidirectional',
    requiredPadCapabilities: pin.requiredPadCapabilities,
    capabilities: [],
    endpointId: pin.id,
    padId: pin.id === 'vcc' ? power.vccPadId : power.gndPadId,
    mcuPinId: null,
    selectable: true,
    accentColor: pin.id === 'vcc' ? '#22c55e' : '#64748b',
  }));

  return {
    id: device.id,
    kind: device.templateKind,
    label: device.label,
    packageVersion: COMPONENT_PACKAGE_CATALOG_VERSION,
    pins: [...signalPins, ...powerPins],
    properties: {
      category: componentPackage.category,
      pinCount: componentPackage.pins.length,
      powerRequired: componentPackage.behavior.powerRequired,
    },
    metadata: {
      legacyPeripherals: device.members.map((member) => clonePeripheral(member)),
      sourceBindings,
    },
  };
}

export function createNetlistFromWiring(wiring: DemoWiring, board: BoardSchema): CircuitNetlist {
  const normalizedWiring = synchronizeWiringWires(wiring);
  const padById = new Map(getBoardPads(board).map((pad) => [pad.id, pad]));
  const exposedPadIds = new Set(
    normalizedWiring.peripherals.flatMap((peripheral) => {
      const power = getPeripheralPowerBinding(peripheral);
      return [peripheral.padId, power.vccPadId, power.gndPadId].filter((padId): padId is string => Boolean(padId));
    })
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

      return {
        id: `net:${peripheral.id}:${endpointId}`,
        kind: peripheral.kind === 'i2c' ? 'i2c' : 'gpio',
        label: `${peripheral.label} ${peripheral.endpointLabel ?? endpointId}`,
        connections: [
          {
            componentId,
            pinId: endpointId,
            role: peripheral.kind === 'i2c' ? 'component-i2c' : 'component-gpio',
            peripheralId: peripheral.id,
            endpointId,
          },
          {
            componentId: `board:${board.id}`,
            pinId: padId,
            role: 'board-pad',
            padId,
          },
        ],
        metadata: {
          boardId: board.id,
          peripheralId: peripheral.id,
          endpointId,
          padId,
          mcuPinId: pad?.mcuPinId ?? null,
        },
      };
    });
  const powerNets = buildWorkbenchDevices(normalizedWiring).flatMap((device): CircuitNet[] => {
    const power = getPeripheralPowerBinding(device.members[0]);
    const nets: CircuitNet[] = [];
    if (power.vccPadId) {
      const pad = padById.get(power.vccPadId) ?? null;
      nets.push({
        id: `net:${device.id}:vcc`,
        kind: 'power',
        label: `${device.label} VCC`,
        connections: [
          {
            componentId: device.id,
            pinId: 'vcc',
            role: 'component-power',
          },
          {
            componentId: `board:${board.id}`,
            pinId: power.vccPadId,
            role: 'board-power',
            padId: power.vccPadId,
          },
        ],
        metadata: {
          boardId: board.id,
          peripheralId: device.members[0].id,
          endpointId: 'vcc',
          padId: power.vccPadId,
          mcuPinId: pad?.mcuPinId ?? null,
        },
      });
    }
    if (power.gndPadId) {
      const pad = padById.get(power.gndPadId) ?? null;
      nets.push({
        id: `net:${device.id}:gnd`,
        kind: 'ground',
        label: `${device.label} GND`,
        connections: [
          {
            componentId: device.id,
            pinId: 'gnd',
            role: 'component-power',
          },
          {
            componentId: `board:${board.id}`,
            pinId: power.gndPadId,
            role: 'board-ground',
            padId: power.gndPadId,
          },
        ],
        metadata: {
          boardId: board.id,
          peripheralId: device.members[0].id,
          endpointId: 'gnd',
          padId: power.gndPadId,
          mcuPinId: pad?.mcuPinId ?? null,
        },
      });
    }
    return nets;
  });
  const nets = [...signalNets, ...powerNets];

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

      if (legacyPeripherals.length === 0 && isDemoPeripheralTemplateKind(component.kind)) {
        const templateKind = component.kind;
        const componentPackage = getComponentPackage(templateKind);
        componentPackage.pins.forEach((pin, index) => {
          const peripheral: DemoPeripheral = {
            id: componentPackage.pins.length === 1 ? component.id : `${component.id}-${pin.id}`,
            kind: pin.legacyPeripheralKind,
            label: component.label,
            padId: null,
            sourcePeripheralId: null,
            behavior: {
              ...componentPackage.behavior,
              controller: componentPackage.behavior.controller ? { ...componentPackage.behavior.controller } : null,
            },
            power: {
              ...componentPackage.defaultPower,
            },
            templateKind,
            groupId: componentPackage.pins.length === 1 ? null : component.id,
            groupLabel: componentPackage.pins.length === 1 ? null : component.label,
            endpointId: pin.id,
            endpointLabel: pin.label,
            accentColor: pin.accentColor,
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
    if (net.kind === 'power' || net.kind === 'ground') {
      const componentConnection = net.connections.find((connection) => connection.role === 'component-power');
      const padId =
        net.metadata?.padId ??
        net.connections.find((connection) => connection.role === 'board-power' || connection.role === 'board-ground')?.padId ??
        null;
      if (!componentConnection || !padId) {
        return;
      }

      peripherals
        .filter((peripheral) => getWorkbenchDeviceId(peripheral) === componentConnection.componentId)
        .forEach((peripheral) => {
          const currentPower = getPeripheralPowerBinding(peripheral);
          peripheral.power = {
            ...currentPower,
            vccPadId: net.kind === 'power' ? padId : currentPower.vccPadId,
            gndPadId: net.kind === 'ground' ? padId : currentPower.gndPadId,
            voltage: currentPower.voltage,
          };
        });
      return;
    }

    const componentConnection = net.connections.find(
      (connection) => connection.role === 'component-gpio' || connection.role === 'component-i2c'
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
    if (!isDemoPeripheralTemplateKind(component.kind)) {
      pushIssue(issues, {
        id: `unknown-component-package:${component.id}:${component.kind}`,
        severity: 'error',
        code: 'unknown-component-package',
        componentId: component.id,
        message: `${component.label} references unknown component package "${component.kind}".`,
      });
      return;
    }

    const componentPackage = getComponentPackage(component.kind);
    [...componentPackage.pins, ...componentPackage.powerPins].forEach((pin) => {
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
    const componentConnection = net.connections.find(
      (connection) => connection.role === 'component-gpio' || connection.role === 'component-i2c'
    );

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
    if (!component || component.kind === 'board' || !isDemoPeripheralTemplateKind(component.kind)) {
      return;
    }

    const packagePin = getComponentPackagePin(component.kind, componentConnection.pinId);
    if (!packagePin) {
      pushIssue(issues, {
        id: `unknown-pin:${component.id}:${componentConnection.pinId}`,
        severity: 'error',
        code: 'unknown-pin',
        componentId: component.id,
        pinId: componentConnection.pinId,
        netId: net.id,
        message: `${component.label} package ${component.kind} does not expose pin "${componentConnection.pinId}".`,
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

export function compileNetlistToRenodeArtifacts(options: {
  netlist: CircuitNetlist;
  board: BoardSchema;
  elfPath?: string | null;
  gdbPort?: number;
  bridgePort?: number;
  uartPort?: number | null;
}): NetlistRenodeArtifacts {
  const boardPads = getBoardPads(options.board);
  const wiring = createWiringFromNetlist(options.netlist);

  return {
    wiring,
    mainSource: generateDemoMainSource(wiring, options.board.runtime, boardPads),
    boardRepl: generateBoardRepl(wiring, options.board.runtime, boardPads),
    peripheralManifest: buildPeripheralManifest(wiring, options.board.runtime, boardPads),
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
