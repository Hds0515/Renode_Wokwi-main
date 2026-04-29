/**
 * Digital pin/protocol rule checker.
 *
 * Renode is not a SPICE simulator, and this project intentionally does not
 * validate VCC/GND/resistor correctness. These rules only cover digital
 * simulation semantics that affect Renode wiring: pin mux selection, endpoint
 * direction, output contention, and I2C pair/bus consistency.
 */
import { BoardSchema } from './boards';
import {
  DemoBoardPad,
  DemoEndpointDirection,
  DemoPeripheral,
  DemoPinFunctionDefinition,
  DemoPinFunctionMuxState,
  DemoWiring,
  buildWorkbenchDevices,
  createPinFunctionMuxState,
  describePad,
  getPeripheralEndpointDefinition,
  resolvePinFunctionForEndpoint,
} from './firmware';

export const ELECTRICAL_RULE_SCHEMA_VERSION = 1;

export type ElectricalRuleSeverity = 'error' | 'warning';
export type ElectricalRuleCode =
  | 'pin-function-missing'
  | 'pin-direction-conflict'
  | 'output-contention'
  | 'i2c-pair-incomplete'
  | 'i2c-bus-mismatch';

export type ElectricalRuleIssue = {
  id: string;
  severity: ElectricalRuleSeverity;
  code: ElectricalRuleCode;
  message: string;
  deviceId?: string;
  peripheralId?: string;
  endpointId?: string | null;
  padId?: string;
  functionId?: string | null;
};

export type ElectricalRuleReport = {
  schemaVersion: typeof ELECTRICAL_RULE_SCHEMA_VERSION;
  pinMux: DemoPinFunctionMuxState;
  issues: ElectricalRuleIssue[];
  summary: {
    checkedDeviceCount: number;
    checkedSignalCount: number;
    selectedFunctionCount: number;
    errorCount: number;
    warningCount: number;
  };
};

function getBoardPads(board: BoardSchema): DemoBoardPad[] {
  return board.connectors.all.flatMap((connector) => connector.pins);
}

function pushIssue(issues: ElectricalRuleIssue[], issue: ElectricalRuleIssue) {
  issues.push(issue);
}

function isOutputDirection(direction: DemoEndpointDirection): boolean {
  return direction === 'output';
}

function getSignalFunctionForPeripheral(
  peripheral: DemoPeripheral,
  padById: ReadonlyMap<string, DemoBoardPad>
): { pad: DemoBoardPad; pinFunction: DemoPinFunctionDefinition | null } | null {
  if (!peripheral.padId) {
    return null;
  }
  const pad = padById.get(peripheral.padId);
  if (!pad) {
    return null;
  }
  const endpoint = getPeripheralEndpointDefinition(peripheral);
  return {
    pad,
    pinFunction: resolvePinFunctionForEndpoint(pad, endpoint),
  };
}

function expectedDirectionMatches(endpointDirection: DemoEndpointDirection, pinFunction: DemoPinFunctionDefinition): boolean {
  if (endpointDirection === 'bidirectional') {
    return pinFunction.electrical.direction === 'bidirectional';
  }
  if (endpointDirection === 'output') {
    return pinFunction.electrical.direction === 'output' || pinFunction.electrical.direction === 'bidirectional';
  }
  return pinFunction.electrical.direction === 'input' || pinFunction.electrical.direction === 'bidirectional';
}

export function evaluateElectricalRules(wiring: DemoWiring, board: BoardSchema): ElectricalRuleReport {
  const boardPads = getBoardPads(board);
  const padById = new Map(boardPads.map((pad) => [pad.id, pad]));
  const issues: ElectricalRuleIssue[] = [];
  const pinMux = createPinFunctionMuxState(wiring, boardPads);
  const padUsers = new Map<string, DemoPeripheral[]>();

  wiring.peripherals.forEach((peripheral) => {
    if (!peripheral.padId) {
      return;
    }
    const users = padUsers.get(peripheral.padId) ?? [];
    users.push(peripheral);
    padUsers.set(peripheral.padId, users);
  });

  padUsers.forEach((users, padId) => {
    const outputUsers = users.filter((peripheral) => isOutputDirection(getPeripheralEndpointDefinition(peripheral).direction));
    if (outputUsers.length > 1) {
      pushIssue(issues, {
        id: `output-contention:${padId}`,
        severity: 'error',
        code: 'output-contention',
        padId,
        message: `${padById.get(padId) ? describePad(padById.get(padId)!) : padId} has multiple output drivers: ${outputUsers.map((item) => item.label).join(', ')}.`,
      });
    }
  });

  wiring.peripherals.forEach((peripheral) => {
    const endpoint = getPeripheralEndpointDefinition(peripheral);
    const resolved = getSignalFunctionForPeripheral(peripheral, padById);
    if (!resolved) {
      return;
    }

    if (!resolved.pinFunction) {
      pushIssue(issues, {
        id: `pin-function-missing:${peripheral.id}:${resolved.pad.id}`,
        severity: 'error',
        code: 'pin-function-missing',
        peripheralId: peripheral.id,
        endpointId: endpoint.id,
        padId: resolved.pad.id,
        message: `${peripheral.label} ${endpoint.label} cannot select a valid mux function on ${describePad(resolved.pad)}.`,
      });
      return;
    }

    if (!expectedDirectionMatches(endpoint.direction, resolved.pinFunction)) {
      pushIssue(issues, {
        id: `pin-direction-conflict:${peripheral.id}:${resolved.pad.id}:${resolved.pinFunction.id}`,
        severity: 'error',
        code: 'pin-direction-conflict',
        peripheralId: peripheral.id,
        endpointId: endpoint.id,
        padId: resolved.pad.id,
        functionId: resolved.pinFunction.id,
        message: `${peripheral.label} ${endpoint.label} expects ${endpoint.direction}, but ${resolved.pinFunction.label} is ${resolved.pinFunction.electrical.direction}.`,
      });
    }
  });

  buildWorkbenchDevices(wiring).forEach((device) => {
    const representative = device.members[0];
    const deviceId = device.id;

    const i2cMembers = device.members.filter((member) => member.kind === 'i2c');
    if (i2cMembers.length > 0) {
      const connectedI2c = i2cMembers
        .map((member) => {
          const resolved = getSignalFunctionForPeripheral(member, padById);
          return resolved?.pinFunction ? { member, pinFunction: resolved.pinFunction } : null;
        })
        .filter((entry): entry is { member: DemoPeripheral; pinFunction: DemoPinFunctionDefinition } => Boolean(entry));

      if (connectedI2c.length > 0 && connectedI2c.length < i2cMembers.length) {
        pushIssue(issues, {
          id: `i2c-pair-incomplete:${deviceId}`,
          severity: 'warning',
          code: 'i2c-pair-incomplete',
          deviceId,
          peripheralId: representative.id,
          message: `${device.label} has only part of its I2C pair connected. Wire both SCL and SDA to the same I2C bus.`,
        });
      }

      const busIds = new Set(connectedI2c.map((entry) => entry.pinFunction.bus.id ?? 'unknown'));
      if (busIds.size > 1) {
        pushIssue(issues, {
          id: `i2c-bus-mismatch:${deviceId}`,
          severity: 'error',
          code: 'i2c-bus-mismatch',
          deviceId,
          peripheralId: representative.id,
          message: `${device.label} SCL/SDA are on different I2C buses (${Array.from(busIds).join(', ')}). Choose pads from the same I2C peripheral.`,
        });
      }
    }
  });

  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;

  return {
    schemaVersion: ELECTRICAL_RULE_SCHEMA_VERSION,
    pinMux,
    issues,
    summary: {
      checkedDeviceCount: buildWorkbenchDevices(wiring).length,
      checkedSignalCount: wiring.peripherals.filter((peripheral) => Boolean(peripheral.padId)).length,
      selectedFunctionCount: pinMux.selections.length,
      errorCount,
      warningCount,
    },
  };
}
