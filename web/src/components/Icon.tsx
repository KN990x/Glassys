import {
  AlertTriangle,
  BarChart3,
  ArrowDown,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock,
  Command,
  Copy,
  Download,
  FilePen,
  FileText,
  Folder,
  GitBranch,
  Info,
  MessageSquare,
  MoreHorizontal,
  Palette,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Search,
  Send,
  Server,
  Settings as SettingsGlyph,
  Smartphone,
  Square,
  Terminal,
  Trash2,
  X,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";

/** Every icon in the product renders at one stroke weight and one default size. */
function icon(Base: LucideIcon) {
  return function Glyph({ size = 18, strokeWidth = 1.5, ...rest }: LucideProps) {
    return <Base size={size} strokeWidth={strokeWidth} aria-hidden="true" {...rest} />;
  };
}

export const IconAlert = icon(AlertTriangle);
export const IconChart = icon(BarChart3);
export const IconPalette = icon(Palette);
export const IconPhone = icon(Smartphone);
export const IconArrowDown = icon(ArrowDown);
export const IconCheck = icon(Check);
export const IconChevronDown = icon(ChevronDown);
export const IconChevronRight = icon(ChevronRight);
export const IconClock = icon(Clock);
export const IconCommand = icon(Command);
export const IconCopy = icon(Copy);
export const IconError = icon(CircleAlert);
export const IconExport = icon(Download);
export const IconFile = icon(FileText);
export const IconFileEdit = icon(FilePen);
export const IconFolder = icon(Folder);
export const IconGit = icon(GitBranch);
export const IconInfo = icon(Info);
export const IconMore = icon(MoreHorizontal);
export const IconAttach = icon(Paperclip);
export const IconPin = icon(Pin);
export const IconPinOff = icon(PinOff);
export const IconPlus = icon(Plus);
export const IconRefresh = icon(RefreshCw);
export const IconRename = icon(Pencil);
export const IconSearch = icon(Search);
export const IconSend = icon(Send);
export const IconServer = icon(Server);
export const IconSettings = icon(SettingsGlyph);
export const IconStop = icon(Square);
export const IconTerminal = icon(Terminal);
export const IconThreads = icon(MessageSquare);
export const IconTrash = icon(Trash2);
export const IconClose = icon(X);

/**
 * The product mark. Two offset panes: the agent underneath, the chat face on top.
 * Inherits currentColor, so it stays visible on either theme — unlike the flat
 * `/icon.svg` file, whose baked-in dark background disappeared on the dark topbar.
 */
export function GlassysMark({ size = 24, title }: { size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : "true"}
    >
      {title ? <title>{title}</title> : null}
      <rect
        x="6.5"
        y="6.5"
        width="27"
        height="27"
        rx="7"
        stroke="currentColor"
        strokeWidth="2.5"
        opacity="0.45"
      />
      <rect
        x="14.5"
        y="14.5"
        width="27"
        height="27"
        rx="7"
        stroke="currentColor"
        strokeWidth="2.5"
      />
    </svg>
  );
}
