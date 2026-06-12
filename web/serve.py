"""Tiny static file server for the KIPP demographics tool.

Run:  python3 web/serve.py [port]
Serves the web/ directory (and its data/ symlink), then opens the tool in your
default browser. Picks the next free port if the requested one is taken.
"""
import http.server, socketserver, os, sys, webbrowser, threading

START_PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
os.chdir(os.path.dirname(os.path.abspath(__file__)))

Handler = http.server.SimpleHTTPRequestHandler
Handler.extensions_map[".js"] = "application/javascript"
Handler.extensions_map[".geojson"] = "application/json"
Handler.extensions_map[".json"] = "application/json"


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def find_port(start):
    for p in range(start, start + 20):
        try:
            s = Server(("", p), Handler)
            return s, p
        except OSError:
            continue
    raise SystemExit(f"No free port in {start}-{start+19}. Close other servers and retry.")


httpd, port = find_port(START_PORT)
url = f"http://localhost:{port}/"
print("=" * 52)
print(f"  KIPP Demographics tool is running:")
print(f"  {url}")
print("  (Keep this window open. Press Ctrl+C to stop.)")
print("=" * 52)

# Open the browser a moment after the server starts listening.
threading.Timer(1.0, lambda: webbrowser.open(url)).start()

try:
    httpd.serve_forever()
except KeyboardInterrupt:
    print("\nStopped.")
