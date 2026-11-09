/**
 * A compact PDP reassurance band. The offset strokes give the line artwork a
 * little dimensionality while keeping it sharp, lightweight and on-brand.
 * Each statement describes a rule the storefront/API currently enforces.
 */
export function ProductConfidence() {
  const items = [
    {
      title: 'Same design, another size',
      detail: 'Request another size of the same colourway.',
      icon: <ExchangeShoeIcon />,
    },
    {
      title: '10 days from delivery',
      detail: 'Request an exchange from your account.',
      icon: <CalendarIcon />,
    },
    {
      title: 'Stock checked before approval',
      detail: 'A replacement is confirmed only when available.',
      icon: <StockIcon />,
    },
  ];

  return (
    <section aria-label="Shopping with confidence" className="mt-8 border-y border-border py-5">
      <ul className="grid gap-4 sm:grid-cols-3 sm:gap-5">
        {items.map((item) => (
          <li key={item.title} className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="grid h-12 w-12 shrink-0 place-items-center border border-gold-200 bg-cream-100 text-ink-800"
            >
              {item.icon}
            </span>
            <span className="min-w-0">
              <span className="block step-xs font-semibold text-ink-900">{item.title}</span>
              <span className="mt-0.5 block text-[0.6875rem] leading-5 text-ink-500">
                {item.detail}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ExchangeShoeIcon() {
  return (
    <svg
      viewBox="0 0 48 48"
      className="h-9 w-9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M7 31c5-1 8-5 10-12l4 2c2 5 6 8 13 9 4 .5 7 2 7 5v3H7v-7Z" fill="#f8f1e4" />
      <path d="M9 33c6-.5 10-4 12-10m-3-4 4 2c2 5 6 8 13 9 4 .5 7 2 7 5v3H7v-7c1-.2 1.4-.4 2-.5Z" />
      <path d="M22 22c2 2 4 3 7 4m-5-5 2 4m2-2 2 3" stroke="#a87d42" />
      <path
        d="m14 16 3-3 3 3m-3-3v6"
        stroke="#a87d42"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9 38h30" stroke="#a87d42" strokeWidth="2" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg
      viewBox="0 0 48 48"
      className="h-9 w-9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M11 13h26v27H11z" fill="#f8f1e4" />
      <path d="M15 10v7m18-7v7M11 20h26v20H11z" />
      <path d="M17 26h4m6 0h4m-14 6h4m6 0h4" stroke="#a87d42" strokeLinecap="round" />
      <path d="M15 10v7m18-7v7" stroke="#a87d42" strokeWidth="2" strokeLinecap="round" />
      <circle cx="34" cy="35" r="7" fill="#f4e5c9" stroke="#a87d42" />
      <path d="M34 31v4l2.5 1.5" stroke="#5e492c" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StockIcon() {
  return (
    <svg
      viewBox="0 0 48 48"
      className="h-9 w-9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="m8 17 16-9 16 9v18l-16 9-16-9V17Z" fill="#f8f1e4" />
      <path d="m8 17 16 9 16-9M24 26v18M16 12l16 9" />
      <path
        d="m18 30 4 4 8-9"
        stroke="#a87d42"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="m8 17 16 9 16-9" stroke="#a87d42" />
    </svg>
  );
}
