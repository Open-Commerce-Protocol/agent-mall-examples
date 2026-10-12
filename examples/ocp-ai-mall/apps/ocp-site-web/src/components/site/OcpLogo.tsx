type OcpLogoProps = {
  className?: string;
  title?: string;
};

let gradientCounter = 0;

export function OcpLogo({ className, title }: OcpLogoProps) {
  const gradientId = `ocp-logo-gradient-${++gradientCounter}`;
  return (
    <svg
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      className={className}
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6366F1" />
          <stop offset="100%" stopColor="#06B6D4" />
        </linearGradient>
      </defs>
      <g stroke={`url(#${gradientId})`} fill="none" strokeLinecap="round" strokeWidth="3.5">
        <path d="M 50 18 A 32 32 0 0 1 77.7 66" />
        <path d="M 77.7 66 A 32 32 0 0 1 22.3 66" />
        <path d="M 22.3 66 A 32 32 0 0 1 50 18" />
      </g>
      <g fill={`url(#${gradientId})`}>
        <circle cx="50" cy="50" r="6" />
        <circle cx="50" cy="18" r="3" />
        <circle cx="77.7" cy="66" r="3" />
        <circle cx="22.3" cy="66" r="3" />
      </g>
    </svg>
  );
}
