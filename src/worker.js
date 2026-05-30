export default {
  async fetch(request, env) {
    let response = await env.ASSETS.fetch(request);

    // SPA fallback: unknown paths serve index.html so client-side routing handles them
    if (response.status === 404) {
      const indexUrl = new URL('/index.html', request.url);
      response = await env.ASSETS.fetch(new Request(indexUrl, request));
    }

    const res = new Response(response.body, response);
    res.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    res.headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
    return res;
  },
};
