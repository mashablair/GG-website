// /logout — end the session.
//
//   /logout            ends the session, keeps this browser trusted, so coming
//                      back is one tap
//   /logout?everywhere ends the session and forgets the browser entirely, so
//                      the next person needs a code
//
// The second is what someone on a shared or borrowed computer wants. The first
// is what almost everyone else wants, which is why it's the default.

import { clearSessionCookie, clearDeviceCookie } from './_lib/session.js';

export function onRequestGet({ request }) {
  const everywhere = new URL(request.url).searchParams.has('everywhere');

  const headers = new Headers({ Location: everywhere ? '/login' : '/' });
  headers.append('Set-Cookie', clearSessionCookie(request.url));

  if (everywhere) headers.append('Set-Cookie', clearDeviceCookie(request.url));

  return new Response(null, { status: 302, headers });
}
