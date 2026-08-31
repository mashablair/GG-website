#!/usr/bin/env python3
"""A stand-in for the one Lava.top API call the webhook makes.

Only used by the test script, so the whole flow can be exercised without a Lava
account. Invoice bodies follow InvoiceResponseV2 in lavatop-docs.yaml.
"""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

API_KEY = "lava_test_api_key"

INVOICES = {
    # A genuine, completed purchase.
    "c0000000-0000-0000-0000-000000000001": {
        "id": "c0000000-0000-0000-0000-000000000001",
        "status": "COMPLETED",
        "buyer": {"email": "olga@example.ru"},
        "receipt": {"amount": 24700.0, "currency": "RUB"},
        "product": {"name": "The Dating Method", "offer": "Full course"},
    },
    # Paid for but not settled — access must not be granted.
    "c0000000-0000-0000-0000-000000000002": {
        "id": "c0000000-0000-0000-0000-000000000002",
        "status": "IN_PROGRESS",
        "buyer": {"email": "pending@example.ru"},
        "receipt": {"amount": 24700.0, "currency": "RUB"},
        "product": {"name": "The Dating Method", "offer": "Full course"},
    },
    # Completed, but for a different buyer than the webhook claims.
    "c0000000-0000-0000-0000-000000000003": {
        "id": "c0000000-0000-0000-0000-000000000003",
        "status": "COMPLETED",
        "buyer": {"email": "someone-else@example.ru"},
        "receipt": {"amount": 24700.0, "currency": "RUB"},
        "product": {"name": "The Dating Method", "offer": "Full course"},
    },
}


# Invoices created through POST /api/v3/invoice during a test run.
CREATED = {}


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.headers.get("X-Api-Key") != API_KEY:
            return self.send_json({"error": "unauthorized"}, 401)

        parts = [p for p in urlparse(self.path).path.split("/") if p]
        if parts != ["api", "v3", "invoice"]:
            return self.send_json({"error": "unexpected path"}, 404)

        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")

        # Lava rejects an unknown offer, and so does this.
        if body.get("offerId") != "offer-rub-one-time":
            return self.send_json({"error": "Product with offer id not found"}, 404)

        # Lava refuses some addresses outright — the seller's own account email,
        # for one. Observed against the real API, which answers 400 with exactly
        # this message. Retrying doesn't help, so the page must say so.
        if body.get("email") == "seller@example.ru":
            return self.send_json({"error": "Incorrect email to purchase"}, 400)

        # СБП only exists on PAY2ME, and Lava rejects the pairing if the
        # provider is wrong — so the two must travel together.
        sbp = body.get("paymentMethod") == "SBP"
        if sbp and body.get("paymentProvider") != "PAY2ME":
            return self.send_json({"error": "SBP requires PAY2ME"}, 400)

        contract = (
            "c0000000-0000-0000-0000-0000000000bb" if sbp
            else "c0000000-0000-0000-0000-0000000000aa"
        )
        # Starts unsettled, exactly as a real card payment does for a moment.
        CREATED[contract] = {
            "id": contract,
            "status": "IN_PROGRESS",
            "buyer": {"email": body.get("email")},
            "receipt": {"amount": 19900.0, "currency": "RUB"},
            "product": {"name": "The Dating Method", "offer": "Полный курс"},
        }
        return self.send_json(
            {
                "id": contract,
                "status": "in-progress",
                "amountTotal": {"amount": 19900.0, "currency": "RUB"},
                # The real API sends card buyers to Smart Glocal's widget and
                # СБП buyers to Pay2Me's, so the destinations differ.
                "paymentUrl": (
                    "https://pay2me-widget.example/pay/" if sbp
                    else "https://payment-widget.example/pay/"
                ) + contract,
            },
            201,
        )

    def do_GET(self):
        parsed = urlparse(self.path)
        parts = [p for p in parsed.path.split("/") if p]

        # A test hook, not part of Lava's API: marks a created invoice settled,
        # so the "payment completes a moment later" case can be exercised.
        # Deliberately before the API-key check — it isn't a Lava endpoint.
        if parts == ["_settle"]:
            cid = parse_qs(parsed.query).get("contract", [None])[0]
            if cid in CREATED:
                CREATED[cid]["status"] = "COMPLETED"
                return self.send_json({"ok": True})
            return self.send_json({"error": "unknown"}, 404)

        if self.headers.get("X-Api-Key") != API_KEY:
            return self.send_json({"error": "unauthorized"}, 401)

        # GET /api/v1/invoices/{id}
        if len(parts) == 4 and parts[:3] == ["api", "v1", "invoices"]:
            invoice = CREATED.get(parts[3]) or INVOICES.get(parts[3])
            if invoice is None:
                return self.send_json({"error": "not found"}, 404)
            return self.send_json(invoice)

        self.send_json({"error": "unexpected path"}, 404)

    def send_json(self, body, status=200):
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", 8797), Handler).serve_forever()
