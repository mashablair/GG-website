// Glorious Goddess — mariablair.com

// ---------- Mobile nav ----------
const toggle = document.querySelector('.nav__toggle');
const mobileMenu = document.querySelector('.nav__mobile');

if (toggle && mobileMenu) {
  toggle.addEventListener('click', () => {
    const open = mobileMenu.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
  });

  // Close the menu after tapping a link (e.g. anchor links on the same page)
  mobileMenu.addEventListener('click', (e) => {
    if (e.target.closest('a')) {
      mobileMenu.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });
}

// ---------- Waitlist forms ----------
document.querySelectorAll('form[data-waitlist]').forEach((form) => {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const button = form.querySelector('button[type="submit"]');
    const errorEl = form.querySelector('.waitlist__error');
    const firstName = form.first_name.value.trim();
    const email = form.email.value.trim();
    const company = form.company ? form.company.value.trim() : '';

    errorEl.textContent = '';
    button.disabled = true;
    button.textContent = 'One sec…';

    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ first_name: firstName, email, company }),
      });

      if (!res.ok) throw new Error('Request failed');

      const success = document.createElement('p');
      success.className = 'waitlist__success';
      success.textContent = `You're in, ${firstName} 🐆 Watch your inbox — good things are coming.`;
      form.replaceWith(success);
    } catch (err) {
      button.disabled = false;
      button.textContent = form.dataset.buttonLabel || 'Try Again 🐆';
      errorEl.textContent =
        "Hmm, that didn't go through. Try again in a moment — or DM me on Instagram and I'll add you myself.";
    }
  });
});

// ---------- Testimonial carousel ----------
document.querySelectorAll('[data-carousel]').forEach((root) => {
  const track = root.querySelector('[data-carousel-track]');
  const slides = Array.from(track.children);
  const dotsWrap = root.querySelector('[data-carousel-dots]');
  const prev = root.querySelector('.carousel__arrow--prev');
  const next = root.querySelector('.carousel__arrow--next');
  let index = 0;
  let timer;

  slides.forEach((_, i) => {
    const dot = document.createElement('button');
    dot.className = 'carousel__dot';
    dot.setAttribute('aria-label', `Go to testimonial ${i + 1}`);
    dot.addEventListener('click', () => { goTo(i); rest(); });
    dotsWrap.appendChild(dot);
  });
  const dots = Array.from(dotsWrap.children);

  function update() {
    dots.forEach((d, i) => d.setAttribute('aria-current', String(i === index)));
  }

  function goTo(i) {
    index = (i + slides.length) % slides.length;
    track.scrollTo({ left: track.clientWidth * index, behavior: 'smooth' });
    update();
  }

  function rest() {
    clearInterval(timer);
    timer = setInterval(() => goTo(index + 1), 7000);
  }

  if (prev) prev.addEventListener('click', () => { goTo(index - 1); rest(); });
  if (next) next.addEventListener('click', () => { goTo(index + 1); rest(); });

  // Keep dots in sync when the user swipes the track directly
  let scrollTimer;
  track.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const i = Math.round(track.scrollLeft / track.clientWidth);
      if (i !== index) { index = i; update(); }
    }, 120);
  });

  root.addEventListener('mouseenter', () => clearInterval(timer));
  root.addEventListener('mouseleave', rest);
  root.addEventListener('focusin', () => clearInterval(timer));

  update();
  timer = setInterval(() => goTo(index + 1), 7000);
});
