import FlameIcon from "@/components/icons/flame";

export type LogoSize = "sm" | "lg";

const SIZE_CLASSES: Record<LogoSize, string> = {
  sm: "text-[18px]",
  lg: "text-[24px]",
};

const BASE_CLASSES =
  "font-extralight lowercase leading-none tracking-[0.3em] text-white/90";
const FLAME_CLASSES = "ml-1 inline-block h-[10px] w-[10px] align-baseline text-white/40";

type LogoProps = {
  size?: LogoSize;
  showFlame?: boolean;
  className?: string;
};

export default function Logo({
  size = "lg",
  showFlame = false,
  className = "",
}: LogoProps) {
  return (
    <span
      className={`${BASE_CLASSES} ${SIZE_CLASSES[size]} ${className}`.trim()}
      role="img"
      aria-label="alovos"
    >
      alovos
      {showFlame && <FlameIcon className={FLAME_CLASSES} />}
    </span>
  );
}
