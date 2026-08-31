// /pay/lava — where a Russian-speaking buyer starts.
//
// Stripe collects the email on its own hosted page. Lava doesn't: its API wants
// the email up front, in exchange for a payment URL. So there's a small form
// here that Stripe's flow doesn't need.
//
// That's not purely a cost. We learn the address before she pays, so someone
// who abandons checkout is still someone you could follow up with.
//
// In Russian, because that's who this route is for. The course itself is in
// English and the page says so — better she knows before paying than after.

import { createInvoice, lavaCheckoutReady } from '../_lib/lava.js';
import { catalog, support } from '../_lib/catalog.js';
import { normalizeEmail } from '../_lib/access.js';
import { pendingPurchaseCookie } from '../_lib/session.js';
import { shell, html, escapeHtml, supportBlock } from '../_lib/render.js';

// She picks how she pays before she leaves the site, because Lava can't offer
// the choice afterwards: the provider is fixed when the invoice is created.
// Cards go through Lava's rouble default, SMART_GLOCAL; СБП runs on PAY2ME and
// must be requested by name. Both were verified against the live API.

/** The offer id, from config — overridable so tests can point at a stand-in. */
function offerId(env) {
  return env.LAVA_OFFER_ID || catalog.lava.offerId;
}

export function onRequestGet({ env }) {
  if (!lavaCheckoutReady(env, { offerId: offerId(env) })) return html(unavailablePage());
  return html(formPage(undefined, env));
}

export async function onRequestPost({ request, env }) {
  if (!lavaCheckoutReady(env, { offerId: offerId(env) })) return html(unavailablePage());

  const form = await request.formData();
  const email = normalizeEmail(form.get('email'));
  // Which button she pressed. Anything unexpected falls back to a card.
  const method = form.get('method') === 'sbp' ? 'sbp' : 'card';

  if (!email.includes('@')) {
    return html(formPage({ error: 'Проверьте адрес — кажется, в нём опечатка.', email }, env));
  }

  const origin = new URL(request.url).origin;

  let invoice;
  try {
    invoice = await createInvoice(env, {
      email,
      offerId: offerId(env),
      currency: catalog.lava.currency,
      method,
      returnUrls: {
        // Lava takes these at creation time, before it tells us the contract
        // id, so the id can't be in the URL. It travels in a signed cookie
        // instead — see below.
        success: `${origin}/pay/complete`,
        failure: `${origin}/pay/lava?failed=1`,
        cancel: `${origin}/`,
      },
    });
  } catch (err) {
    console.error('lava: could not create an invoice:', err.message);
    const refusedEmail = err.status === 400 && /email/i.test(err.lavaError || '');
    return html(formPage({ error: refusedEmail ? EMAIL_REFUSED : CREATE_FAILED, email }, env));
  }

  // A free product (a 100% promo code, say) has nothing to pay, so skip
  // straight to the confirmation.
  const next = invoice.paymentUrl || `${origin}/pay/complete`;

  return new Response(null, {
    status: 302,
    headers: {
      Location: next,
      'Set-Cookie': await pendingPurchaseCookie(env.SESSION_SECRET, invoice.id, request.url),
    },
  });
}

// ---------- Pages ----------

function formPage({ error, email = '' } = {}, env = {}) {
  const price = env.LAVA_PRICE_LABEL || catalog.lava.priceLabel;

  const content = `
    <section class="auth">
      <p class="eyebrow">Оплата в рублях</p>
      <h1>The Dating Method</h1>
      <p class="auth__lead">
        ${price ? `<strong>${escapeHtml(price)}</strong> — картой российского банка или через СБП.` : 'Оплата картой российского банка или через СБП.'}
      </p>

      <form class="auth__form" method="POST" action="/pay/lava">
        <label class="auth__label" for="email">Ваш email</label>
        <input class="auth__input" id="email" name="email" type="email"
               autocomplete="email" inputmode="email" required autofocus
               value="${escapeHtml(email)}" placeholder="you@example.com" />
        <p class="account__hint">
          Доступ к курсу привяжется к этому адресу — на него же будут приходить
          коды для входа. Проверьте, что он написан верно.
        </p>
        ${error ? `<p class="auth__error" role="alert">${escapeHtml(error)}</p>` : ''}
        <button class="btn btn--primary auth__submit" type="submit" name="method" value="card">
          Оплатить картой
        </button>
        <button class="btn btn--ghost auth__submit" type="submit" name="method" value="sbp">
          Оплатить через СБП
        </button>
      </form>

      <div class="account__block">
        <p class="account__hint">
          <strong>Курс на английском языке.</strong> Видео и материалы — на
          английском; оплата и письма — на русском.
        </p>
      </div>

      ${supportBlock('Вопросы?')}
    </section>`;

  return shell({ title: 'Оплата', content, sidebar: false, bare: true });
}

function unavailablePage() {
  const content = `
    <section class="auth">
      <p class="eyebrow">Оплата в рублях</p>
      <h1>Скоро</h1>
      <p class="auth__lead">
        Оплата в рублях пока настраивается. Напишите мне — открою доступ вручную.
      </p>
      <a class="btn btn--primary auth__submit" href="mailto:${escapeHtml(support.email)}">
        ${escapeHtml(support.email)}
      </a>
    </section>`;

  return shell({ title: 'Оплата', content, sidebar: false, bare: true });
}

const CREATE_FAILED =
  'Не получилось создать счёт. Попробуйте ещё раз через минуту — а если не ' +
  'выйдет, напишите мне, и я всё сделаю вручную.';

// Retrying with the same address will fail exactly the same way, so this says
// what to change instead of asking her to wait.
const EMAIL_REFUSED =
  'lava.top не принимает этот адрес для оплаты. Попробуйте другой email — ' +
  'доступ к курсу привяжется к тому, который сработает. Если не получится, ' +
  'напишите мне, и я всё сделаю вручную.';
