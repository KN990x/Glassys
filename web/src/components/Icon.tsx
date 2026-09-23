import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Brain,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock,
  Command,
  Copy,
  Download,
  Eye,
  EyeOff,
  FilePen,
  FileText,
  Folder,
  GitBranch,
  HardDrive,
  History,
  Info,
  ListChecks,
  Loader2,
  MessageSquare,
  Monitor,
  Moon,
  MoreHorizontal,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  ScrollText,
  Search,
  Send,
  Server,
  Settings as SettingsGlyph,
  Shield,
  ShieldAlert,
  ShieldOff,
  Smartphone,
  Square,
  Sun,
  Terminal,
  Trash2,
  X,
  Zap,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";

/** Every icon in the product renders at one stroke weight and one default size. */
function icon(Base: LucideIcon) {
  return function Glyph({ size = 16, strokeWidth = 1.5, ...rest }: LucideProps) {
    return <Base size={size} strokeWidth={strokeWidth} aria-hidden="true" {...rest} />;
  };
}

export const IconActivity = icon(Activity);
export const IconAlert = icon(AlertTriangle);
export const IconArchive = icon(Archive);
export const IconArrowUp = icon(ArrowUp);
export const IconBrain = icon(Brain);
export const IconDisk = icon(HardDrive);
export const IconEye = icon(Eye);
export const IconEyeOff = icon(EyeOff);
export const IconHistory = icon(History);
export const IconChecks = icon(ListChecks);
export const IconLogs = icon(ScrollText);
export const IconMonitor = icon(Monitor);
export const IconMoon = icon(Moon);
export const IconRailClose = icon(PanelLeftClose);
export const IconRailOpen = icon(PanelLeftOpen);
export const IconShield = icon(Shield);
export const IconShieldAlert = icon(ShieldAlert);
export const IconShieldOff = icon(ShieldOff);
export const IconSpinner = icon(Loader2);
export const IconSun = icon(Sun);
export const IconZap = icon(Zap);
export const IconChart = icon(BarChart3);
export const IconPalette = icon(Palette);
export const IconPhone = icon(Smartphone);
export const IconArrowDown = icon(ArrowDown);
export const IconCheck = icon(Check);
export const IconChevronDown = icon(ChevronDown);
export const IconChevronLeft = icon(ChevronLeft);
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
 * The product mark: a viewfinder framing a single focus point. The brackets are
 * the chat face onto the host; the point is the agent working inside it.
 * Inherits currentColor, so it stays visible on either theme.
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
      <path
        d="M26 8 H19 A11 11 0 0 0 8 19 V26"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.4"
        strokeLinecap="round"
      />
      <path
        d="M22 40 H29 A11 11 0 0 0 40 29 V22"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.4"
        strokeLinecap="round"
      />
      <circle cx="24" cy="24" r="4.2" fill="currentColor" />
    </svg>
  );
}
