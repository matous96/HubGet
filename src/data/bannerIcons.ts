import {
  AppWindow, Archive, AtSign, Atom, Bitcoin, BookOpen, Bookmark, Bot, Braces, Brain, Briefcase, Brush, Bug,
  Cable, Calculator, Calendar, Camera, Cast, Clapperboard, Clipboard, Clock, Cloud, CloudDownload, CloudUpload,
  Code2, Coins, Compass, Cpu, CreditCard, Crop, Crown, Database, Dice5, Disc3, Download, Droplet, Eye, FileCode,
  FileText, Film, Fingerprint, FlaskConical, Folder, FolderSync, Gamepad2, Gauge, GitBranch, Globe, GraduationCap,
  Guitar, Hammer, HardDrive, Headphones, Heart, Image, Joystick, Key, KeyRound, Landmark, Languages, Layers,
  LayoutDashboard, Lightbulb, Link, Lock, Mail, MemoryStick, MessageCircle, MessageSquareText, Mic, Microscope,
  Monitor, Moon, Music, Network, Notebook, Paintbrush, Palette, PenTool, Phone, Piano, PiggyBank, Pipette, Play,
  Popcorn, Power, Puzzle, Radar, Radio, Receipt, RefreshCw, Router, Ruler, ScanFace, Scissors, Search, Send,
  Server, Settings, Settings2, Shapes, Share2, Shield, ShieldCheck, Smile, Sparkles, Speaker, SquareCheck, Sun,
  Swords, Table, Target, Telescope, Terminal, TrendingUp, Trophy, Tv, Users, Video, Wallet, Wallpaper, Wand2,
  Wifi, Wrench, Zap, type LucideIcon,
} from "lucide-react";
import type { CategoryId } from "@/types";

/**
 * Ikony pro dekorativní vzorek v banneru detailu – podle kategorie,
 * podobně jako „doodle“ pozadí bannerů v App Store.
 */
export const BANNER_ICONS: Record<CategoryId, LucideIcon[]> = {
  browsers: [Globe, Compass, Bookmark, Search, Link, Wifi, Shield, Heart],
  development: [Code2, Terminal, Braces, GitBranch, Bug, Cpu, Database, FileCode],
  communication: [MessageCircle, Phone, Video, Mail, Smile, Users, Send, AtSign, Heart],
  games: [Gamepad2, Trophy, Joystick, Swords, Dice5, Crown, Target, Puzzle],
  multimedia: [Film, Play, Clapperboard, Tv, Camera, Video, Popcorn, Monitor],
  audio: [Music, Headphones, Mic, Radio, Disc3, Guitar, Piano, Speaker],
  ai: [Sparkles, Bot, Brain, Wand2, Lightbulb, MessageSquareText, Cpu, Atom],
  cloud: [Cloud, CloudUpload, CloudDownload, HardDrive, FolderSync, RefreshCw, Server, Share2],
  education: [GraduationCap, BookOpen, Microscope, Atom, Calculator, FlaskConical, Telescope, Languages],
  finance: [Wallet, Coins, Landmark, PiggyBank, Receipt, TrendingUp, CreditCard, Bitcoin],
  network: [Network, Router, Wifi, Cable, Radar, Download, Globe, Cast],
  personalization: [Wallpaper, Paintbrush, Palette, Sun, Moon, LayoutDashboard, AppWindow, Droplet],
  other: [Shapes, Puzzle, Layers, Folder, Zap, Heart, Smile, Bookmark],
  graphics: [Palette, Brush, PenTool, Image, Shapes, Pipette, Layers, Crop],
  productivity: [FileText, Calendar, SquareCheck, Clipboard, Notebook, Briefcase, Clock, Table],
  utilities: [Wrench, Hammer, Settings, Zap, Archive, Folder, Scissors, Ruler],
  security: [Shield, Lock, Key, Fingerprint, Eye, ShieldCheck, ScanFace, KeyRound],
  system: [Cpu, HardDrive, MemoryStick, Monitor, Settings2, Power, Gauge, Server],
};
