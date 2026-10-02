"""Loopback-only Needle 2 adapter. It returns typed proposals and never executes tools."""
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Lock

HOST = "127.0.0.1"
PORT = int(os.environ.get("NEEDLE_PORT", "8765"))
MAX_BODY = 8192
LOCK = Lock()

class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, payload):
        data = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/healthz":
            self.send_json(200, {"ok": True, "model": "needle-2"})
        else:
            self.send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/complete":
            self.send_json(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 1 or length > MAX_BODY:
                self.send_json(413, {"error": "request too large"})
                return
            body = json.loads(self.rfile.read(length))
            query, schema = body.get("query"), body.get("schema")
            if not isinstance(query, str) or not query.strip() or len(query) > 500:
                self.send_json(400, {"error": "invalid query"})
                return
            if not isinstance(schema, dict) or schema.get("type") != "object" or not isinstance(schema.get("properties"), dict) or len(schema["properties"]) > 24:
                self.send_json(400, {"error": "invalid schema"})
                return
            # The schema is used only to constrain a single inert structured response.
            tools = [{
                "name": "darle_structured_response",
                "description": "Return a concise structured response for DARLE. Do not perform actions.",
                "parameters": schema,
            }]
            with LOCK:
                import needle
                agent = needle.Needle(tools=tools, system="You are DARLE's structured extraction specialist. Return only values supported by the input. Do not invent facts. Never execute actions.")
                result = agent.complete(query, max_new_tokens=160)
            calls = result.get("function_calls") or []
            turn = calls[0].get("arguments") if result.get("type") == "call" and calls and calls[0].get("name") == "darle_structured_response" else None
            self.send_json(200, {"turn": turn, "confidence": result.get("confidence")})
        except (ValueError, TypeError, KeyError):
            self.send_json(400, {"error": "invalid request"})
        except Exception:
            self.send_json(503, {"error": "model unavailable"})

    def log_message(self, fmt, *args):
        return

if __name__ == "__main__":
    # Import once at boot so the platform engine is fetched before requests arrive.
    import needle
    needle.Needle(tools=[])
    print("Needle 2 adapter ready", flush=True)
    HTTPServer((HOST, PORT), Handler).serve_forever()
