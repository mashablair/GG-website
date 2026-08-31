#!/usr/bin/env python3
"""A stand-in for the two Stripe API calls the purchase flow makes.

Lets the whole flow be exercised end to end locally, with no live keys and
nothing touching Stripe. Only used by the test script.
"""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

SESSIONS = {
    "cs_test_paid": {
        "id": "cs_test_paid",
        "object": "checkout.session",
        "payment_status": "paid",
        "amount_total": 24700,
        "currency": "usd",
        "customer": "cus_test_1",
        "payment_intent": "pi_test_paid",
        # Deliberately mixed case and padded, to prove we normalise it.
        "customer_details": {"email": "  Buyer@Example.COM ", "name": "Anna Petrova"},
        "line_items": {"data": [{"price": {"id": "price_1U9ULm1PqsZvBWX7466P75gd"}}]},
    },
    # Basket with the course AND the $97 consultation cross-sell.
    "cs_test_crosssell": {
        "id": "cs_test_crosssell",
        "object": "checkout.session",
        "payment_status": "paid",
        "amount_total": 34400,
        "currency": "usd",
        "payment_intent": "pi_test_crosssell",
        "customer_details": {"email": "bundle@example.com", "name": "Bundle Buyer"},
        "line_items": {
            "data": [
                {"price": {"id": "price_test_consultation"}},
                {"price": {"id": "price_1U9ULm1PqsZvBWX7466P75gd"}},
            ]
        },
    },
    # A consultation on its own — a real product, but not a course.
    # Must unlock nothing.
    "cs_test_consultation_only": {
        "id": "cs_test_consultation_only",
        "object": "checkout.session",
        "payment_status": "paid",
        "amount_total": 9700,
        "currency": "usd",
        "payment_intent": "pi_test_consult",
        "customer_details": {"email": "consult@example.com", "name": "Consult Only"},
        "line_items": {"data": [{"price": {"id": "price_test_consultation"}}]},
    },
    # A delayed method (Klarna, bank transfer). By the time
    # async_payment_succeeded fires, Stripe reports it paid.
    "cs_test_async": {
        "id": "cs_test_async",
        "object": "checkout.session",
        "payment_status": "paid",
        "amount_total": 24700,
        "currency": "usd",
        "payment_intent": "pi_test_async",
        "customer_details": {"email": "klarna@example.com", "name": "Katya Ivanova"},
        "line_items": {"data": [{"price": {"id": "price_1U9ULm1PqsZvBWX7466P75gd"}}]},
    },
    "cs_test_unpaid": {
        "id": "cs_test_unpaid",
        "object": "checkout.session",
        "payment_status": "unpaid",
        "amount_total": 24700,
        "currency": "usd",
        "customer_details": {"email": "freeloader@example.com", "name": "No Pay"},
        "line_items": {"data": [{"price": {"id": "price_1U9ULm1PqsZvBWX7466P75gd"}}]},
    },
}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        parts = [p for p in parsed.path.split("/") if p]

        # GET /v1/checkout/sessions?payment_intent=pi_...
        if parts == ["v1", "checkout", "sessions"]:
            pi = parse_qs(parsed.query).get("payment_intent", [None])[0]
            match = [s for s in SESSIONS.values() if s.get("payment_intent") == pi]
            return self.send_json({"object": "list", "data": match})

        # GET /v1/checkout/sessions/{id}
        if len(parts) == 4 and parts[:3] == ["v1", "checkout", "sessions"]:
            session = SESSIONS.get(parts[3])
            if session is None:
                return self.send_json({"error": {"message": "No such session"}}, 404)
            return self.send_json(session)

        self.send_json({"error": {"message": "unexpected path"}}, 404)

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
    HTTPServer(("127.0.0.1", 8799), Handler).serve_forever()
