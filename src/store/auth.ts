import { create } from "zustand";
import i18n from "@/i18n";
import { auth, SignInCancelled, type AuthProvider, type User } from "@/services/auth";
import { useOrgPolicy } from "./orgPolicy";
import { useToasts } from "./toasts";

/** Firemní zásady zakázaly přihlášení – místo dialogu jen vysvětlení. */
const signInBlocked = () => {
  if (!useOrgPolicy.getState().disableSignIn) return false;
  useToasts.getState().push("info", i18n.t("orgPolicy.signInBlocked"));
  return true;
};

/** Proč se otevírá přihlášení – podle toho se v dialogu zobrazí vysvětlení. */
export type LoginReason = "general" | "review" | "screenshot";

interface AuthState {
  user: User | null;
  /** Poskytovatel, u kterého právě probíhá přihlášení. */
  pending: AuthProvider | null;
  dialogOpen: boolean;
  reason: LoginReason;
  /** Akce, která se provede hned po úspěšném přihlášení (např. odeslání hodnocení). */
  afterLogin: (() => void) | null;

  openLogin: (reason?: LoginReason) => void;
  closeLogin: () => void;
  signIn: (provider: AuthProvider) => Promise<void>;
  signOut: () => Promise<void>;
  /** Provede akci, nebo nejdřív vyžádá přihlášení a akci provede po něm. */
  requireAuth: (action: () => void, reason?: LoginReason) => void;
}

export const useAuth = create<AuthState>()((set, get) => ({
  user: null,
  pending: null,
  dialogOpen: false,
  reason: "general",
  afterLogin: null,

  openLogin: (reason = "general") => {
    if (!signInBlocked()) set({ dialogOpen: true, reason });
  },
  closeLogin: () => {
    // Zavřený dialog = uživatel přihlášení v prohlížeči nedokončí
    if (get().pending) auth.cancelSignIn();
    set({ dialogOpen: false, afterLogin: null, pending: null });
  },

  signIn: async (provider) => {
    set({ pending: provider });
    try {
      const user = await auth.signIn(provider);
      const action = get().afterLogin;
      set({ user, pending: null, dialogOpen: false, afterLogin: null });
      useToasts.getState().push("success", i18n.t("auth.welcome", { name: user.name }));
      action?.();
    } catch (error) {
      set({ pending: null });
      if (error instanceof SignInCancelled) return;
      console.error("Přihlášení se nepovedlo:", error);
      useToasts.getState().push("error", i18n.t("auth.failed"));
    }
  },

  signOut: async () => {
    await auth.signOut();
    set({ user: null });
    useToasts.getState().push("info", i18n.t("auth.signedOut"));
  },

  requireAuth: (action, reason = "general") => {
    if (get().user) action();
    else if (!signInBlocked()) set({ dialogOpen: true, reason, afterLogin: action });
  },
}));

// Obnovení relace z minula při startu aplikace
void auth.getSession().then((user) => {
  if (user) useAuth.setState({ user });
});
// Vypršení relace nebo obnovení tokenu (Supabase) – stav v liště odpovídá skutečnosti
auth.subscribe((user) => useAuth.setState({ user }));
