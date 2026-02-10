import "dotenv/config";
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import { getSpotStatus } from "./backend/spotStatus.js";
import { amqpEvents, liveSpotCache } from "./backend/amqpClient.js";
import { sendEmail, buildWelcomeEmail, buildPaymentMethodAddedEmail, buildParkingStartedEmail, buildParkingReceiptEmail, buildParkingCancelledEmail } from "./backend/email.js";
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
const SOCIALS = [
  { href: "mailto:support@openspots.app", img: "https://storage.googleapis.com/flutterflow-io-6f20.appspot.com/projects/open-spots-app-977ima/assets/bn5b41rovg31/badge_email.png", alt: "Email" },
  { href: "https://facebook.com/OpenSpotsApp", img: "https://storage.googleapis.com/flutterflow-io-6f20.appspot.com/projects/open-spots-app-977ima/assets/yp5p4pvic5zc/badge_facebok.png", alt: "Facebook" },
  { href: "https://instagram.com/openspotsapp", img: "https://storage.googleapis.com/flutterflow-io-6f20.appspot.com/projects/open-spots-app-977ima/assets/rtu0rbbejb8p/badge_instagram.png", alt: "Instagram" },
  { href: "https://twitter.com/openspotsapp", img: "https://storage.googleapis.com/flutterflow-io-6f20.appspot.com/projects/open-spots-app-977ima/assets/d6ltpc9lh02v/badge_X.png", alt: "X" },
  { href: "https://tiktok.com/@openspots", img: "https://storage.googleapis.com/flutterflow-io-6f20.appspot.com/projects/open-spots-app-977ima/assets/8ivm5hp3yq17/badge_tiktok.png", alt: "TikTok" },
  { href: "https://youtube.com/@openspotsapp", img: "https://storage.googleapis.com/flutterflow-io-6f20.appspot.com/projects/open-spots-app-977ima/assets/m1160f9479nf/badge_youtube.png", alt: "YouTube" },
];
const resolveUserFirstName = (user) =>
  user?.first_name ||
  user?.firstName ||
  user?.display_name ||
  user?.displayName ||
  "";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const ACTIVE_SESSION_INTERVAL = 60 * 1000; // 1 min
const PENDING_SESSION_INTERVAL = 1000; // 1 sec
const CONFIRM_WINDOW_MS = 30_000;

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
      if (elapsedMs < CONFIRM_WINDOW_MS) continue;

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
          // Send "payment method added" email
          try {
            const userSnap = await db.collection("users").doc(userId).get();
            const user = userSnap.exists ? userSnap.data() : {};
            const toEmail = user?.email || customer?.email; // fallback to Stripe customer email

            if (toEmail) {
              const email = buildPaymentMethodAddedEmail({
                firstName: resolveUserFirstName(user),
                appUrl: process.env.BASE_URL || "https://openspots.app",
                supportEmail: "support@openspots.app",
                cardBrand: card.brand || null,
                last4: card.last4 || null,
                expMonth: card.exp_month || null,
                expYear: card.exp_year || null,
                socials: SOCIALS
              });

              await sendEmail({ to: toEmail, subject: email.subject, html: email.html, text: email.text });
              console.log("✅ Payment method email sent:", toEmail);
            } else {
              console.log("⚠️ No email found for user; skipping payment method email");
            }
          } catch (e) {
            console.error("Payment method email failed:", e);
          }
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

app.get("/test-welcome-email", async (req, res) => {
  try {
    const email = buildWelcomeEmail({
      firstName: "Nemesio",
      appUrl: "https://openspots.app",
      supportEmail: "support@openspots.app",
    });

    await sendEmail({
      to: "openspotsapp@gmail.com",
      subject: email.subject,
      html: email.html,
      text: email.text,
    });

    res.send("Welcome email sent");
  } catch (err) {
    console.error(err);
    res.status(500).send("Welcome email failed");
  }
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

app.post("/api/parking/create-pending", async (req, res) => {
    try {
        const { zone_id, zone_number, user_id } = req.body;

        if (!zone_id || !zone_number || !user_id) {
            return res.status(400).json({ error: "Missing zone_id, zone_number, or user_id" });
        }

        const sessionRef = await db.collection("parking_sessions").add({
            status: "PENDING",
            pending_started_at: admin.firestore.FieldValue.serverTimestamp(),
            arrival_time: admin.firestore.FieldValue.serverTimestamp(),
            created_at: admin.firestore.FieldValue.serverTimestamp(),
            zone_id: db.doc(zone_id),
            zone_number,
            user_id: db.collection("users").doc(user_id)
        });

        return res.json({ sessionId: sessionRef.id });
    } catch (err) {
        console.error("Failed to create pending session:", err);
        return res.status(500).json({ error: "Failed to create pending session" });
    }
});

app.post("/api/send-welcome-email", async (req, res) => {
    try {
        const { uid } = req.body;
        if (!uid) return res.status(400).json({ error: "Missing uid" });

        const userSnap = await db.collection("users").doc(uid).get();
        if (!userSnap.exists) {
            return res.status(404).json({ error: "User not found" });
        }

        const user = userSnap.data();
        if (!user.email) {
            return res.status(400).json({ error: "User has no email" });
        }

        const email = buildWelcomeEmail({
            firstName: resolveUserFirstName(user),
            appUrl: process.env.BASE_URL || "https://openspots.app",
            supportEmail: "support@openspots.app"
        });

        await sendEmail({
            to: user.email,
            subject: email.subject,
            html: email.html,
            text: email.text
        });

        console.log("✅ Welcome email sent to:", user.email);
        res.json({ success: true });
    } catch (err) {
        console.error("Welcome email error:", err);
        res.status(500).json({ error: "Failed to send welcome email" });
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

        let zoneData = {};
        if (data.zone_id) {
            const zoneRef =
                typeof data.zone_id === "string" ? db.doc(data.zone_id) : data.zone_id;
            const zoneSnap = await zoneRef.get();
            if (zoneSnap.exists) {
                zoneData = zoneSnap.data() || {};
            }
        }

        const ratePerMinute =
            typeof zoneData.rate_per_hour === "number"
                ? Number((zoneData.rate_per_hour / 60).toFixed(6))
                : 0;

        await sessionRef.update({
            status: "ACTIVE",
            activated_at: admin.firestore.FieldValue.serverTimestamp(),
            rate_per_minute: ratePerMinute,
            regulation_type: zoneData.regulation_type,
            sensor_id: data.zone_number,
            payment_method: "MOBILE",
            price_charged: 0,
            total_minutes: 0
        });

        if (data.zone_id) {
            const zoneRef =
                typeof data.zone_id === "string" ? db.doc(data.zone_id) : data.zone_id;
            await zoneRef.update({
                is_available: false,
                last_updated: admin.firestore.FieldValue.serverTimestamp()
            });
        }

        // Send "parking started" email
        try {
            const userRef = data.user_id; // users/<uid> doc ref
            const userSnap = userRef ? await userRef.get() : null;
            const user = userSnap?.exists ? userSnap.data() : {};
            const toEmail = user?.email;

            if (toEmail) {
                const email = buildParkingStartedEmail({
                    firstName: resolveUserFirstName(user),
                    supportEmail: "support@openspots.app",
                    appUrl: process.env.BASE_URL || "https://openspots.app",
                    zoneNumber: data.zone_number,
                    startedAt: "Just now",
                    ratePerHour: zoneData?.rate_per_hour,
                    socials: SOCIALS
                });

                await sendEmail({ to: toEmail, subject: email.subject, html: email.html, text: email.text });
                console.log("✅ Parking started email sent:", toEmail);
            }
        } catch (e) {
            console.error("Parking started email failed:", e);
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

        // Send receipt email
        try {
            const sessionSnap = await db.collection("parking_sessions").doc(session_id).get();
            const s = sessionSnap.exists ? sessionSnap.data() : null;

            if (s?.user_id) {
                const userSnap = await s.user_id.get();
                const user = userSnap.exists ? userSnap.data() : {};
                const toEmail = user?.email;

                if (toEmail) {
                    const email = buildParkingReceiptEmail({
                        firstName: resolveUserFirstName(user),
                        supportEmail: "support@openspots.app",
                        appUrl: process.env.BASE_URL || "https://openspots.app",
                        zoneNumber: s.zone_number,
                        startTime: s.arrival_time?.toDate?.().toLocaleString?.() || "",
                        endTime: new Date().toLocaleString(),
                        totalMinutes: s.total_minutes,
                        totalAmount: s.price_charged,
                        socials: SOCIALS
                    });

                    await sendEmail({ to: toEmail, subject: email.subject, html: email.html, text: email.text });
                    console.log("✅ Receipt email sent:", toEmail);
                }
            }
        } catch (e) {
            console.error("Receipt email failed:", e);
        }

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
