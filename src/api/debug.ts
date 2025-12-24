import type { APIRoute } from 'astro';

export const GET: APIRoute = async (context) => {
  const locals = context.locals as any;
  
  return new Response(JSON.stringify({
    hasLocals: !!locals,
    localsKeys: Object.keys(locals || {}),
    hasRuntime: !!locals?.runtime,
    runtimeKeys: Object.keys(locals?.runtime || {}),
    hasEnv: !!locals?.runtime?.env,
    envKeys: Object.keys(locals?.runtime?.env || {}),
    // Check if specific var exists (without exposing value)
    hasPostmarkToken: !!locals?.runtime?.env?.POSTMARK_SERVER_TOKEN,
  }, null, 2), {
    headers: { 'Content-Type': 'application/json' }
  });
};