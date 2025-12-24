import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request }) => {
  const POSTMARK_SERVER_TOKEN = import.meta.env.POSTMARK_SERVER_TOKEN;
  const EMAIL_FROM = import.meta.env.EMAIL_FROM || 'website@hazardcleanup.ca';
  const EMAIL_TO = import.meta.env.EMAIL_TO || 'help@hazardcleanup.ca';
  const TURNSTILE_SECRET = import.meta.env.TURNSTILE_SECRET;

  // Check for required env vars
  if (!POSTMARK_SERVER_TOKEN) {
    console.error('Missing POSTMARK_SERVER_TOKEN');
    return new Response(
      JSON.stringify({ ok: false, error: 'server_misconfigured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await request.json();
    const { name, phone, email, service, description, website, turnstileToken } = body;

    // Honeypot check - bots fill this hidden field
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

    // Verify Turnstile token (if secret is configured)
    if (TURNSTILE_SECRET && turnstileToken) {
      const turnstileRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: TURNSTILE_SECRET,
          response: turnstileToken,
        }),
      });
      const turnstileData = await turnstileRes.json();
      
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
        JSON.stringify({ ok: false, error: 'email_failed' }),
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