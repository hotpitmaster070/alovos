import FlameIcon from "@/components/icons/flame";

export type LogoSize = "sm" | "lg";

const SIZE_CLASSES: Record<LogoSize, string> = {
  sm: "text-xl",
  lg: "text-2xl",
};

const BASE_CLASSES = "font-black leading-none tracking-tighter text-white";
const FLAME_CLASSES = "inline-block h-[1em] w-[1em] align-baseline text-flame";

type LogoProps = {
  size?: LogoSize;
  className?: string;
};

export default function Logo({ size = "lg", className = "" }: LogoProps) {
  return (
    <span
      className={`${BASE_CLASSES} ${SIZE_CLASSES[size]} ${className}`.trim()}
      role="img"
      aria-label="alovOS"
    >
      al
      <FlameIcon className={FLAME_CLASSES} />
      vOS
    </span>
  );
}
