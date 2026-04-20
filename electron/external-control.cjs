const net = require('net');

const RETURN_CODE = {
  COMMAND_FAILED: 0,
  FATAL_ERROR: 1,
  INVALID_COMMAND: 2,
  SUCCESS_WITH_DATA: 3,
  SUCCESS_WITHOUT_DATA: 4,
  SUCCESS_HANDSHAKE: 5,
  ASYNC_EVENT: 6,
};

const COMMAND = {
  GET_MACHINE: 3,
  GPIO: 5,
};

const GPIO_COMMAND = {
  GET_STATE: 0,
  SET_STATE: 1,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class ExternalControlClient {
  constructor({ host = '127.0.0.1', port, machineName }) {
    this.host = host;
    this.port = port;
    this.machineName = machineName;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.pendingReads = [];
    this.pendingError = null;
    this.closed = false;
    this.commandQueue = Promise.resolve();
    this.machineId = null;
    this.gpioDescriptors = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port }, () => {
        this.socket = socket;
        resolve();
      });

      socket.on('data', (chunk) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        this.flushReads();
      });

      socket.on('close', () => {
        this.closed = true;
        this.rejectPendingReads(new Error('External control socket closed.'));
      });

      socket.on('error', (error) => {
        this.pendingError = error;
        this.rejectPendingReads(error);
      });

      socket.once('error', reject);
    });

    await this.performHandshake();
    this.machineId = await this.getMachineDescriptor(this.machineName);
  }

  close() {
    this.closed = true;
    this.rejectPendingReads(new Error('External control client closed.'));
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch {
        // ignore shutdown errors
      }
    }
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.gpioDescriptors.clear();
  }

  enqueue(task) {
    const next = this.commandQueue.then(task, task);
    this.commandQueue = next.catch(() => {});
    return next;
  }

  async ensureGpioDescriptor(name) {
    if (this.gpioDescriptors.has(name)) {
      return this.gpioDescriptors.get(name);
    }

    const descriptor = await this.registerInstance(COMMAND.GPIO, name);
    this.gpioDescriptors.set(name, descriptor);
    return descriptor;
  }

  async setPeripheralState(entry, state) {
    return this.enqueue(async () => {
      const descriptor = await this.ensureGpioDescriptor(entry.gpioPortName);
      await this.sendGpioSetState(descriptor, entry.gpioNumber, state);
    });
  }

  async getPeripheralState(entry) {
    return this.enqueue(async () => {
      const descriptor = await this.ensureGpioDescriptor(entry.gpioPortName);
      return this.sendGpioGetState(descriptor, entry.gpioNumber);
    });
  }

  async getPeripheralStates(entries) {
    return this.enqueue(async () => {
      const states = new Map();
      for (const entry of entries) {
        const descriptor = await this.ensureGpioDescriptor(entry.gpioPortName);
        const value = await this.sendGpioGetState(descriptor, entry.gpioNumber);
        states.set(entry.id, value);
      }
      return states;
    });
  }

  async performHandshake() {
    const pairs = [
      COMMAND.GET_MACHINE, 0,
      COMMAND.GPIO, 1,
    ];
    const payload = Buffer.alloc(2 + pairs.length);
    payload.writeUInt16LE(pairs.length / 2, 0);
    pairs.forEach((value, index) => {
      payload[2 + index] = value;
    });

    await this.write(payload);
    const response = await this.readExactly(1);
    if (response[0] !== RETURN_CODE.SUCCESS_HANDSHAKE) {
      throw new Error(`Unexpected handshake response code: ${response[0]}`);
    }
  }

  async getMachineDescriptor(name) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const payload = Buffer.alloc(4 + nameBuffer.length);
    payload.writeInt32LE(nameBuffer.length, 0);
    nameBuffer.copy(payload, 4);

    const response = await this.sendCommand(COMMAND.GET_MACHINE, payload);
    return response.readInt32LE(0);
  }

  async registerInstance(commandId, name) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const payload = Buffer.alloc(12 + nameBuffer.length);
    payload.writeInt32LE(-1, 0);
    payload.writeInt32LE(this.machineId, 4);
    payload.writeInt32LE(nameBuffer.length, 8);
    nameBuffer.copy(payload, 12);

    const response = await this.sendCommand(commandId, payload);
    return response.readInt32LE(0);
  }

  async sendGpioGetState(descriptor, number) {
    const payload = Buffer.alloc(9);
    payload.writeInt32LE(descriptor, 0);
    payload.writeUInt8(GPIO_COMMAND.GET_STATE, 4);
    payload.writeInt32LE(number, 5);

    const response = await this.sendCommand(COMMAND.GPIO, payload);
    return response.length > 0 ? Boolean(response.readUInt8(0)) : false;
  }

  async sendGpioSetState(descriptor, number, state) {
    const payload = Buffer.alloc(10);
    payload.writeInt32LE(descriptor, 0);
    payload.writeUInt8(GPIO_COMMAND.SET_STATE, 4);
    payload.writeInt32LE(number, 5);
    payload.writeUInt8(state ? 1 : 0, 9);

    await this.sendCommand(COMMAND.GPIO, payload);
  }

  async sendCommand(commandId, payload) {
    const header = Buffer.alloc(7);
    header.write('RE', 0, 'ascii');
    header.writeUInt8(commandId, 2);
    header.writeUInt32LE(payload.length, 3);

    await this.write(Buffer.concat([header, payload]));
    return this.readResponse(commandId);
  }

  async readResponse(expectedCommandId) {
    const returnCode = (await this.readExactly(1)).readUInt8(0);

    if (returnCode === RETURN_CODE.ASYNC_EVENT) {
      throw new Error('Unexpected async event while polling GPIO state.');
    }

    let commandId = null;
    if (
      returnCode === RETURN_CODE.COMMAND_FAILED ||
      returnCode === RETURN_CODE.INVALID_COMMAND ||
      returnCode === RETURN_CODE.SUCCESS_WITH_DATA ||
      returnCode === RETURN_CODE.SUCCESS_WITHOUT_DATA
    ) {
      commandId = (await this.readExactly(1)).readUInt8(0);
      if (commandId !== expectedCommandId) {
        throw new Error(`External control command mismatch: expected ${expectedCommandId}, got ${commandId}`);
      }
    }

    if (returnCode === RETURN_CODE.SUCCESS_WITHOUT_DATA) {
      return Buffer.alloc(0);
    }

    if (returnCode === RETURN_CODE.SUCCESS_WITH_DATA) {
      const size = (await this.readExactly(4)).readUInt32LE(0);
      return size > 0 ? this.readExactly(size) : Buffer.alloc(0);
    }

    if (returnCode === RETURN_CODE.COMMAND_FAILED || returnCode === RETURN_CODE.FATAL_ERROR) {
      const size = (await this.readExactly(4)).readUInt32LE(0);
      const message = size > 0 ? (await this.readExactly(size)).toString('utf8') : 'Unknown external control error.';
      throw new Error(message);
    }

    if (returnCode === RETURN_CODE.INVALID_COMMAND) {
      throw new Error(`Renode external control rejected command ${expectedCommandId}.`);
    }

    throw new Error(`Unexpected external control return code: ${returnCode}`);
  }

  async write(buffer) {
    if (!this.socket || this.closed) {
      throw new Error('External control socket is not connected.');
    }

    await new Promise((resolve, reject) => {
      this.socket.write(buffer, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  async readExactly(byteCount) {
    if (this.pendingError) {
      throw this.pendingError;
    }

    if (this.buffer.length >= byteCount) {
      const chunk = this.buffer.slice(0, byteCount);
      this.buffer = this.buffer.slice(byteCount);
      return chunk;
    }

    return new Promise((resolve, reject) => {
      this.pendingReads.push({ byteCount, resolve, reject });
      this.flushReads();
    });
  }

  flushReads() {
    while (this.pendingReads.length > 0) {
      const next = this.pendingReads[0];
      if (this.buffer.length < next.byteCount) {
        return;
      }

      const chunk = this.buffer.slice(0, next.byteCount);
      this.buffer = this.buffer.slice(next.byteCount);
      this.pendingReads.shift();
      next.resolve(chunk);
    }
  }

  rejectPendingReads(error) {
    while (this.pendingReads.length > 0) {
      const pending = this.pendingReads.shift();
      pending.reject(error);
    }
  }
}

async function connectExternalControlClient({ port, machineName, peripheralManifest, attempts = 40, delayMs = 250 }) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const client = new ExternalControlClient({
      port,
      machineName,
    });

    try {
      await client.connect();

      const uniquePortNames = [...new Set((peripheralManifest || []).map((entry) => entry.gpioPortName).filter(Boolean))];
      for (const portName of uniquePortNames) {
        await client.ensureGpioDescriptor(portName);
      }

      return client;
    } catch (error) {
      lastError = error;
      client.close();
      await sleep(delayMs);
    }
  }

  throw lastError ?? new Error('Timed out while connecting to Renode external control.');
}

module.exports = {
  connectExternalControlClient,
};
