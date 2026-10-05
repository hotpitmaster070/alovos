import type { SVGProps } from "react";

export default function FlameIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...props}
    >
      <path
        vectorEffect="non-scaling-stroke"
        d="M12 2C12 2 20 8 20 14A8 8 0 0 1 4 14C4 11 6 9 7.5 7C7.8 9 9 10.5 10.5 11C10 8 10.8 4.5 12 2Z"
      />
    </svg>
  );
}
