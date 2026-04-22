using System;
using System.IO;
using System.Linq;
using System.Net.Sockets;
using System.Text.Json;

namespace LocalWokwi.Broker;

public sealed class JsonLineTransactionSink : ITransactionSink
{
    private readonly Action<string> emit;

    public JsonLineTransactionSink(Action<string> emit)
    {
        this.emit = emit;
    }

    public void Publish(I2CTransaction transaction)
    {
        var payload = new
        {
            schemaVersion = 1,
            protocol = "i2c",
            type = "bus-transaction",
            source = "renode",
            status = "data",
            busId = transaction.BusId,
            address = transaction.Address,
            direction = transaction.Direction == BrokerDirection.Write ? "write" : "read",
            bytes = transaction.Payload.Select(value => (int)value).ToArray(),
            clock = new
            {
                sequence = transaction.Clock.Sequence,
                virtualTimeNs = transaction.Clock.VirtualTimeNs
            }
        };
        emit(JsonSerializer.Serialize(payload));
    }
}

public sealed class TcpJsonLineTransactionSink : ITransactionSink, IDisposable
{
    private readonly TcpClient client;
    private readonly StreamWriter writer;
    private readonly JsonLineTransactionSink serializer;

    public TcpJsonLineTransactionSink(string host, int port)
    {
        client = new TcpClient();
        client.Connect(host, port);
        writer = new StreamWriter(client.GetStream())
        {
            AutoFlush = true,
            NewLine = "\n"
        };
        serializer = new JsonLineTransactionSink(line => writer.WriteLine(line));
    }

    public void Publish(I2CTransaction transaction)
    {
        serializer.Publish(transaction);
    }

    public void Dispose()
    {
        writer.Dispose();
        client.Dispose();
    }
}

public sealed class LocalWokwiBrokerPlugin
{
    public const string Version = "0.1.0";

    public LocalWokwiBrokerPlugin(Action<string> emitJsonLine)
    {
        Sink = new JsonLineTransactionSink(emitJsonLine);
        Clock = new MonotonicTransactionClock();
    }

    public ITransactionSink Sink { get; }

    public ITransactionClock Clock { get; }

    public I2CTransactionBroker CreateSsd1306Broker(string busId = "i2c:i2c1", byte address = 0x3C)
    {
        return new I2CTransactionBroker(busId, address, Sink, Clock);
    }

    public static LocalWokwiBrokerPlugin ConnectTcp(string host = "127.0.0.1", int port = 9201)
    {
        var sink = new TcpJsonLineTransactionSink(host, port);
        return new LocalWokwiBrokerPlugin(sink);
    }

    private LocalWokwiBrokerPlugin(ITransactionSink sink)
    {
        Sink = sink;
        Clock = new MonotonicTransactionClock();
    }
}
