using System;
using System.Collections.Generic;
using System.Linq;

// This file is a Renode-facing skeleton. When wired into a concrete Renode
// build, replace the small local interfaces below with Antmicro.Renode
// interfaces such as II2CPeripheral and IProvidesRegisterCollection-compatible
// lifecycle hooks for the selected Renode version.
namespace LocalWokwi.Broker;

public enum BrokerDirection
{
    Read,
    Write
}

public sealed record BrokerClock(
    ulong Sequence,
    ulong VirtualTimeNs
);

public sealed record I2CTransaction(
    string BusId,
    byte Address,
    BrokerDirection Direction,
    byte[] Payload,
    BrokerClock Clock
);

public interface ITransactionClock
{
    BrokerClock Snapshot();
}

public interface ITransactionSink
{
    void Publish(I2CTransaction transaction);
}

public sealed class MonotonicTransactionClock : ITransactionClock
{
    private readonly DateTime startedAt = DateTime.UtcNow;
    private ulong sequence;

    public BrokerClock Snapshot()
    {
        sequence += 1;
        var elapsed = DateTime.UtcNow - startedAt;
        return new BrokerClock(sequence, (ulong)(elapsed.TotalMilliseconds * 1_000_000.0));
    }
}

public sealed class I2CTransactionBroker
{
    private readonly ITransactionSink sink;
    private readonly ITransactionClock clock;
    private readonly List<byte> writeBuffer;

    public I2CTransactionBroker(string busId, byte address, ITransactionSink sink, ITransactionClock? clock = null)
    {
        BusId = busId;
        Address = address;
        this.sink = sink;
        this.clock = clock ?? new MonotonicTransactionClock();
        writeBuffer = new List<byte>();
    }

    public string BusId { get; }

    public byte Address { get; }

    public void Write(params byte[] data)
    {
        if(data == null || data.Length == 0)
        {
            return;
        }

        writeBuffer.AddRange(data.Select(value => (byte)(value & 0xFF)));
    }

    public byte[] Read(int count)
    {
        var payload = Enumerable.Repeat((byte)0xFF, Math.Max(0, count)).ToArray();
        sink.Publish(new I2CTransaction(
            BusId,
            Address,
            BrokerDirection.Read,
            payload,
            clock.Snapshot()
        ));
        return payload;
    }

    public void FinishTransmission()
    {
        if(writeBuffer.Count == 0)
        {
            return;
        }

        sink.Publish(new I2CTransaction(
            BusId,
            Address,
            BrokerDirection.Write,
            writeBuffer.ToArray(),
            clock.Snapshot()
        ));
        writeBuffer.Clear();
    }

    public void Reset()
    {
        writeBuffer.Clear();
    }
}
