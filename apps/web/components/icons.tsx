import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{children}</svg>;
}

export function ArrowRight(props: IconProps) { return <Icon {...props}><path d="M5 12h14M13 6l6 6-6 6" /></Icon>; }
export function Bell(props: IconProps) { return <Icon {...props}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></Icon>; }
export function Book(props: IconProps) { return <Icon {...props}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5zM4 6.5v13" /></Icon>; }
export function CalendarHeart(props: IconProps) { return <Icon {...props}><path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2" /><path d="M12 17s-3-1.8-3-3.8a1.7 1.7 0 0 1 3-1 1.7 1.7 0 0 1 3 1c0 2-3 3.8-3 3.8" /></Icon>; }
export function ChevronLeft(props: IconProps) { return <Icon {...props}><path d="m15 18-6-6 6-6" /></Icon>; }
export function ChevronRight(props: IconProps) { return <Icon {...props}><path d="m9 18 6-6-6-6" /></Icon>; }
export function Clock(props: IconProps) { return <Icon {...props}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Icon>; }
export function Home(props: IconProps) { return <Icon {...props}><path d="m3 11 9-8 9 8v9H3zM9 20v-6h6v6" /></Icon>; }
export function Heart(props: IconProps) { return <Icon {...props}><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" /></Icon>; }
export function Languages(props: IconProps) {
  return (
    <Icon {...props} data-language-icon="ko-en">
      <path data-language-glyph="ko" d="M3.5 6.5h4.25V13M10.5 5.5v9M10.5 9h2" />
      <circle cx="13.75" cy="12" r=".65" fill="currentColor" stroke="none" />
      <path data-language-glyph="en" d="m15.25 18.5 2.6-8 2.65 8M16.25 15.5h3.25" />
    </Icon>
  );
}
export function Menu(props: IconProps) { return <Icon {...props}><path d="M4 7h16M4 12h16M4 17h16" /></Icon>; }
export function Pause(props: IconProps) { return <Icon {...props}><path d="M8 5v14M16 5v14" /></Icon>; }
export function Play(props: IconProps) { return <Icon {...props}><path fill="currentColor" stroke="none" d="m8 5 11 7-11 7z" /></Icon>; }
export function Radio(props: IconProps) { return <Icon {...props}><circle cx="12" cy="12" r="2" fill="currentColor" /><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4" /></Icon>; }
export function Users(props: IconProps) { return <Icon {...props}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></Icon>; }

export function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.482h4.844a4.14 4.14 0 0 1-1.797 2.715v2.258h2.909c1.702-1.567 2.684-3.875 2.684-6.614Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.468-.806 5.956-2.181l-2.91-2.258c-.805.54-1.835.859-3.046.859-2.344 0-4.328-1.585-5.037-3.714H.956v2.332A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.963 10.706A5.41 5.41 0 0 1 3.68 9c0-.592.102-1.168.283-1.706V4.962H.956A9 9 0 0 0 0 9c0 1.452.347 2.827.956 4.038l3.007-2.332Z" />
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.507.454 3.442 1.345l2.581-2.581C13.464.891 11.426 0 9 0A9 9 0 0 0 .956 4.962l3.007 2.332C4.672 5.165 6.656 3.58 9 3.58Z" />
    </svg>
  );
}

/** Apple mark path from Bootstrap Icons (MIT), sized for sign-in controls. */
export function AppleMark() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M11.182.008C11.148-.03 9.923.023 8.65 1.4c-1.273 1.376-1.075 2.626-1.046 2.658.028.033 1.816.087 2.956-1.513 1.14-1.6.657-2.5.622-2.537m3.872 11.696c-.048-.096-2.325-1.234-2.113-3.426.212-2.193 1.69-2.792 1.713-2.857.022-.066-.606-.802-1.265-1.174a3.77 3.77 0 0 0-1.625-.456c-.113-.003-.503-.098-1.305.12-.529.144-1.725.61-2.053.628-.328.02-1.303-.536-2.351-.683-.671-.13-1.378.137-1.884.34-.505.2-1.468.775-2.142 2.337-.674 1.562-.32 4.035-.066 4.767.254.731.65 1.93 1.332 2.838.682.907 1.46 1.535 1.795 1.557.334.022 1.229-.504 2.355-.518 1.127-.015 1.776.482 2.381.513.606.03 1.221-.49 1.9-1.323.679-.833 1.107-1.835 1.122-1.88.016-.045-.772-.65-1.274-1.783" />
    </svg>
  );
}
