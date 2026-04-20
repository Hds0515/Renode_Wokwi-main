import json
import socket
import threading

WS_HOST = '127.0.0.1'
WS_PORT = __BRIDGE_PORT__

server_socket = None
client_socket = None
machine = None
led_hooked = False
led_hook_error = None
GPIO_PORT_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"]


def log(message):
    monitor.Parse("echo '[LocalBridge] {0}'".format(message))


def send_message(payload):
    global client_socket

    if not client_socket:
        return

    try:
        serialized = json.dumps(payload) + "\n"
        client_socket.sendall(serialized.encode('utf-8'))
    except Exception as error:
        log("Failed to send payload: {0}".format(error))


def get_peripheral(name):
    candidates = [name, "sysbus.{0}".format(name)]

    if name == "externalLed":
        for port in GPIO_PORT_LETTERS:
            candidates.extend([
                "gpioPort{0}.externalLed".format(port),
                "sysbus.gpioPort{0}.externalLed".format(port),
                "gpioPort{0}.led".format(port),
                "sysbus.gpioPort{0}.led".format(port),
            ])
    elif name == "externalButton":
        for port in GPIO_PORT_LETTERS:
            candidates.extend([
                "gpioPort{0}.externalButton".format(port),
                "sysbus.gpioPort{0}.externalButton".format(port),
                "gpioPort{0}.button".format(port),
                "sysbus.gpioPort{0}.button".format(port),
            ])

    for candidate in candidates:
        try:
            peripheral = monitor.Machine[candidate]
            if peripheral is not None:
                return peripheral
        except Exception:
            pass

        try:
            peripheral = machine[candidate]
            if peripheral is not None:
                return peripheral
        except Exception:
            pass

    return None


def handle_message(message):
    msg_type = message.get("type")

    if msg_type == "button":
        button = get_peripheral("externalButton")
        if not button:
            log("externalButton peripheral is missing.")
            return

        if message.get("state") == 1:
            button.Press()
        else:
            button.Release()

        send_message({
            "type": "bridge",
            "status": "button-event",
            "state": int(message.get("state") == 1)
        })


def handle_client(connection):
    global client_socket

    log("Renderer connected to local bridge.")
    client_socket = connection
    buffer = ""
    send_message({
        "type": "bridge",
        "status": "ready",
        "ledHooked": led_hooked,
        "ledHookError": led_hook_error
    })

    try:
        while True:
            data = connection.recv(1024)
            if not data:
                break

            buffer += data.decode('utf-8')
            while "\n" in buffer:
                raw, buffer = buffer.split("\n", 1)
                raw = raw.strip()
                if not raw:
                    continue

                try:
                    handle_message(json.loads(raw))
                except Exception as error:
                    log("Bad payload: {0}".format(error))
    except Exception as error:
        log("Bridge client error: {0}".format(error))
    finally:
        try:
            connection.close()
        except Exception:
            pass

        if client_socket == connection:
            client_socket = None
        log("Renderer disconnected from local bridge.")


def start_bridge_server():
    global server_socket

    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)

    try:
        server_socket.bind((WS_HOST, WS_PORT))
        server_socket.listen(1)
        log("Listening on {0}:{1}.".format(WS_HOST, WS_PORT))

        while True:
            connection, _address = server_socket.accept()
            thread = threading.Thread(target=handle_client, args=(connection,))
            thread.daemon = True
            thread.start()
    except Exception as error:
        log("Bridge server failed: {0}".format(error))


def on_led_state_changed(_led, state):
    send_message({"type": "led", "id": "led1", "state": int(state)})


def init():
    global machine, led_hooked, led_hook_error

    try:
        machine = monitor.Machine
    except Exception as error:
        log("Could not access monitor.Machine: {0}".format(error))
        return

    if machine is None:
        log("No active machine found in monitor context.")
        return

    try:
        led = get_peripheral("externalLed")
        led.StateChanged += on_led_state_changed
        led_hooked = True
        led_hook_error = None
        log("Hooked externalLed StateChanged event.")
    except Exception as error:
        led_hooked = False
        led_hook_error = str(error)
        log("Could not hook externalLed: {0}".format(error))

    thread = threading.Thread(target=start_bridge_server)
    thread.daemon = True
    thread.start()


init()
