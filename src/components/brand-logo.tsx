import Image from "next/image";

type BrandLogoProps = {
  variant?: "transparent" | "dark" | "light";
  className?: string;
  priority?: boolean;
};

const sources = {
  transparent: { src: "/brand/fynta_without_tagline_transparent.png", width: 1254, height: 1254 },
  dark: { src: "/brand/fynta_wordmark_light_transparent.png", width: 889, height: 332 },
  light: { src: "/brand/fynta_without_tagline_white_background.png", width: 1254, height: 1254 },
} as const;

export function BrandLogo({ variant = "transparent", className, priority = false }: BrandLogoProps) {
  const source = sources[variant];
  return <Image className={className} src={source.src} alt="FYNTA" width={source.width} height={source.height} priority={priority} />;
}
