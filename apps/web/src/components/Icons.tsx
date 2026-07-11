import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = (children: React.ReactNode, props: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    {children}
  </svg>
);

export const ClockIcon = (props: IconProps) => base(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>, props);
export const LockIcon = (props: IconProps) => base(<><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>, props);
export const MenuIcon = (props: IconProps) => base(<><path d="M4 7h16M4 12h16M4 17h16" /></>, props);
export const CopyIcon = (props: IconProps) => base(<><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>, props);
export const CheckIcon = (props: IconProps) => base(<path d="m5 12 4 4L19 6" />, props);
export const PauseIcon = (props: IconProps) => base(<><path d="M9 5v14M15 5v14" /></>, props);
export const PlayIcon = (props: IconProps) => base(<path d="m8 5 11 7-11 7Z" />, props);
export const ArrowIcon = (props: IconProps) => base(<><path d="M5 12h14M14 7l5 5-5 5" /></>, props);

