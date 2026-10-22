/** JANUXAI mark: a play triangle inside a speech bubble — "tell it, it plays". */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="9" fill="#0B1210" stroke="#21F36A" strokeOpacity="0.45" />
      <path d="M8 10.5c0-1.4 1.1-2.5 2.5-2.5h11c1.4 0 2.5 1.1 2.5 2.5v8c0 1.4-1.1 2.5-2.5 2.5H15l-4 3.5V21h-.5C9.1 21 8 19.9 8 18.5v-8Z" fill="#21F36A" fillOpacity="0.14" />
      <path d="M14 11.2v6.6c0 .5.5.8.9.5l5-3.3c.4-.3.4-.8 0-1.1l-5-3.3c-.4-.2-.9.1-.9.6Z" fill="#21F36A" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2 select-none">
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-[0.14em]">
        JANUX<span className="text-accent">AI</span>
      </span>
    </span>
  );
}
