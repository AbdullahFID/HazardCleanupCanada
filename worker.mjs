// worker.mjs — serves static assets from /dist and handles /api/contact
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/contact") return handleContact(request, env);
    return env.ASSETS.fetch(request); // serve your Astro build
  },
};

function json(obj, status = 200, allowOrigin = "*") {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": allowOrigin,
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}

async function handleContact(request, env) {
  const origin = request.headers.get("Origin") || "";
  let allowOrigin = "*";
  try {
    const host = new URL(origin).hostname;
    if (/(^|\.)hazardcleanup\.ca$/i.test(host)) allowOrigin = origin;
  } catch {}

  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": allowOrigin,
        "access-control-allow-methods": "POST,OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "86400",
      },
    });
  }
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { "access-control-allow-origin": allowOrigin },
    });
  }

  // --- Parse body
  let body;
  try { body = await request.json(); }
  catch { return json({ ok:false, error:"invalid_json" }, 400, allowOrigin); }

  const {
    name = "", phone = "", email = "", service = "", description = "",
    website = "", turnstileToken = "",
  } = body;

  // Honeypot / basic fields
  if (website) return json({ ok:true }, 200, allowOrigin);
  if (!name.trim() || !phone.trim())
    return json({ ok:false, error:"missing_fields" }, 400, allowOrigin);

  // --- Required envs (fail fast)
  const missing = [];
  if (!env.TURNSTILE_SECRET_KEY) missing.push("TURNSTILE_SECRET_KEY");
  if (!env.POSTMARK_SERVER_TOKEN) missing.push("POSTMARK_SERVER_TOKEN");
  if (!env.EMAIL_FROM)           missing.push("EMAIL_FROM");
  if (!env.EMAIL_TO)             missing.push("EMAIL_TO");
  if (missing.length) {
    console.error("Missing env:", missing.join(", "));
    return json({ ok:false, error:"server_misconfigured" }, 500, allowOrigin);
  }

  // --- Turnstile verify
  try {
    const vr = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET_KEY,
        response: turnstileToken,
        remoteip: request.headers.get("CF-Connecting-IP") || "",
      }),
    }).then(r => r.json());
    if (!vr?.success) return json({ ok:false, error:"turnstile_failed" }, 400, allowOrigin);
  } catch (err) {
    console.error("Turnstile error", err);
    return json({ ok:false, error:"turnstile_error" }, 400, allowOrigin);
  }

  // --- Compose message
  const textBody = `Emergency Cleanup Request

Name: ${name}
Phone: ${phone}
Email: ${email || "Not provided"}
Service: ${service || "Not specified"}

Description:
${(description || "No additional details provided").slice(0, 4000)}

IP: ${request.headers.get("CF-Connecting-IP") || "n/a"}
Submitted: ${new Date().toLocaleString("en-CA", { timeZone: "America/Toronto" })}
`;

  // --- Send via Postmark
  let pmResp, pmJson = null;
  try {
    pmResp = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-postmark-server-token": env.POSTMARK_SERVER_TOKEN,
      },
      body: JSON.stringify({
        From: env.EMAIL_FROM,                  // MUST be a verified sender/signature on this Server
        To: env.EMAIL_TO,
        Subject: `Emergency Cleanup Request - ${name}`,
        TextBody: textBody,
        MessageStream: env.POSTMARK_MESSAGE_STREAM || "outbound",
        ReplyTo: email || undefined,
        Metadata: { service: service || "unknown" },
      }),
    });

    // Always parse JSON; Postmark includes details in body
    const text = await pmResp.text();
    try { pmJson = text ? JSON.parse(text) : null; } catch { pmJson = { raw: text }; }

    // Decide success: both HTTP ok and ErrorCode === 0
    const accepted = pmResp.ok && pmJson && pmJson.ErrorCode === 0;

    if (!accepted) {
      console.error("Postmark not accepted", {
        status: pmResp.status,
        json: pmJson,
      });

      // Strict mode: surface a failure to the client
      if (env.STRICT_CONTACT === "1") {
        return json({ ok:false, error:"postmark_rejected", details: pmJson }, 502, allowOrigin);
      }
      // Non-strict: mask to client, but log server-side
    } else {
      // Success — keep MessageID for traceability
      console.log("Postmark accepted", { messageId: pmJson.MessageID });
    }
  } catch (e) {
    console.error("Postmark fetch error", e);
    if (env.STRICT_CONTACT === "1") {
      return json({ ok:false, error:"postmark_fetch_error" }, 502, allowOrigin);
    }
  }

  // Final response
  return json({ ok:true }, 200, allowOrigin);
}
