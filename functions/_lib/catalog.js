// ============================================
// THE CATALOG — everything Maria sells
// ============================================
//
// One entry per product. A product is either:
//
//   type: 'course'   has modules and lessons, lives at /learn/<slug>, and
//                    shows a progress bar on the dashboard
//   type: 'service'  something delivered in person — a consultation. It shows
//                    on her dashboard as "you bought this", but there is
//                    nothing to log into. It must never unlock a course.
//
// ADDING A COURSE
//   1. Write functions/_lib/courses/<name>.js (copy dating.js)
//   2. Import it below and add one entry to `products`
//   3. Add its Stripe price id and Lava product id to the maps at the bottom
//
// That's the whole job. Routing, the gate, the dashboard, progress and the
// account page all read from this file, so nothing else needs touching.

import { datingCourse, datingResources } from './courses/dating.js';

export const products = {
  dating: {
    slug: 'dating',
    type: 'course',
    title: datingCourse.title,
    tagline: datingCourse.tagline,
    content: datingCourse,
    resources: datingResources,
    // Where someone who doesn't own it yet is sent to buy. Used on the
    // dashboard, so a student who has one course can find the others.
    salesUrl: '/',
  },

  // The $97 call. Recorded so it appears on her dashboard alongside her
  // courses — there's simply nothing to open.
  'consult-60': {
    slug: 'consult-60',
    type: 'service',
    title: 'Private 1:1 Video Consultation',
    tagline: 'A private video call with Maria.',
    salesUrl: 'https://mariablair.com/consultations',
  },
};

// ---------- Looking things up ----------

/** The product record for a slug, or null. */
export function getProduct(slug) {
  return products[slug] || null;
}

/** True only for things with lessons to log into. */
export function isCourse(slug) {
  return getProduct(slug)?.type === 'course';
}

/**
 * The teachable content for a slug — modules, lessons — or null.
 * Returns null for services, which is what keeps a consultation from ever
 * being treated as something to open.
 */
export function getCourse(slug) {
  const product = getProduct(slug);
  return product?.type === 'course' ? product.content : null;
}

/** Downloads for a course. */
export function getResources(slug) {
  return getProduct(slug)?.resources || [];
}

/** What to call a slug on screen. Falls back to the slug so nothing is blank. */
export function productTitle(slug) {
  return getProduct(slug)?.title || slug;
}

/** Every course slug, in catalog order. */
export function allCourseSlugs() {
  return Object.keys(products).filter(isCourse);
}

// ---------- How a student reaches a human ----------
//
// Shown on the welcome page and on every error page in the purchase flow.
// Someone who has just paid and hit a problem needs a way to reach you that
// doesn't depend on the thing that just broke.

export const support = {
  // Email leads: it's easier for an upset customer than a DM, it gives you a
  // record of the conversation, and it reaches you even if she isn't on
  // Instagram. Replies to login emails land here too.
  email: 'support@mariablair.com',
  instagram: 'https://www.instagram.com/maria_blair_goddess',
  instagramHandle: '@maria_blair_goddess',
};

// ---------- Which purchase unlocks which product ----------
//
// When a payment lands, we need to know what was bought. Stripe tells us the
// price id; Lava tells us the product id. Map them here.
//
// The single-course fallback below is now guarded: it only applies while there
// is exactly one course in the catalog. The moment a second one exists a guess
// could hand someone the wrong course, so it switches itself off.

export const catalog = {
  defaultCourse: 'dating',

  // Stripe price id → product slug. Test-mode and live ids differ, so both
  // belong here — they can sit side by side and nothing needs swapping at
  // launch.
  byStripePrice: {
    price_1U9ULm1PqsZvBWX7466P75gd: 'dating', // $247, test mode
    price_test_consultation: 'consult-60', // the stand-in used by test/mock-stripe.py
    // '<the live course price id>': 'dating',
    // '<the live consultation price id>': 'consult-60',
  },

  // What Russian-speaking buyers pay through. `offerId` is the *price*, not the
  // product — a product has one offer per currency and period, and the two ids
  // look alike. The invoice call needs the offer; byLavaProduct below matches
  // on the product.
  lava: {
    offerId: '3454c7ea-2a85-48f7-ba39-06447388fbca', // the one-time OFFER id — used to create the invoice
    // (LAVA_OFFER_ID overrides this, which is how tests set it)
    productId: 'c7507de8-f478-4e3d-9910-7e424e6e8231', // the PRODUCT id — also appears in byLavaProduct below
    currency: 'RUB',
    // Shown on the payment page. The offer is priced at $50, and Lava derives
    // the rouble figure from it — so this drifts as the rate moves. It is only
    // a label; the buyer is charged whatever Lava's invoice says.
    priceLabel: '4 307 ₽',
  },

  // Lava.top product id (the `product.id` on its webhook) → product slug.
  byLavaProduct: {
    // From the product's URL in Lava: app.lava.top/products/<this>
    'c7507de8-f478-4e3d-9910-7e424e6e8231': 'dating',
  },
};

export function courseForLavaProduct(productId) {
  return catalog.byLavaProduct[productId] || null;
}

/**
 * Which products a checkout actually contained.
 *
 * A basket can hold more than one thing — the Payment Link offers the $97
 * consultation as a cross-sell — so this returns everything in it that we
 * recognise. Both courses and services come back: a consultation is recorded
 * so it shows on her dashboard, and `isCourse()` is what decides whether
 * anything is unlockable.
 *
 * The fallback only fires while the catalog holds exactly one course, so a
 * payment can still be honoured before the price ids are filled in. With two
 * courses it is off, because a guess could hand over the wrong one.
 */
export function productsInSession(session) {
  const items = session?.line_items?.data || [];
  const slugs = new Set();

  for (const item of items) {
    const mapped = catalog.byStripePrice[item?.price?.id];
    if (mapped) slugs.add(mapped);
  }

  if (!slugs.size && Object.keys(catalog.byStripePrice).length === 0) {
    if (allCourseSlugs().length === 1) {
      console.warn(
        'catalog.byStripePrice is empty — falling back to the only course. ' +
          'Add the real price ids so a non-course purchase cannot unlock a course.'
      );
      slugs.add(catalog.defaultCourse);
    } else {
      console.error(
        'catalog.byStripePrice is empty and there is more than one course. ' +
          'Refusing to guess which one was bought — add the price ids.'
      );
    }
  }

  return [...slugs];
}

// ---------- Cloudflare Stream ----------
// `customerCode` is the subdomain your videos are served from — it's the bit
// after "customer-" in any Stream embed URL, and it's the same for every video
// on the account. Not a secret; it appears in every public embed.
// `primaryColor` tints the player controls to match the brand.

export const stream = {
  customerCode: 'k0aprwjw2ij8nfpy',
  primaryColor: '#800020',
};

// ---------- Helpers used by the pages ----------
//
// These all take the course they're working on, so nothing here assumes which
// course a student is in.

/** Every lesson in a course, in order, each tagged with its module. */
export function flatLessons(course) {
  const out = [];
  for (const module of course.modules) {
    for (const lesson of module.lessons) {
      out.push({ ...lesson, module });
    }
  }
  return out;
}

/**
 * A stable id for a lesson, used as the key for progress.
 *
 * Deliberately *not* prefixed with the course: progress rows already carry
 * course_slug in their own column, so 'flags/red-flags' means the same thing
 * it always did and existing rows keep working.
 */
export function lessonId(moduleSlug, lessonSlug) {
  return `${moduleSlug}/${lessonSlug}`;
}

export function findModule(course, slug) {
  return course.modules.find((m) => m.slug === slug) || null;
}

export function findLesson(course, moduleSlug, lessonSlug) {
  const module = findModule(course, moduleSlug);
  if (!module) return null;
  const index = module.lessons.findIndex((l) => l.slug === lessonSlug);
  if (index === -1) return null;

  const all = flatLessons(course);
  const flatIndex = all.findIndex(
    (l) => l.module.slug === moduleSlug && l.slug === lessonSlug
  );

  return {
    module,
    lesson: module.lessons[index],
    prev: all[flatIndex - 1] || null,
    next: all[flatIndex + 1] || null,
  };
}

export function totalLessons(course) {
  return flatLessons(course).length;
}

/** How far through a course she is, as a whole percent. */
export function percentComplete(course, completed) {
  const total = totalLessons(course);
  const done = flatLessons(course).filter((l) =>
    completed.has(lessonId(l.module.slug, l.slug))
  ).length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}
