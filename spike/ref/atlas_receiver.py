import http.server, socketserver, os

OUT = "/Users/shai/game2/spike"

class H(http.server.BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(n)
        if self.path.startswith("/save/"):
            fname = self.path[len("/save/"):]
        else:
            fname = "unknown.bin"
        fname = os.path.basename(fname)
        with open(os.path.join(OUT, fname), "wb") as f:
            f.write(body)
        self.send_response(200)
        self._cors()
        self.end_headers()
        self.wfile.write(b"ok " + fname.encode())

    def log_message(self, *a):
        pass

with socketserver.TCPServer(("127.0.0.1", 8199), H) as httpd:
    print("receiver on 8199", flush=True)
    httpd.serve_forever()
