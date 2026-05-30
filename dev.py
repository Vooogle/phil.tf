"""
Dev server for phil.tf — SPA fallback + COOP/COEP headers for SharedArrayBuffer.
Usage: python dev.py [port]   (default 8080)
"""

import http.server, os, sys
from pathlib import Path

ROOT = Path(__file__).parent / 'site'
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'credentialless')
        super().end_headers()

    def do_GET(self):
        # Strip query string for file lookup
        path = self.path.split('?')[0].split('#')[0]
        target = ROOT / path.lstrip('/')

        # SPA fallback: if the path doesn't map to a real file, serve index.html
        if not target.exists() or not target.is_file():
            self.path = '/index.html'

        super().do_GET()

    def log_message(self, fmt, *args):
        print(f'  {self.address_string()} {fmt % args}')


if __name__ == '__main__':
    os.chdir(ROOT)
    with http.server.ThreadingHTTPServer(('', PORT), Handler) as srv:
        print(f'Serving http://localhost:{PORT}  (Ctrl+C to stop)')
        srv.serve_forever()
