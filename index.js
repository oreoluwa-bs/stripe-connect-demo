require('dotenv').config();
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');

const app = express();
const port = process.env.PORT || 4242;

app.use(cors());
app.use(express.static('public'));


// Webhook endpoint needs raw body for signature verification
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error(`Webhook Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'account.updated':
      const account = event.data.object;
      console.log(`Account ${account.id} updated`);
      break;
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
});

// Middleware for other endpoints
app.use(express.json());

/**
 * Step 1: Create a Connect Account (Using Accounts v2)
 * This ensures long-term support and follows the latest recommendations.
 */
app.post('/api/connect/create-account', async (req, res) => {
  try {
    const account = await stripe.v2.core.accounts.create({
      capabilities: {
        transfers: { requested: true },
        payments: { requested: true },
      },
      dashboard: {
        type: 'express', // Provides the hosted Express dashboard
      },
      defaults: {
        responsibilities: {
          payments: 'connected_account',
          payouts: 'connected_account',
          disputes: 'platform_account', // Platform handles disputes for simplicity
        }
      }
    });
    res.json({ accountId: account.id });
  } catch (error) {
    console.error('Error creating account (v2):', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Step 2: Create an Account Link
 * Used for onboarding or accessing the dashboard.
 */
app.post('/api/connect/create-account-link', async (req, res) => {
  try {
    const { accountId, refresh_url, return_url, type = 'account_onboarding' } = req.body;

    if (!accountId) {
      return res.status(400).json({ error: 'accountId is required' });
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refresh_url || `${process.env.FRONTEND_URL}/refresh`,
      return_url: return_url || `${process.env.FRONTEND_URL}/return`,
      type: type, // 'account_onboarding' or 'account_update'
    });

    res.json({ url: accountLink.url });
  } catch (error) {
    console.error('Error creating account link:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Step 3: Create a Deposit (Checkout Session)
 * Charges a customer and sends funds to the connected account.
 */
app.post('/api/connect/create-deposit', async (req, res) => {
  try {
    const { accountId, amount, currency = 'usd' } = req.body;

    if (!accountId || !amount) {
      return res.status(400).json({ error: 'accountId and amount are required' });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: currency,
            unit_amount: amount, // in cents
            product_data: {
              name: 'Deposit to Wallet',
            },
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        application_fee_amount: 0, // Customize this to take a platform fee
        transfer_data: {
          destination: accountId,
        },
      },
      success_url: `${process.env.FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/cancel`,
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Step 5: Transfer Funds
 * Moves funds from the platform balance to a connected account.
 */
app.post('/api/connect/transfer', async (req, res) => {
  try {
    const { destinationAccountId, amount, currency = 'usd' } = req.body;

    if (!destinationAccountId || !amount) {
      return res.status(400).json({ error: 'destinationAccountId and amount are required' });
    }

    const transfer = await stripe.transfers.create({
      amount: amount,
      currency: currency,
      destination: destinationAccountId,
    });

    res.json(transfer);
  } catch (error) {
    console.error('Error creating transfer:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Step 6: Transfer Between Accounts
 * Moves funds from Account A back to Platform, then to Account B.
 * Requires the original transferId to perform a reversal.
 */
app.post('/api/connect/transfer-between', async (req, res) => {
  try {
    const { fromAccountId, toAccountId, amount, transferId } = req.body;

    if (!fromAccountId || !toAccountId || !amount || !transferId) {
      return res.status(400).json({ error: 'Missing fromAccountId, toAccountId, amount, or transferId' });
    }

    // 1. Reverse the original transfer (pull funds back to platform)
    await stripe.transfers.createReversal(transferId, {
      amount: amount,
    });

    // 2. Create a new transfer to the destination account
    const newTransfer = await stripe.transfers.create({
      amount: amount,
      currency: 'usd',
      destination: toAccountId,
    });

    res.json({ success: true, transfer: newTransfer });
  } catch (error) {
    console.error('Error in transfer-between:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
