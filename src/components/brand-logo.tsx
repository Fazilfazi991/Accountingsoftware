import Image from "next/image";

type BrandLogoProps = {
  variant?: "transparent" | "dark" | "light";
  className?: string;
  priority?: boolean;
};

const sources = {
  transparent: "/brand/fynta_without_tagline_transparent.png",
  dark: "/brand/fynta_without_tagline_dark_background.png",
  light: "/brand/fynta_without_tagline_white_background.png",
} as const;

export function BrandLogo({ variant = "transparent", className, priority = false }: BrandLogoProps) {
  return <Image className={className} src={sources[variant]} alt="FYNTA" width={1250} height={1250} priority={priority} />;
}
