import argparse
import threading
import time
import webbrowser

from ocp.server import create_server


def main():
    parser = argparse.ArgumentParser(description="OCP Commerce Lab")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", default=8760, type=int)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    server = create_server(args.host, args.port, quiet=args.quiet)
    url = "http://%s:%s" % (args.host, server.server_address[1])
    print("OCP Commerce Lab is running at %s" % url)
    print("OCP Catalog discovery: %s/.well-known/ocp-catalog" % url)
    print("Press Ctrl+C to stop.")

    if not args.no_browser:
        threading.Thread(target=lambda: (time.sleep(0.6), webbrowser.open(url)), daemon=True).start()

    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        print("\nStopping OCP Commerce Lab.")
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
