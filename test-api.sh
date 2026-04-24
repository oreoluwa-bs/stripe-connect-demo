#!/bin/bash

# Configuration
API_URL="http://localhost:4242/api"

echo "--- 1. Creating Connect Account ---"
ACCOUNT_RESPONSE=$(curl -s -X POST "$API_URL/connect/create-account")
echo "Response: $ACCOUNT_RESPONSE"
ACCOUNT_ID=$(echo $ACCOUNT_RESPONSE | grep -o '"accountId":"[^"]*' | cut -d'"' -f4)

if [ -z "$ACCOUNT_ID" ]; then
    echo "Error: Could not retrieve accountId. Make sure the server is running and STRIPE_SECRET_KEY is set."
    exit 1
fi

echo "--- 2. Creating Account Link for Onboarding ---"
curl -s -X POST "$API_URL/connect/create-account-link" \
  -H "Content-Type: application/json" \
  -d "{\"accountId\": \"$ACCOUNT_ID\"}"
echo ""

echo "--- 3. Creating Deposit (Checkout Session) ---"
curl -s -X POST "$API_URL/connect/create-deposit" \
  -H "Content-Type: application/json" \
  -d "{
    \"accountId\": \"$ACCOUNT_ID\",
    \"amount\": 2000,
    \"currency\": \"usd\"
  }"
echo ""
