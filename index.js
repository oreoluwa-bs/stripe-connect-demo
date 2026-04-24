require('dotenv').config();
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');

const app = express();
const port = process.env.PORT || 4242;

app.use(cors());

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
 * Step 1: Create a Connect Account
 * This creates an Express account by default.
 */
app.post('/api/connect/create-account', async (req, res) => {
  try {
    const account = await stripe.accounts.create({
      type: 'express',
    });
    res.json({ accountId: account.id });
  } catch (error) {
    console.error('Error creating account:', error);
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

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
