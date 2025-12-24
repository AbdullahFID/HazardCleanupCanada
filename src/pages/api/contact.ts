import type { APIRoute } from 'astro';

export const POST: APIRoute = async (context) => {
  // Try multiple ways to access env vars (Cloudflare Pages compatibility)
  let POSTMARK_SERVER_TOKEN: string | undefined;
  let EMAIL_FROM: string | undefined;
  let EMAIL_TO: string | undefined;
  let TURNSTILE_SECRET: string | undefined;

  // Method 1: Cloudflare runtime (context.locals.runtime.env)
  try {
    const runtime = (context.locals as any)?.runtime;
    if (runtime?.env) {
      POSTMARK_SERVER_TOKEN = runtime.env.POSTMARK_SERVER_TOKEN;
      EMAIL_FROM = runtime.env.EMAIL_FROM;
      EMAIL_TO = runtime.env.EMAIL_TO;
      TURNSTILE_SECRET = runtime.env.TURNSTILE_SECRET;
    }
  } catch (e) {
    console.error('Failed to access runtime.env:', e);
  }

  // Method 2: Direct context.locals (some adapter versions)
  if (!POSTMARK_SERVER_TOKEN) {
    try {
      const locals = context.locals as any;
      POSTMARK_SERVER_TOKEN = locals?.POSTMARK_SERVER_TOKEN;
      EMAIL_FROM = locals?.EMAIL_FROM;
      EMAIL_TO = locals?.EMAIL_TO;
      TURNSTILE_SECRET = locals?.TURNSTILE_SECRET;
    } catch (e) {
      console.error('Failed to access locals directly:', e);
    }
  }

  // Method 3: import.meta.env (build-time, fallback)
  if (!POSTMARK_SERVER_TOKEN) {
    POSTMARK_SERVER_TOKEN = import.meta.env.POSTMARK_SERVER_TOKEN;
    EMAIL_FROM = import.meta.env.EMAIL_FROM;
    EMAIL_TO = import.meta.env.EMAIL_TO;
    TURNSTILE_SECRET = import.meta.env.TURNSTILE_SECRET;
  }

  // Method 4: process.env (Node adapter fallback)
  if (!POSTMARK_SERVER_TOKEN && typeof process !== 'undefined') {
    POSTMARK_SERVER_TOKEN = process.env.POSTMARK_SERVER_TOKEN;
    EMAIL_FROM = process.env.EMAIL_FROM;
    EMAIL_TO = process.env.EMAIL_TO;
    TURNSTILE_SECRET = process.env.TURNSTILE_SECRET;
  }

  // Set defaults
  EMAIL_FROM = EMAIL_FROM || 'website@hazardcleanup.ca';
  EMAIL_TO = EMAIL_TO || 'help@hazardcleanup.ca';

  // Debug: Log what we found (remove in production)
  console.log('ENV DEBUG:', {
    hasToken: !!POSTMARK_SERVER_TOKEN,
    tokenLength: POSTMARK_SERVER_TOKEN?.length,
    emailFrom: EMAIL_FROM,
    emailTo: EMAIL_TO,
    hasTurnstile: !!TURNSTILE_SECRET,
    localsKeys: Object.keys(context.locals || {}),
    runtimeKeys: Object.keys((context.locals as any)?.runtime || {}),
  });

  // Check for required env vars
  if (!POSTMARK_SERVER_TOKEN) {
    console.error('Missing POSTMARK_SERVER_TOKEN - none of the access methods worked');
    return new Response(
      JSON.stringify({ 
        ok: false, 
        error: 'server_misconfigured',
        debug: {
          localsKeys: Object.keys(context.locals || {}),
          hasRuntime: !!(context.locals as any)?.runtime,
        }
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await context.request.json();
    const { name, phone, email, service, description, website, turnstileToken } = body;

    // Honeypot check
    if (website) {
      return new Response(
        JSON.stringify({ ok: true }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate required fields
    if (!name || !phone) {
      return new Response(
        JSON.stringify({ ok: false, error: 'missing_fields' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify Turnstile token
    if (TURNSTILE_SECRET && turnstileToken) {
      const turnstileRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: TURNSTILE_SECRET,
          response: turnstileToken,
        }),
      });
      const turnstileData = await turnstileRes.json() as { success: boolean };
      
      if (!turnstileData.success) {
        return new Response(
          JSON.stringify({ ok: false, error: 'turnstile_failed' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // Send email via Postmark
    const emailRes = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': POSTMARK_SERVER_TOKEN,
      },
      body: JSON.stringify({
        From: EMAIL_FROM,
        To: EMAIL_TO,
        Subject: `🚨 Emergency Cleanup Request - ${name}`,
        HtmlBody: `
          <h2>New Emergency Cleanup Request</h2>
          <table style="border-collapse: collapse; width: 100%; max-width: 600px;">
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Name:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${name}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Phone:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;"><a href="tel:${phone}">${phone}</a></td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Email:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${email || 'Not provided'}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Service:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${service || 'Not specified'}</td></tr>
          </table>
          <h3>Description:</h3>
          <p style="background: #f5f5f5; padding: 12px; border-radius: 4px;">${description || 'No additional details provided'}</p>
          <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;">
          <p style="color: #666; font-size: 12px;">Submitted: ${new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' })}</p>
        `,
        TextBody: `
Emergency Cleanup Request

Name: ${name}
Phone: ${phone}
Email: ${email || 'Not provided'}
Service: ${service || 'Not specified'}

Description:
${description || 'No additional details provided'}

Submitted: ${new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' })}
        `,
        MessageStream: 'outbound',
      }),
    });

    if (!emailRes.ok) {
      const errorData = await emailRes.json();
      console.error('Postmark error:', errorData);
      return new Response(
        JSON.stringify({ ok: false, error: 'email_failed', details: errorData }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Contact API error:', error);
    return new Response(
      JSON.stringify({ ok: false, error: 'server_error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};