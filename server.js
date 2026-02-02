import "dotenv/config";
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import { getSpotStatus } from "./backend/spotStatus.js";
import { amqpEvents, liveSpotCache } from "./backend/amqpClient.js";
import Stripe from "stripe";

const require = createRequire(import.meta.url);
const admin = require("firebase-admin");
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors({
  origin: [
    "http://127.0.0.1:5501",
    "http://localhost:5501",
    process.env.BASE_URL
  ],
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));
const PORT = process.env.PORT || 5500;
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const ACTIVE_SESSION_INTERVAL = 60 * 1000; // 1 min
const PENDING_SESSION_INTERVAL = 1000; // 1 sec

setInterval(async () => {
  try {
    const now = admin.firestore.Timestamp.now();

    const activeSessions = await db
      .collection("parking_sessions")
      .where("status", "==", "ACTIVE")
      .get();

    for (const docSnap of activeSessions.docs) {
      const data = docSnap.data();
      if (!data.arrival_time || typeof data.rate_per_minute !== "number") {
        continue;
      }

      const start = data.arrival_time.toDate();
      const minutes = Math.floor((Date.now() - start.getTime()) / 60000);
      const price = Number((minutes * data.rate_per_minute).toFixed(2));

      await docSnap.ref.update({
        total_minutes: minutes,
        price_charged: price,
        last_updated: now
      });
    }
  } catch (err) {
    console.error("Failed to update active sessions:", err);
  }
}, ACTIVE_SESSION_INTERVAL);

setInterval(async () => {
  try {
    const now = admin.firestore.Timestamp.now();

    const pendingSessions = await db
      .collection("parking_sessions")
      .where("status", "==", "PENDING")
      .get();

    for (const docSnap of pendingSessions.docs) {
      const data = docSnap.data();

      if (!data.pending_started_at) {
        await docSnap.ref.update({
          pending_started_at: admin.firestore.FieldValue.serverTimestamp()
        });
        continue;
      }

      const startedAt = data.pending_started_at.toDate();
      const elapsedMs = now.toMillis() - startedAt.getTime();
      if (elapsedMs < 10000) continue;

      if (!data.zone_id) continue;

      const zoneRef =
        typeof data.zone_id === "string" ? db.doc(data.zone_id) : data.zone_id;
      const zoneSnap = await zoneRef.get();
      if (!zoneSnap.exists) continue;

      const zoneData = zoneSnap.data();

      const occupied =
        zoneData.is_available === false || zoneData.is_available === "false";

      if (occupied) {
        await docSnap.ref.update({
          status: "ACTIVE",
          activated_at: admin.firestore.FieldValue.serverTimestamp()
        });
      } else {
        await docSnap.ref.delete();
      }
    }
  } catch (err) {
    console.error("Failed to process pending sessions:", err);
  }
}, PENDING_SESSION_INTERVAL);

// Serve PUBLIC folder
app.use(express.static(path.join(__dirname, "public")));

// ─────────────────────────────────────────────
// STRIPE WEBHOOK (STEP 1 — RECEIVE ONLY)
// ─────────────────────────────────────────────
app.post(
  "/webhooks/stripe",
  bodyParser.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("❌ Webhook signature verification failed.", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // STEP 1 ONLY: Log the event type
    console.log("✅ Stripe Webhook Received:", event.type);

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        if (session.mode === "setup") {
          const customerId = session.customer;
          const setupIntentId = session.setup_intent;

          // Retrieve SetupIntent
          const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);

          const paymentMethodId = setupIntent.payment_method;

          // Get Firebase user via Stripe metadata (or fallback by stripeCustomerId)
          const customer = await stripe.customers.retrieve(customerId);
          let userId = customer.metadata.uid;

          if (!userId) {
            const byCamel = await db.collection("users")
              .where("stripeCustomerId", "==", customerId)
              .limit(1)
              .get();
            if (!byCamel.empty) {
              userId = byCamel.docs[0].id;
            }
          }

          if (!userId) {
            const bySnake = await db.collection("users")
              .where("stripe_customer_id", "==", customerId)
              .limit(1)
              .get();
            if (!bySnake.empty) {
              userId = bySnake.docs[0].id;
            }
          }

          if (!userId || !paymentMethodId) {
            console.error("Missing uid or payment method");
            break;
          }

          const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
          const card = pm.card || {};

          await db.collection("users").doc(userId).set({
            stripe_customer_id: customerId,
            stripe_default_payment_method: paymentMethodId,
            hasPaymentMethod: true,
            payment_brand: card.brand || null,
            payment_last4: card.last4 || null,
            payment_exp_month: card.exp_month || null,
            payment_exp_year: card.exp_year || null,
            payment_updated_at: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });

          console.log("✅ Payment method saved for user:", userId);
          break;
        }

        const { userId, eventId, spotId } = session.metadata;

        console.log("🧠 Phase 3: Finalizing reservation", {
          userId,
          eventId,
          spotId,
        });

        if (!userId || !eventId || !spotId) {
          console.error("❌ Missing metadata in checkout session", session.metadata);
          return;
        }

        const spotRef = db.collection("spots").doc(spotId);
        const reservationRef = db.collection("reservations").doc();

        await db.runTransaction(async (tx) => {
          // 1️⃣ READS (MUST COME FIRST)
          const spotSnap = await tx.get(spotRef);
          if (!spotSnap.exists) {
            throw new Error("Spot does not exist");
          }

          const spotData = spotSnap.data();

          if (!spotData.is_available) {
            throw new Error("Spot already reserved");
          }

          const eventRef = db.collection("events").doc(eventId);
          const eventSnap = await tx.get(eventRef);
          const eventData = eventSnap.exists ? eventSnap.data() : null;

          const venueRef = eventData?.venue_ref || null;
          const eventDate = eventData?.event_date || null;
          const venueSnap = venueRef ? await tx.get(venueRef) : null;
          const venueName = venueSnap?.data()?.name || "Venue";
          const eventName = eventData?.event_name || "Event";
          const spotLabel = spotData.spot_id || "SPOT";

          // Build reservation payload with display cache fields
          const reservationData = {
            user_id: db.collection("users").doc(userId),
            venue_id: venueRef,
            spot_ref: spotRef,
            event_ref: eventRef,

            // DISPLAY CACHE (schema-aligned)
            venue_name: venueName,
            event_name: eventName,
            start_time: eventDate,
            spot_label: spotLabel,

            price_paid: session.amount_total / 100,
            status: "confirmed",
            created_at: admin.firestore.FieldValue.serverTimestamp(),
          };

          if (session.id) reservationData.stripe_session_id = session.id;
          if (session.payment_intent) {
            reservationData.payment_intent = session.payment_intent;
          }

          // 2️⃣ WRITES (ONLY AFTER ALL READS)
          tx.update(spotRef, {
            is_available: false,
            reserved_by: db.collection("users").doc(userId),
            last_updated: admin.firestore.FieldValue.serverTimestamp(),
          });

          tx.set(reservationRef, reservationData);
        });

        console.log("✅ Reservation created & spot locked");
        break;
      }
      default:
        break;
    }

    res.json({ received: true });
  }
);
app.use(express.json());

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).send("ok");
});

// Keep-alive ping endpoint (Render)
app.get("/ping", (req, res) => {
  res.status(200).send("pong");
});

// Stripe success finalizer
app.get("/stripe/success", async (req, res) => {
  try {
    const sessionId = req.query.session_id;
    if (!sessionId) return res.status(400).send("Missing session ID");

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid") {
      return res.status(400).send("Payment not completed");
    }

    // TODO (next step): save reservation using session.metadata

    res.redirect(`${process.env.BASE_URL}/my-spots.html`);
  } catch (err) {
    console.error("Stripe success error:", err);
    res.status(500).send("Stripe success failed");
  }
});

// API endpoint for Urbiotica spot status
app.get("/api/spot/:id", async (req, res) => {
    try {
        const result = await getSpotStatus(req.params.id);

        res.json({
            spot: req.params.id,
            status: result.status,
            raw: result.raw
        });
    } catch (error) {
        console.error("Error fetching Urbiotica spot:", error);
        res.status(500).json({ error: "Failed to get spot status" });
    }
});

// Debug endpoint to inspect live AMQP cache
app.get("/api/debug/live-cache", (req, res) => {
    res.json(liveSpotCache);
});

// ─────────────────────────────────────────────
// REAL-TIME UPDATES → SSE STREAM
// ─────────────────────────────────────────────
app.get("/events/spot-updates", (req, res) => {
    console.log("📡 SSE client connected");

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Send current cache immediately
    res.write(`data: ${JSON.stringify(liveSpotCache)}\n\n`);

    // Listener for AMQP realtime events
    const handler = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    amqpEvents.on("spot-update", handler);

    // When client closes connection
    req.on("close", () => {
        console.log("❌ SSE client disconnected");
        amqpEvents.off("spot-update", handler);
    });
});

app.post("/start-metered-session", async (req, res) => {
    try {
        const { zone_id } = req.body;

        if (!zone_id) {
            return res.status(400).json({ error: "Missing zone_id" });
        }

        await db.doc(zone_id).update({
            is_available: false,
            last_updated: admin.firestore.FieldValue.serverTimestamp()
        });

        return res.json({ success: true });
    } catch (err) {
        console.error("Failed to start metered session:", err);
        return res.status(500).json({ error: "Failed to start session" });
    }
});

app.post("/api/parking/confirm-session", async (req, res) => {
    try {
        const { sessionId } = req.body;

        if (!sessionId) {
            return res.status(400).json({ error: "Missing sessionId" });
        }

        const sessionRef = db.collection("parking_sessions").doc(sessionId);
        const sessionSnap = await sessionRef.get();

        if (!sessionSnap.exists) {
            return res.status(200).json({ success: true });
        }

        const data = sessionSnap.data();
        if (data.status !== "PENDING") {
            return res.status(200).json({ success: true });
        }

        await sessionRef.update({
            status: "ACTIVE",
            activated_at: admin.firestore.FieldValue.serverTimestamp()
        });

        if (data.zone_id) {
            const zoneRef =
                typeof data.zone_id === "string" ? db.doc(data.zone_id) : data.zone_id;
            await zoneRef.update({
                is_available: false,
                last_updated: admin.firestore.FieldValue.serverTimestamp()
            });
        }

        return res.json({ success: true });
    } catch (err) {
        console.error("Failed to confirm parking session:", err);
        return res.status(500).json({ error: "Failed to confirm session" });
    }
});

app.post("/end-metered-session", async (req, res) => {
    try {
        const { session_id, zone_id } = req.body;

        if (!session_id || !zone_id) {
            return res.status(400).json({ error: "Missing session_id or zone_id" });
        }

        await db.collection("parking_sessions").doc(session_id).update({
            status: "COMPLETED",
            ended_at: admin.firestore.FieldValue.serverTimestamp()
        });

        const zoneRef = db.doc(zone_id);

        await zoneRef.update({
            is_available: true,
            last_updated: admin.firestore.FieldValue.serverTimestamp()
        });

        const pendingSnap = await db
            .collection("parking_sessions")
            .where("status", "==", "PENDING")
            .where("zone_id", "==", zoneRef)
            .get();

        for (const pendingDoc of pendingSnap.docs) {
            await pendingDoc.ref.delete();
        }

        return res.json({ success: true });
    } catch (err) {
        console.error("Failed to end metered session:", err);
        return res.status(500).json({ error: "Failed to end session" });
    }
});

// Admin: lock a metered spot
app.post("/api/lock-metered-spot", async (req, res) => {
    try {
        const { zoneDocId } = req.body;

        if (!zoneDocId) {
            return res.status(400).json({ error: "Missing zoneDocId" });
        }

        const zoneRef = admin
            .firestore()
            .collection("private_metered_parking")
            .doc(zoneDocId);

        await zoneRef.update({
            is_available: false,
            last_updated: admin.firestore.FieldValue.serverTimestamp()
        });

        return res.json({ success: true });
    } catch (err) {
        console.error("Failed to lock metered spot:", err);
        return res.status(500).json({ error: "Failed to lock spot" });
    }
});

// Create Stripe Checkout session
app.post("/create-checkout-session", async (req, res) => {
    try {
        const { eventId, spotId, price, userId } = req.body;

        if (!spotId || !price) {
            return res.status(400).json({ error: "Missing required data" });
        }

        const session = await stripe.checkout.sessions.create({
            mode: "payment",
            payment_method_types: ["card"],
            line_items: [
                {
                    price_data: {
                        currency: "usd",
                        product_data: {
                            name: "OpenSpots Parking Reservation",
                            description: `Spot ${spotId}`,
                        },
                        unit_amount: price * 100,
                    },
                    quantity: 1,
                },
            ],
            metadata: {
                userId: userId,
                spotId: spotId,
                eventId: eventId,
            },
            success_url: `${process.env.BASE_URL}/stripe/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.BASE_URL}/checkout.html?cancelled=true`,
        });

        res.json({ sessionId: session.id });
    } catch (error) {
        console.error("Stripe session error:", error);
        res.status(500).json({ error: "Failed to create checkout session" });
    }
});

// Create Stripe Setup session
app.post("/create-setup-session", async (req, res) => {
    try {
        const { uid, email, spot } = req.body;

        if (!uid || !email) {
            return res.status(400).json({ error: "Missing uid or email" });
        }

        // 1. Create or retrieve Stripe customer
        let customer;

        // Optional: look up user in Firestore if you already store stripeCustomerId
        const userSnap = await admin.firestore().collection("users").doc(uid).get();

        if (userSnap.exists && userSnap.data().stripeCustomerId) {
            customer = await stripe.customers.retrieve(
                userSnap.data().stripeCustomerId
            );
        } else {
            customer = await stripe.customers.create({
                email,
                metadata: { uid },
            });

            await admin.firestore().collection("users").doc(uid).update({
                stripeCustomerId: customer.id,
            });
        }

        // 2. Create Stripe Checkout session in SETUP mode
        const successUrl = spot
            ? `${process.env.BASE_URL}/payment-success.html?spot=${encodeURIComponent(spot)}`
            : `${process.env.BASE_URL}/payment-success.html`;
        const cancelUrl = spot
            ? `${process.env.BASE_URL}/add-payment.html?spot=${encodeURIComponent(spot)}`
            : `${process.env.BASE_URL}/add-payment.html`;

        const session = await stripe.checkout.sessions.create({
            mode: "setup",
            customer: customer.id,
            payment_method_types: ["card"],
            success_url: successUrl,
            cancel_url: cancelUrl,
        });

        res.json({ sessionId: session.id });
    } catch (err) {
        console.error("Setup session error:", err);
        res.status(500).json({ error: "Failed to create setup session" });
    }
});

app.listen(PORT, () => {
    console.log(`OpenSpots server running on port ${PORT}`);
});
