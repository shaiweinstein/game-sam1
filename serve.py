#!/usr/bin/env python3
"""Lily's Dress-Up Adventure — dev server.

Drop-in replacement for `python3 -m http.server 8123` with two changes:

1. Every response sends `Cache-Control: no-store`, so a browser NEVER
   serves stale JS/CSS after an update. Python's stock handler sends no
   Cache-Control at all, letting browsers heuristically cache script
   files (which bit us during development).

2. It binds to LOOPBACK (127.0.0.1) by DEFAULT, so the folder is not
   silently exposed to everyone on the LAN. Reach it from a phone/tablet
   on the same network only on purpose:

       python3 serve.py                 # http://localhost:8123  (default)
       python3 serve.py 8123 --lan      # http://<this-mac-ip>:8123 (LAN)
       python3 serve.py --host 0.0.0.0  # same as --lan, explicit
"""

import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Supported hook: runs after the response headers are built but
        # before they are flushed, so this lands on every 200/304/404.
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


def parse_args(argv):
    host = "127.0.0.1"
    port = 8123
    seen_port = False
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("--lan",):
            host = "0.0.0.0"
        elif a in ("--host", "-h"):
            i += 1
            host = argv[i]
        elif a.startswith("--host="):
            host = a.split("=", 1)[1]
        elif a.isdigit():
            port = int(a)
            seen_port = True
        i += 1
    return host, port


if __name__ == "__main__":
    host, port = parse_args(sys.argv[1:])
    httpd = ThreadingHTTPServer((host, port), NoCacheHandler)
    shown = "localhost" if host in ("127.0.0.1", "0.0.0.0", "") else host
    where = " (LOOPBACK ONLY)" if host == "127.0.0.1" else " (LAN-EXPOSED)"
    print(f"Serving http://{shown}:{port}{where}  [no-store]")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
