import { useRef, useState, useEffect } from 'react';

interface MarqueeTextProps {
  text: string;
  className?: string;
  /** Pixels per second scroll speed */
  speed?: number;
  /** Gap between copies in pixels */
  gap?: number;
  /** Only scroll when parent has this class in a hover state */
  hoverSelector?: string;
}

/**
 * Text that scrolls horizontally only when it overflows its container.
 * On hover, duplicates the text with a separator for seamless looping.
 * Short text that fits is rendered static.
 */
export function MarqueeText({ text, className = '', speed = 30, gap = 24 }: MarqueeTextProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [scrollWidth, setScrollWidth] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    const textEl = textRef.current;
    if (!container || !textEl) return;

    const check = () => {
      const containerW = container.offsetWidth;
      const textW = textEl.scrollWidth;
      const doesOverflow = textW > containerW + 1; // 1px tolerance
      setOverflows(doesOverflow);
      if (doesOverflow) {
        setScrollWidth(textW + gap);
      }
    };

    check();
    const observer = new ResizeObserver(check);
    observer.observe(container);
    return () => observer.disconnect();
  }, [text, gap]);

  const duration = scrollWidth / speed;

  return (
    <div ref={containerRef} className={`overflow-hidden ${className}`}>
      {overflows ? (
        <div
          className="inline-flex whitespace-nowrap opacity-0 group-hover:opacity-100 group-hover:animate-[marquee-scroll_var(--marquee-duration)_linear_infinite]"
          style={{
            '--marquee-duration': `${duration}s`,
            '--marquee-scroll': `-${scrollWidth}px`,
          } as React.CSSProperties}
        >
          <span>{text}</span>
          <span className="text-zinc-400 dark:text-zinc-500 mx-[--marquee-gap]" style={{ '--marquee-gap': `${gap / 2}px` } as React.CSSProperties}>|</span>
          <span>{text}</span>
        </div>
      ) : null}
      <span
        ref={textRef}
        className={`whitespace-nowrap ${overflows ? 'group-hover:hidden' : ''}`}
      >
        {text}
      </span>
    </div>
  );
}
