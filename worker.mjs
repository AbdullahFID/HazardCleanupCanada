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

  let body;
  try { body = await request.json(); }
  catch { return json({ ok:false, error:"invalid_json" }, 400, allowOrigin); }

  const {
    name = "", phone = "", email = "", service = "", description = "",
    website = "", turnstileToken = "",
  } = body;

  if (website) return json({ ok:true }, 200, allowOrigin);               // honeypot
  if (!name.trim() || !phone.trim()) return json({ ok:false, error:"missing_fields" }, 400, allowOrigin);

  // Turnstile
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
    if (!vr.success) return json({ ok:false, error:"turnstile_failed" }, 400, allowOrigin);
  } catch {
    return json({ ok:false, error:"turnstile_error" }, 400, allowOrigin);
  }

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

  try {
    const pm = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": env.POSTMARK_SERVER_TOKEN,
      },
      body: JSON.stringify({
        From: env.EMAIL_FROM,
        To: env.EMAIL_TO,
        Subject: `Emergency Cleanup Request - ${name}`,
        TextBody: textBody,
        MessageStream: env.POSTMARK_MESSAGE_STREAM || "outbound",
        ReplyTo: email || undefined,
        Metadata: { service: service || "unknown" },
      }),
    });
    if (!pm.ok) console.error("Postmark error", pm.status, await pm.text());
  } catch (e) {
    console.error("Postmark fetch error", e);
  }

  return json({ ok:true }, 200, allowOrigin);
}
