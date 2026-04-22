# LocalWokwi.Broker

This folder contains the first Renode-side C# broker skeleton for protocol-level transaction capture.

Current scope:

- `I2CTransactionBroker` buffers I2C writes, publishes read/write transactions, and attaches a monotonic clock.
- `JsonLineTransactionSink` serializes transactions into the same JSON shape consumed by the Electron `timeline`/`bus` runtime stream.
- `TcpJsonLineTransactionSink` can connect directly to Electron's Transaction Broker Bridge (`127.0.0.1:9201` by default).
- `LocalWokwiBrokerPlugin` is intentionally small so it can be adapted to the exact Renode plugin API available in the target Renode build.

Important boundary:

- The desktop app already consumes the matching schema and can render SSD1306 transactions.
- Each simulation workspace writes `local-wokwi-broker.json` beside the generated `.resc`; a native plugin can read this file to discover host, port, transport, and bus/device manifest data.
- This skeleton is not yet wired into the checked-in Renode build system. The local `renode-master/src/Infrastructure` folder in this workspace is not populated with the full Renode C# project tree, so the plugin is kept isolated and documented instead of being force-added to `Renode.sln`.

Next integration step:

1. Point `LocalWokwi.Broker.csproj` at a full Renode source checkout or installed Renode plugin SDK.
2. Replace the local adapter methods with the concrete Renode `II2CPeripheral` interface for the selected Renode version.
3. Load the compiled assembly from `.resc`.
4. Route each published JSON line to Electron through the TCP JSONL Transaction Broker Bridge.

Minimal bridge payload:

```json
{"schemaVersion":1,"type":"bus-transaction","protocol":"i2c","source":"renode","status":"data","busId":"i2c:i2c1","address":60,"direction":"write","bytes":[0,174,175]}
```

Standalone build check:

```bash
dotnet build renode-plugins/LocalWokwi.Broker/LocalWokwi.Broker.csproj
```
