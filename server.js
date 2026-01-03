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

// Serve PUBLIC folder
app.use(express.static(path.join(__dirname, "public")));

// ─────────────────────────────────────────────
// STRIPE WEBHOOK (STEP 1 — RECEIVE ONLY)
// ─────────────────────────────────────────────
app.post(
  "/webhook",
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
            success_url: `${process.env.BASE_URL}/my-spots.html?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.BASE_URL}/checkout.html?cancelled=true`,
        });

        res.json({ sessionId: session.id });
    } catch (error) {
        console.error("Stripe session error:", error);
        res.status(500).json({ error: "Failed to create checkout session" });
    }
});

app.listen(PORT, () => {
    console.log(`OpenSpots server running on port ${PORT}`);
});
