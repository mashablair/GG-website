// /pay/complete — where Lava sends her back after paying.
//
// The Russian-language twin of /welcome. Same shape, same guarantees: verify
// with the provider, grant, sign in, and never depend on the webhook having
// arrived first. Whichever gets here first creates the enrollment; grantAccess()
// makes the other a no-op.
//
// The contract id arrives in a signed cookie rather than the URL, because Lava
// wants its return URLs before it will tell us the id.

import { fetchInvoice, invoiceConfirms } from '../_lib/lava.js';
import { grantAccess, redeemForLogin } from '../_lib/access.js';
import { courseForLavaProduct, catalog } from '../_lib/catalog.js';
import {
  readPendingPurchase,
  clearPendingPurchaseCookie,
  createSession,
  sessionCookie,
  createDeviceToken,
  deviceCookie,
} from '../_lib/session.js';
import { shell, html, escapeHtml, supportBlock } from '../_lib/render.js';

export async function onRequestGet({ request, env }) {
  const contractId = await readPendingPurchase(env.SESSION_SECRET, request);
  if (!contractId) return page('Спасибо за покупку', NO_CONTRACT);

  let invoice;
  try {
    invoice = await fetchInvoice(env, contractId);
  } catch (err) {
    console.error('pay/complete: could not reach Lava:', err.message);
    return page('Оплата прошла', LAVA_UNREACHABLE);
  }

  const email = invoice?.buyer?.email;
  if (!invoiceConfirms(invoice, email)) {
    // Cards through Lava can settle a moment after the buyer is redirected
    // back, so "not COMPLETED yet" is normal rather than alarming. The webhook
    // will finish the job; she just signs in when it does.
    console.log(
      `pay/complete: contract ${contractId} is ${invoice?.status ?? 'unknown'} — not granting yet`
    );
    return page('Оплата обрабатывается', STILL_SETTLING);
  }

  // Which course — the invoice doesn't carry a product id, so fall back to the
  // single course this checkout sells.
  const courseSlug =
    courseForLavaProduct(catalog.lava.productId) || catalog.defaultCourse;

  const { studentId } = await grantAccess(env.DB, {
    email,
    firstName: null,
    courseSlug,
    provider: 'lava',
    externalId: contractId,
    amountCents: Math.round(Number(invoice.receipt?.amount ?? 0) * 100) || null,
    currency: String(invoice.receipt?.currency || 'RUB').toLowerCase(),
  });

  const firstVisit = await redeemForLogin(env.DB, 'lava', contractId);

  const body = successPage({ email, firstVisit });
  const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8' });
  headers.append('Set-Cookie', clearPendingPurchaseCookie(request.url));

  if (firstVisit) {
    headers.append(
      'Set-Cookie',
      sessionCookie(await createSession(env.SESSION_SECRET, studentId), request.url)
    );
    headers.append(
      'Set-Cookie',
      deviceCookie(await createDeviceToken(env.SESSION_SECRET, studentId), request.url)
    );
  }

  return new Response(body, { headers });
}

// ---------- Pages ----------

function successPage({ email, firstVisit }) {
  const content = `
    <section class="welcome">
      <div class="welcome__mark" aria-hidden="true">🐆</div>
      <p class="eyebrow">Оплата получена</p>
      <h1>Добро пожаловать</h1>
      <p class="welcome__lead">
        Курс ваш. Всё готово — можно начинать.
      </p>

      <div class="welcome__card">
        <p class="welcome__label">Доступ привязан к адресу</p>
        <p class="welcome__email">${escapeHtml(email)}</p>
        <p class="welcome__note">
          Заходите с этого адреса с любого устройства. Пароля нет — мы присылаем
          код на почту.
        </p>
      </div>

      <a class="btn btn--primary welcome__cta" href="/dashboard">Начать курс 🐆</a>

      ${
        firstVisit
          ? ''
          : `<p class="welcome__reused">
               Эта ссылка уже открывалась, поэтому мы не входим повторно — так
               безопаснее. Нажмите <a href="/login">войти</a>, чтобы вернуться к
               урокам.
             </p>`
      }

      <div class="account__block">
        <p class="account__hint">
          <strong>Курс на английском языке.</strong>
        </p>
      </div>

      ${supportBlock('Что-то не так?')}
    </section>`;

  return shell({ title: 'Добро пожаловать', content, sidebar: false, bare: true });
}

function page(heading, body) {
  const content = `
    <section class="welcome">
      <p class="eyebrow">Ваша покупка</p>
      <h1>${escapeHtml(heading)}</h1>
      <div class="welcome__lead">${body}</div>
      <a class="btn btn--primary welcome__cta" href="/login">Войти</a>
      ${supportBlock('Нужна помощь?')}
    </section>`;

  return html(shell({ title: heading, content, sidebar: false, bare: true }));
}

const NO_CONTRACT = `
  <p>Если вы уже оплатили курс, войдите с тем адресом, который указали при
  оплате — и попадёте прямо к урокам.</p>`;

const LAVA_UNREACHABLE = `
  <p>Деньги получены, но открыть доступ прямо сейчас не вышло. Ничего не
  потеряно: подождите пару минут и войдите с тем адресом, который указали при
  оплате.</p>`;

const STILL_SETTLING = `
  <p>Платёж ещё обрабатывается — у банков это иногда занимает минуту-другую.
  Доступ откроется автоматически.</p>
  <p>Подождите немного и войдите с тем адресом, который указали при оплате.
  Повторно платить не нужно.</p>`;
