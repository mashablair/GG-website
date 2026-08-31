// The Dating Method — course app
//
// Progress used to live here, in localStorage. It's in the database now and
// rendered by the server, so pages are correct before any JavaScript runs and
// her progress follows her between devices.
//
// All that's left is the mobile curriculum drawer.

const drawerToggle = document.querySelector('[data-drawer-toggle]');
const drawer = document.querySelector('[data-drawer]');
const scrim = document.querySelector('[data-scrim]');

function setDrawer(open) {
  document.body.classList.toggle('drawer-open', open);
  drawerToggle?.setAttribute('aria-expanded', String(open));
}

drawerToggle?.addEventListener('click', () => {
  setDrawer(!document.body.classList.contains('drawer-open'));
});

// Tapping the dimmed area, or picking a lesson, closes it
scrim?.addEventListener('click', () => setDrawer(false));

drawer?.addEventListener('click', (e) => {
  if (e.target.closest('a')) setDrawer(false);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('drawer-open')) {
    setDrawer(false);
  }
});
