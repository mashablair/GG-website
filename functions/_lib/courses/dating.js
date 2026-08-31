// ============================================
// THE DATING METHOD — this is the file you edit
// ============================================
//
// One course lives in one file. Everything students see inside this course
// comes from here: modules, lessons, videos, text, downloads.
//
// To add a lesson, add an object to a module's `lessons` array. To reorder,
// move things around — the sidebar, dashboard, progress bars and next/previous
// links all follow automatically.
//
// Each lesson takes:
//   slug      the bit in the URL, lowercase-with-dashes, unique within its module
//   title     shown everywhere
//   video     the Cloudflare Stream video ID — leave null and you get a
//             "coming soon" card instead of a broken player
//   duration  e.g. '8 min' — optional, shown next to the title
//   body      the written part, as HTML (see the Intro lesson for examples)
//   images    optional [{ src, alt, caption }]
//   resources optional [{ label, file }] — downloads for this lesson
//
// Leave `body` as '' and the lesson shows a friendly "notes coming" note
// instead of an empty page.
//
// Adding a WHOLE NEW COURSE: copy this file, change the content, then add one
// line to functions/_lib/catalog.js. Nothing else needs to change.

export const datingCourse = {
  title: 'The Dating Method',
  tagline: 'For women 35+ who want to date with intention, not desperation.',

  modules: [
    // ---------- 0 ----------
    {
      slug: 'intro',
      number: 0,
      title: 'Intro',
      summary: 'Start here — what this is, and how to get the most out of it.',
      lessons: [
        {
          slug: 'welcome',
          title: 'Welcome',
          video: '695f894f203e6f8a70e5e6c68148d641',
          duration: null,
          body: `
            <p>I'm so glad you're here.</p>
            <p>This course is everything I learned in the last three years —
            all the mistakes, all the lessons, all the wisdom — packaged up so
            you don't have to walk this road alone.</p>
            <p>Watch this first. Then go make yourself a cup of tea, because
            Module 1 is where the real work starts.</p>
          `,
          images: [],
          resources: [],
        },
        {
          slug: 'how-to-use-this-course',
          title: 'How to use this course',
          video: null,
          duration: null,
          // This lesson doubles as a formatting reference — copy any of these
          // pieces into your own lessons.
          body: `
            <p>A few things worth knowing before you dive in.</p>

            <h3>Go in order, at least the first time</h3>
            <p>The modules build on each other. Module 1 is the inner work, and
            everything after it lands differently once you've done it.</p>

            <ul>
              <li>Mark each lesson complete as you finish it — that's how the
              course remembers where you are</li>
              <li>Come back as often as you like; you have a full year</li>
              <li>Download the worksheets and actually fill them in</li>
            </ul>

            <blockquote>
              You don't have to be ready. You just have to start.
            </blockquote>

            <h3>Take your time</h3>
            <p>Most women finish the modules in one to two weeks. Some take
            months. Both are fine — this isn't a race, and nobody is grading
            you.</p>
          `,
          images: [],
          resources: [],
        },
      ],
    },

    // ---------- 1 ----------
    {
      slug: 'getting-ready',
      number: 1,
      title: 'Getting Ready for Dating',
      subtitle: 'The Identity Shift — Becoming the Woman Men Want',
      summary: 'Before the apps, the real work: who you are and what you want.',
      lessons: [
        { slug: 'who-you-are-now', title: 'Who you are now', video: null, duration: null, body: '', images: [], resources: [] },
        { slug: 'self-worth', title: 'Self-worth and your nervous system', video: null, duration: null, body: '', images: [], resources: [] },
        { slug: 'what-you-want', title: 'What you actually want', video: null, duration: null, body: '', images: [], resources: [] },
      ],
    },

    // ---------- 2 ----------
    {
      slug: 'dating-is-a-skill',
      number: 2,
      title: 'Online Dating is a Skill and a Part-time Job',
      summary: 'Treat it like a practice, not a lottery ticket.',
      lessons: [
        { slug: 'a-skill-you-learn', title: 'A skill you learn, not a talent you have', video: null, duration: null, body: '', images: [], resources: [] },
        { slug: 'time-and-energy', title: 'Your time and energy budget', video: null, duration: null, body: '', images: [], resources: [] },
      ],
    },

    // ---------- 3 ----------
    {
      slug: 'dating-mindset',
      number: 3,
      title: 'Dating Mindset is Key',
      summary: 'Abundance over scarcity — and what to do when it stings.',
      lessons: [
        { slug: 'abundance-vs-scarcity', title: 'Abundance vs. scarcity', video: null, duration: null, body: '', images: [], resources: [] },
        { slug: 'handling-rejection', title: 'Handling rejection', video: null, duration: null, body: '', images: [], resources: [] },
      ],
    },

    // ---------- 4 ----------
    {
      slug: 'apps-and-sites',
      number: 4,
      title: 'Dating Apps and Sites',
      summary: 'Which platform, how to set it up, what to pay for.',
      lessons: [
        { slug: 'which-app', title: 'Which app is right for you', video: null, duration: null, body: '', images: [], resources: [] },
        { slug: 'setting-up', title: 'Setting up and settings that matter', video: null, duration: null, body: '', images: [], resources: [] },
        { slug: 'free-vs-paid', title: 'Free vs. paid — what is worth it', video: null, duration: null, body: '', images: [], resources: [] },
      ],
    },

    // ---------- 5 ----------
    {
      slug: 'magnetic-profile',
      number: 5,
      title: 'Your Magnetic Profile',
      summary: 'The words and the photos that make the right men stop scrolling.',
      lessons: [
        { slug: 'your-bio', title: 'Your bio', video: null, duration: null, body: '', images: [], resources: [] },
        { slug: 'photos', title: 'Photos that actually work', video: null, duration: null, body: '', images: [], resources: [] },
        { slug: 'prompts', title: 'Prompts and openers', video: null, duration: null, body: '', images: [], resources: [] },
        { slug: 'profile-audit', title: 'Auditing your own profile', video: null, duration: null, body: '', images: [], resources: [] },
      ],
    },

    // ---------- 6 ----------
    {
      slug: 'flags',
      number: 6,
      title: 'Red Flags & Green Flags in Profiles',
      summary: 'How to read a profile — and spot a scam before it costs you.',
      lessons: [
        { slug: 'reading-a-profile', title: 'How to read a profile', video: null, duration: null, body: '', images: [], resources: [] },
        { slug: 'red-flags', title: 'Red flags', video: null, duration: null, body: '', images: [], resources: [] },
        { slug: 'green-flags', title: 'Green flags', video: null, duration: null, body: '', images: [], resources: [] },
        { slug: 'scams-and-catfish', title: 'Scams and catfishing', video: null, duration: null, body: '', images: [], resources: [] },
      ],
    },

    // ---------- 7 ----------
    {
      slug: 'safety',
      number: 7,
      title: 'Safety',
      summary: 'Non-negotiables, before and during.',
      lessons: [
        { slug: 'before-you-meet', title: 'Before you meet', video: null, duration: null, body: '', images: [], resources: [] },
        { slug: 'meeting-safely', title: 'Meeting safely', video: null, duration: null, body: '', images: [], resources: [] },
        { slug: 'digital-safety', title: 'Digital safety and your privacy', video: null, duration: null, body: '', images: [], resources: [] },
      ],
    },

    // ---------- 8 ----------
    {
      slug: 'prepping-first-date',
      number: 8,
      title: 'Prepping for the First Date',
      summary: 'Where to go, what to wear, and how to walk in calm.',
      lessons: [
        { slug: 'choosing-the-date', title: 'Choosing the date', video: null, duration: null, body: '', images: [], resources: [] },
        { slug: 'what-to-wear', title: 'What to wear', video: null, duration: null, body: '', images: [], resources: [] },
        { slug: 'mindset-before-you-go', title: 'Your mindset before you go', video: null, duration: null, body: '', images: [], resources: [] },
      ],
    },

    // ---------- 9 ----------
    {
      slug: 'on-a-date',
      number: 9,
      title: 'On a Date',
      summary: 'Feminine energy in practice — you observe, you enjoy, you say thank you.',
      lessons: [
        { slug: 'first-ten-minutes', title: 'The first ten minutes', video: null, duration: null, body: '', images: [], resources: [] },
        { slug: 'conversation', title: 'Conversation', video: null, duration: null, body: '', images: [], resources: [] },
        { slug: 'feminine-energy', title: 'Feminine energy in practice', video: null, duration: null, body: '', images: [], resources: [] },
        { slug: 'ending-the-date', title: 'Ending the date', video: null, duration: null, body: '', images: [], resources: [] },
      ],
    },

    // ---------- 10 ----------
    {
      slug: 'after-a-date',
      number: 10,
      title: 'After a Date',
      summary: 'The follow-up, the signals, and knowing when to walk.',
      lessons: [
        { slug: 'the-follow-up', title: 'The follow-up', video: null, duration: null, body: '', images: [], resources: [] },
        { slug: 'reading-the-signals', title: 'Reading the signals', video: null, duration: null, body: '', images: [], resources: [] },
        { slug: 'when-to-move-on', title: 'When to move on', video: null, duration: null, body: '', images: [], resources: [] },
      ],
    },

    // ---------- 11 ----------
    {
      slug: 'bonuses',
      number: 11,
      title: 'Bonuses',
      summary: 'The extras — worksheets, templates, and answers to what women ask most.',
      lessons: [
        { slug: 'worksheets', title: 'Worksheets and templates', video: null, duration: null, body: '', images: [], resources: [] },
        { slug: 'questions', title: 'Questions I get asked most', video: null, duration: null, body: '', images: [], resources: [] },
      ],
    },
  ],
};

// ---------- Resources ----------
// The downloads page for this course. `file` is the path the download is served
// from — once these live in R2 they'll come through
// /learn/dating/download/<file>. For now they render as "coming soon" until you
// set `ready: true`.

export const datingResources = [
  { label: 'First-date checklist', file: 'first-date-checklist.pdf', ready: false },
  { label: 'Red-flag / green-flag playbook', file: 'flags-playbook.pdf', ready: false },
  { label: '"My Rules" worksheet', file: 'my-rules-worksheet.pdf', ready: false },
  { label: 'Profile audit template', file: 'profile-audit.pdf', ready: false },
];
