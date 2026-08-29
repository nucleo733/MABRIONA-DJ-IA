import type { SVGProps } from 'react'

/**
 * Iconos de línea fina — Design System §5 ("línea fina, sin relleno").
 * Set mínimo propio para no depender de una librería externa; el trazo
 * (stroke) hereda `currentColor`, así que cada ícono toma el color de
 * acento de su contenedor vía className `text-*`.
 */
const base: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export const IconHome = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" /></svg>
)
export const IconMusic = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></svg>
)
export const IconPlay = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M6 4.5v15l13-7.5-13-7.5Z" /></svg>
)
export const IconImage = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="1.7" /><path d="m4 17 5-5 4 4 3-3 4 4" /></svg>
)
export const IconChat = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M4 5.5h16v11H8.5L4 20.5Z" /></svg>
)
export const IconHeadphones = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M4 14v-2a8 8 0 0 1 16 0v2" /><rect x="3" y="13.5" width="4.5" height="6" rx="1.5" /><rect x="16.5" y="13.5" width="4.5" height="6" rx="1.5" /></svg>
)
export const IconRadar = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="0.8" fill="currentColor" /></svg>
)
export const IconCart = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M4 5h2l2 11h10l2-8H7" /><circle cx="9.5" cy="19" r="1.3" /><circle cx="16.5" cy="19" r="1.3" /></svg>
)
export const IconUser = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><circle cx="12" cy="8.5" r="3.5" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></svg>
)
export const IconSearch = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.3-4.3" /></svg>
)
export const IconWaveform = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M4 12v1M8 9v7M12 5v14M16 9v7M20 12v1" /></svg>
)
export const IconBell = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M6 10a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 14 6 10Z" /><path d="M10 18.5a2 2 0 0 0 4 0" /></svg>
)
export const IconMail = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4 6.5 8 6 8-6" /></svg>
)
export const IconSettings = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 13.5a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V20a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H4a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 1.9.3H10a1.7 1.7 0 0 0 1-1.5V4a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.9V10a1.7 1.7 0 0 0 1.5 1H20a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></svg>
)
export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="9.5" /><path d="m8 12.5 2.5 2.5L16 9.5" /></svg>
)
export const IconShuffle = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M3 6h3.5L15 18h6M14 6h7v0M3 18h3.5L11 12M17.5 6 21 9.5M17.5 18 21 14.5" /></svg>
)
export const IconSkipBack = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M18 6v12L8 12l10-6Z" /><path d="M6 6v12" /></svg>
)
export const IconSkipForward = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M6 6v12l10-6L6 6Z" /><path d="M18 6v12" /></svg>
)
export const IconPause = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M8 5v14" /><path d="M16 5v14" /></svg>
)
export const IconRepeat = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M4 7.5h13a3 3 0 0 1 3 3v1" /><path d="m15 4 3.5 3.5L15 11" /><path d="M20 16.5H7a3 3 0 0 1-3-3v-1" /><path d="m9 20-3.5-3.5L9 13" /></svg>
)
export const IconVolume = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M4 10v4h4l5 4V6L8 10H4Z" /><path d="M16.5 9a4 4 0 0 1 0 6" /></svg>
)
export const IconQueue = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M4 6h16M4 12h10M4 18h10" /><path d="M17 15v6M20 18h-6" /></svg>
)
export const IconSparkle = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" /></svg>
)
export const IconOrb = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16" opacity="0.5" /></svg>
)
export const IconHeart = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M12 20s-7-4.4-9.3-8.8C1.2 8 3 5 6.3 5 8.4 5 10 6.3 12 8.5 14 6.3 15.6 5 17.7 5 21 5 22.8 8 21.3 11.2 19 15.6 12 20 12 20Z" /></svg>
)
export const IconComment = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M4 5.5h16v11H8.5L4 20.5Z" /></svg>
)
export const IconShare = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><circle cx="18" cy="6" r="2.3" /><circle cx="6" cy="12" r="2.3" /><circle cx="18" cy="18" r="2.3" /><path d="m8.1 10.9 7.8-3.8M8.1 13.1l7.8 3.8" /></svg>
)
export const IconMore = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p} strokeWidth={2.4}><path d="M12 5.2v.1M12 11.95v.1M12 18.7v.1" /></svg>
)
export const IconSend = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M21 3 3 10.5l7.5 3L13.5 21 21 3Z" /><path d="M10.5 13.5 21 3" /></svg>
)
export const IconAttach = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M17.5 7.5 9 16a3 3 0 0 1-4.2-4.2l9-9a4.5 4.5 0 0 1 6.4 6.4l-9.4 9.4a1.5 1.5 0 0 1-2.1-2.1l8.3-8.3" /></svg>
)
export const IconEmoji = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5c1 1.2 2.1 1.8 3.5 1.8s2.5-.6 3.5-1.8" /><path d="M8.7 9.5v.1M15.3 9.5v.1" /></svg>
)
export const IconMic = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M6 11.5a6 6 0 0 0 12 0" /><path d="M12 17.5v3M9 20.5h6" /></svg>
)
export const IconCheckDouble = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="m3.5 12.5 4 4L15 8" /><path d="m9.5 12.5 4 4L21 8" /></svg>
)
export const IconReply = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M10 8 4 13l6 5" /><path d="M4 13h9a7 7 0 0 1 7 7v.5" /></svg>
)
export const IconChevronLeft = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="m15 5-7 7 7 7" /></svg>
)
export const IconChevronRight = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="m9 5 7 7-7 7" /></svg>
)
export const IconChevronUp = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="m5 15 7-7 7 7" /></svg>
)
export const IconChevronDown = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="m5 9 7 7 7-7" /></svg>
)
export const IconArrowRight = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
)
export const IconClose = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="m5 5 14 14M19 5 5 19" /></svg>
)
export const IconPlus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M12 5v14M5 12h14" /></svg>
)
export const IconEye = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /></svg>
)
export const IconVideoFrame = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="M10.5 9.5v5l4.5-2.5-4.5-2.5Z" /></svg>
)
export const IconVideo = IconVideoFrame
export const IconPhoto = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><rect x="3" y="4.5" width="18" height="15" rx="2.5" /><circle cx="8.5" cy="9.5" r="1.6" /><path d="m4 17 5-5 3.5 3.5L16.5 11 20 15" /></svg>
)
export const IconType = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M6 6.5h12M12 6.5V18" /><path d="M9 18h6" /></svg>
)
export const IconBroadcast = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="1.6" fill="currentColor" /><path d="M8.5 15.5a5 5 0 0 1 0-7" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M5.5 18.5a9 9 0 0 1 0-13" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></svg>
)
export const IconUsers = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><circle cx="9" cy="8.5" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M15.5 6a3 3 0 0 1 0 5.8" /><path d="M17 13.2a5 5 0 0 1 3.5 5.8" /></svg>
)
export const IconClock = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></svg>
)
export const IconGrid = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></svg>
)
export const IconUpload = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M12 15.5V4M12 4 7.5 8.5M12 4l4.5 4.5" /><path d="M4.5 15v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" /></svg>
)
export const IconDownload = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M12 4v11.5M12 15.5 7.5 11M12 15.5l4.5-4.5" /><path d="M4.5 15v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" /></svg>
)
export const IconTrash = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M4 7h16" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /><path d="M6.5 7l.8 12a2 2 0 0 0 2 1.8h5.4a2 2 0 0 0 2-1.8l.8-12" /><path d="M10 11v6M14 11v6" /></svg>
)
export const IconUndo = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M7 8H4V5" /><path d="M4 8c2-3 5-4.5 8-4.5a8 8 0 1 1-7 12" /></svg>
)
export const IconRedo = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M17 8h3V5" /><path d="M20 8c-2-3-5-4.5-8-4.5a8 8 0 1 0 7 12" /></svg>
)
export const IconBrush = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M18.5 2.5a3 3 0 0 1 0 4.2L9 16.2l-4-1 1-4 9.3-9.3a3 3 0 0 1 4.2 0Z" /><path d="M9 16.5c-1.5 2-3 3-6 3.5" /></svg>
)
export const IconRocket = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M12 2.5c3 1.5 5 5 5 9.5 0 2-1 4-2 5l-3 3-3-3c-1-1-2-3-2-5 0-4.5 2-8 5-9.5Z" /><circle cx="12" cy="10.5" r="1.7" /><path d="M9 17.5 7 21M15 17.5 17 21" /></svg>
)
export const IconMegaphone = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M3 10v4h3l9 4V6L6 10H3Z" /><path d="M17 9a4 4 0 0 1 0 6" /><path d="M8 14.5 9 19" /></svg>
)
export const IconCloud = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M7 18h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6-1.6A4 4 0 0 0 7 18Z" /></svg>
)
export const IconChart = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M4 20V4" /><path d="M4 20h16" /><rect x="7" y="12" width="3" height="8" /><rect x="12.5" y="8" width="3" height="12" /><rect x="18" y="14" width="3" height="6" /></svg>
)
export const IconHelp = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7" /><path d="M12 17h.01" /></svg>
)
export const IconPiano = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><rect x="3" y="6" width="18" height="12" rx="1.5" /><path d="M7 6v8M11 6v8M15 6v8M19 6v8" /></svg>
)
export const IconPianoRoll = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><rect x="3.5" y="4" width="17" height="16" rx="1.5" /><path d="M3.5 8h17M3.5 12h17M3.5 16h17" /><rect x="6" y="5.3" width="4" height="2.4" fill="currentColor" stroke="none" /><rect x="11" y="9.3" width="6" height="2.4" fill="currentColor" stroke="none" /><rect x="8" y="13.3" width="3" height="2.4" fill="currentColor" stroke="none" /></svg>
)
export const IconScore = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M4 6h16M4 10h16M4 14h16M4 18h16" /><circle cx="9" cy="14" r="1.4" fill="currentColor" stroke="none" /><circle cx="15" cy="10" r="1.4" fill="currentColor" stroke="none" /><path d="M10.4 14V7M16.4 10V5" /></svg>
)
export const IconBriefcase = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><rect x="3" y="7.5" width="18" height="12" rx="2" /><path d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5" /><path d="M3 12.5h18" /></svg>
)
export const IconGlobe = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.5 4 6 4 9s-1.5 6.5-4 9c-2.5-2.5-4-6-4-9s1.5-6.5 4-9Z" /></svg>
)
export const IconShield = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M12 3 19 6v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" /><path d="m9 12 2 2 4-4" /></svg>
)
export const IconWindow = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><rect x="3" y="4.5" width="18" height="15" rx="2" /><path d="M3 8.5h18" /><circle cx="6" cy="6.5" r="0.6" fill="currentColor" stroke="none" /><circle cx="8" cy="6.5" r="0.6" fill="currentColor" stroke="none" /></svg>
)
export const IconExpand = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" /></svg>
)
export const IconBlock = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="m5.5 5.5 13 13" /></svg>
)
export const IconCalendar = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 9.5h17" /><path d="M8 3v4M16 3v4" /></svg>
)
export const IconBookmark = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M6 4h12a1 1 0 0 1 1 1v15l-7-4-7 4V5a1 1 0 0 1 1-1Z" /></svg>
)
export const IconFlag = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M5 3v18" /><path d="M5 4h13l-3 4 3 4H5" /></svg>
)
