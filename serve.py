"""Tiny static file server for local previewing."""
import functools
import http.server
import os
import socketserver
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 4173

os.chdir(ROOT)


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Never cache during development, so reloads always show fresh code.
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", PORT), functools.partial(Handler, directory=ROOT)) as httpd:
    print("serving %s on http://127.0.0.1:%d" % (ROOT, PORT), flush=True)
    httpd.serve_forever()
