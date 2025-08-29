// /functions/api/contact.js  (Cloudflare Pages Function)
function json(obj, status = 200, allowOrigin = '*') {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': allowOrigin,
      'access-control-allow-methods': 'POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });
}

async function handler(request, env) {
  const origin = request.headers.get('Origin') || '';
  let allowOrigin = '*';
  try {
    const host = new URL(origin).hostname;
    if (/(^|\.)hazardcleanup\.ca$/i.test(host)) allowOrigin = origin;
  } catch {}

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': allowOrigin,
        'access-control-allow-methods': 'POST,OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '86400',
      },
    });
  }

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { 'access-control-allow-origin': allowOrigin },
    });
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ ok:false, error:'invalid_json' }, 400, allowOrigin); }

  const {
    name='', phone='', email='', service='', description='',
    website='',        // honeypot
    turnstileToken='', // from client
  } = body;

  // Honeypot → pretend success
  if (website) return json({ ok:true }, 200, allowOrigin);
  if (!name.trim() || !phone.trim()) {
    return json({ ok:false, error:'missing_fields' }, 400, allowOrigin);
  }

  // Verify Turnstile
  try {
    const verifyResp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method:'POST',
      headers:{ 'content-type':'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET_KEY,
        response: turnstileToken,
        remoteip: request.headers.get('CF-Connecting-IP') || '',
      }),
    });
    const verify = await verifyResp.json();
    if (!verify.success) return json({ ok:false, error:'turnstile_failed' }, 400, allowOrigin);
  } catch {
    return json({ ok:false, error:'turnstile_error' }, 400, allowOrigin);
  }

  // Compose email
  const textBody = `Emergency Cleanup Request

Name: ${name}
Phone: ${phone}
Email: ${email || 'Not provided'}
Service: ${service || 'Not specified'}

Description:
${(description || 'No additional details provided').slice(0, 4000)}

IP: ${request.headers.get('CF-Connecting-IP') || 'n/a'}
Submitted: ${new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' })}
`;

  // Send via Postmark
  try {
    const pm = await fetch('https://api.postmarkapp.com/email', {
      method:'POST',
      headers:{
        'Accept':'application/json',
        'Content-Type':'application/json',
        'X-Postmark-Server-Token': env.POSTMARK_SERVER_TOKEN,
      },
      body: JSON.stringify({
        From: env.EMAIL_FROM,   // e.g. website@hazardcleanup.ca
        To:   env.EMAIL_TO,     // e.g. help@hazardcleanup.ca
        Subject: `Emergency Cleanup Request - ${name}`,
        TextBody: textBody,
        MessageStream: env.POSTMARK_MESSAGE_STREAM || 'outbound',
        ReplyTo: email || undefined,
        Metadata: { service: service || 'unknown' },
      }),
    });
    if (!pm.ok) {
      const err = await pm.text();
      console.error('Postmark error', pm.status, err);
    }
  } catch (e) {
    console.error('Postmark fetch error', e);
  }

  return json({ ok:true }, 200, allowOrigin);
}

export async function onRequestPost({ request, env }) {
  return handler(request, env);
}
export async function onRequestOptions({ request }) {
  return handler(request, {});
}
