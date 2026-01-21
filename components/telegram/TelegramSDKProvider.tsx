'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { MOCK_TELEGRAM_USER, type MockTelegramUser } from '@/lib/telegram/mock-data';

// =============================================================================
// TYPES
// =============================================================================

interface ThemeParams {
  backgroundColor: string;
  textColor: string;
  hintColor: string;
  linkColor: string;
  buttonColor: string;
  buttonTextColor: string;
  secondaryBackgroundColor: string;
}

interface TelegramSDKContextType {
  // Estado
  isReady: boolean;
  isMock: boolean;
  isDark: boolean;

  // Usuário
  user: MockTelegramUser | null;
  isLinked: boolean;

  // Theme
  themeParams: ThemeParams;

  // Actions
  setIsLinked: (linked: boolean) => void;
  showAlert: (message: string) => void;
  showConfirm: (message: string) => Promise<boolean>;
  hapticFeedback: (type: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error') => void;
  close: () => void;
  expand: () => void;
  requestFullscreen: () => void;
}

// =============================================================================
// DEFAULT THEME (Dark mode - estilo Telegram)
// =============================================================================

const DARK_THEME: ThemeParams = {
  backgroundColor: '#18181b',      // zinc-900
  textColor: '#fafafa',            // zinc-50
  hintColor: '#a1a1aa',            // zinc-400
  linkColor: '#60a5fa',            // blue-400
  buttonColor: '#22c55e',          // green-500 (primary SmartZap)
  buttonTextColor: '#ffffff',
  secondaryBackgroundColor: '#27272a', // zinc-800
};

const LIGHT_THEME: ThemeParams = {
  backgroundColor: '#ffffff',
  textColor: '#18181b',
  hintColor: '#71717a',
  linkColor: '#2563eb',
  buttonColor: '#16a34a',
  buttonTextColor: '#ffffff',
  secondaryBackgroundColor: '#f4f4f5',
};

// =============================================================================
// CONTEXT
// =============================================================================

const TelegramSDKContext = createContext<TelegramSDKContextType | null>(null);

// =============================================================================
// PROVIDER
// =============================================================================

interface TelegramSDKProviderProps {
  children: ReactNode;
}

export function TelegramSDKProvider({ children }: TelegramSDKProviderProps) {
  const [isReady, setIsReady] = useState(false);
  const [isDark, setIsDark] = useState(true);
  const [isLinked, setIsLinked] = useState(MOCK_TELEGRAM_USER.isLinked);
  const [isMock, setIsMock] = useState(true);

  // Theme baseado no modo dark/light
  const themeParams = isDark ? DARK_THEME : LIGHT_THEME;

  // Inicialização
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Verificar se estamos no Telegram
    const tg = window.Telegram?.WebApp;

    if (tg) {
      setIsMock(false);

      // Sinalizar que estamos prontos
      tg.ready();

      // Expandir para altura máxima
      tg.expand();

      // Tentar fullscreen (Bot API 8.0+)
      try {
        if (typeof tg.requestFullscreen === 'function') {
          tg.requestFullscreen();
        }
      } catch (e) {
        console.log('Fullscreen not supported');
      }

      // Desabilitar swipe para fechar (Bot API 7.7+)
      try {
        if (typeof tg.disableVerticalSwipes === 'function') {
          tg.disableVerticalSwipes();
        }
      } catch (e) {
        console.log('disableVerticalSwipes not supported');
      }

      // Configurar tema
      setIsDark(tg.colorScheme === 'dark');

      // Aplicar theme params do Telegram se disponível
      if (tg.themeParams) {
        const root = document.documentElement;
        const tp = tg.themeParams;
        if (tp.bg_color) root.style.setProperty('--tg-theme-bg-color', tp.bg_color);
        if (tp.text_color) root.style.setProperty('--tg-theme-text-color', tp.text_color);
        if (tp.hint_color) root.style.setProperty('--tg-theme-hint-color', tp.hint_color);
        if (tp.link_color) root.style.setProperty('--tg-theme-link-color', tp.link_color);
        if (tp.button_color) root.style.setProperty('--tg-theme-button-color', tp.button_color);
        if (tp.button_text_color) root.style.setProperty('--tg-theme-button-text-color', tp.button_text_color);
        if (tp.secondary_bg_color) root.style.setProperty('--tg-theme-secondary-bg-color', tp.secondary_bg_color);
      }

      setIsReady(true);
      console.log('📱 Telegram Mini App initialized');
      return;
    }

    // Mock mode
    setIsMock(true);
    console.log('🤖 Telegram Mock Mode');

    // Simular delay de inicialização
    const timer = setTimeout(() => {
      setIsReady(true);
    }, 300);

    return () => clearTimeout(timer);
  }, []);

  // Aplicar CSS variables do theme (mock mode)
  useEffect(() => {
    if (typeof window === 'undefined' || !isMock) return;

    const root = document.documentElement;
    root.style.setProperty('--tg-theme-bg-color', themeParams.backgroundColor);
    root.style.setProperty('--tg-theme-text-color', themeParams.textColor);
    root.style.setProperty('--tg-theme-hint-color', themeParams.hintColor);
    root.style.setProperty('--tg-theme-link-color', themeParams.linkColor);
    root.style.setProperty('--tg-theme-button-color', themeParams.buttonColor);
    root.style.setProperty('--tg-theme-button-text-color', themeParams.buttonTextColor);
    root.style.setProperty('--tg-theme-secondary-bg-color', themeParams.secondaryBackgroundColor);

    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [themeParams, isDark, isMock]);

  // Actions
  const showAlert = (message: string) => {
    const tg = window.Telegram?.WebApp;
    if (tg?.showAlert) {
      tg.showAlert(message);
    } else {
      alert(`[Telegram Alert]\n${message}`);
    }
  };

  const showConfirm = (message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      const tg = window.Telegram?.WebApp;
      if (tg?.showConfirm) {
        tg.showConfirm(message, resolve);
      } else {
        resolve(confirm(`[Telegram Confirm]\n${message}`));
      }
    });
  };

  const hapticFeedback = (type: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error') => {
    const hf = window.Telegram?.WebApp?.HapticFeedback;
    if (hf) {
      if (['light', 'medium', 'heavy'].includes(type)) {
        hf.impactOccurred(type as 'light' | 'medium' | 'heavy');
      } else {
        hf.notificationOccurred(type as 'success' | 'warning' | 'error');
      }
    } else {
      console.log(`📳 Haptic: ${type}`);
    }
  };

  const close = () => {
    const tg = window.Telegram?.WebApp;
    if (tg?.close) {
      tg.close();
    } else {
      console.log('🚪 Mini App close (mock)');
    }
  };

  const expand = () => {
    const tg = window.Telegram?.WebApp;
    if (tg?.expand) {
      tg.expand();
    } else {
      console.log('📐 Mini App expand (mock)');
    }
  };

  const requestFullscreen = () => {
    const tg = window.Telegram?.WebApp;
    if (tg && typeof (tg as any).requestFullscreen === 'function') {
      (tg as any).requestFullscreen();
    } else {
      console.log('📐 Fullscreen not supported (mock)');
    }
  };

  const contextValue: TelegramSDKContextType = {
    isReady,
    isMock,
    isDark,
    user: MOCK_TELEGRAM_USER,
    isLinked,
    themeParams,
    setIsLinked,
    showAlert,
    showConfirm,
    hapticFeedback,
    close,
    expand,
    requestFullscreen,
  };

  return (
    <TelegramSDKContext.Provider value={contextValue}>
      {children}
    </TelegramSDKContext.Provider>
  );
}

// =============================================================================
// HOOK
// =============================================================================

export function useTelegramSDK() {
  const context = useContext(TelegramSDKContext);
  if (!context) {
    throw new Error('useTelegramSDK must be used within TelegramSDKProvider');
  }
  return context;
}

// =============================================================================
// TYPES DECLARATION (para window.Telegram)
// =============================================================================

declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        // Core
        ready: () => void;
        expand: () => void;
        close: () => void;

        // Fullscreen (Bot API 8.0+)
        requestFullscreen?: () => void;
        exitFullscreen?: () => void;
        isFullscreen?: boolean;

        // Swipes (Bot API 7.7+)
        disableVerticalSwipes?: () => void;
        enableVerticalSwipes?: () => void;
        isVerticalSwipesEnabled?: boolean;

        // Theme
        colorScheme: 'light' | 'dark';
        themeParams: {
          bg_color?: string;
          text_color?: string;
          hint_color?: string;
          link_color?: string;
          button_color?: string;
          button_text_color?: string;
          secondary_bg_color?: string;
          header_bg_color?: string;
          accent_text_color?: string;
          section_bg_color?: string;
          section_header_text_color?: string;
          subtitle_text_color?: string;
          destructive_text_color?: string;
        };

        // Popups
        showAlert: (message: string, callback?: () => void) => void;
        showConfirm: (message: string, callback: (confirmed: boolean) => void) => void;
        showPopup: (params: {
          title?: string;
          message: string;
          buttons?: Array<{
            id?: string;
            type?: 'default' | 'ok' | 'close' | 'cancel' | 'destructive';
            text?: string;
          }>;
        }, callback?: (buttonId: string) => void) => void;

        // Buttons
        MainButton: {
          text: string;
          color: string;
          textColor: string;
          isVisible: boolean;
          isActive: boolean;
          isProgressVisible: boolean;
          setText: (text: string) => void;
          show: () => void;
          hide: () => void;
          enable: () => void;
          disable: () => void;
          showProgress: (leaveActive?: boolean) => void;
          hideProgress: () => void;
          onClick: (callback: () => void) => void;
          offClick: (callback: () => void) => void;
          setParams: (params: {
            text?: string;
            color?: string;
            text_color?: string;
            is_active?: boolean;
            is_visible?: boolean;
          }) => void;
        };
        BackButton: {
          isVisible: boolean;
          show: () => void;
          hide: () => void;
          onClick: (callback: () => void) => void;
          offClick: (callback: () => void) => void;
        };
        SettingsButton?: {
          isVisible: boolean;
          show: () => void;
          hide: () => void;
          onClick: (callback: () => void) => void;
          offClick: (callback: () => void) => void;
        };

        // Haptic
        HapticFeedback: {
          impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
          notificationOccurred: (type: 'success' | 'warning' | 'error') => void;
          selectionChanged: () => void;
        };

        // User data
        initData: string;
        initDataUnsafe: {
          query_id?: string;
          user?: {
            id: number;
            first_name: string;
            last_name?: string;
            username?: string;
            language_code?: string;
            is_premium?: boolean;
            photo_url?: string;
          };
          receiver?: {
            id: number;
            first_name: string;
            last_name?: string;
            username?: string;
            photo_url?: string;
          };
          chat?: {
            id: number;
            type: 'group' | 'supergroup' | 'channel';
            title: string;
            username?: string;
            photo_url?: string;
          };
          chat_type?: 'sender' | 'private' | 'group' | 'supergroup' | 'channel';
          chat_instance?: string;
          start_param?: string;
          can_send_after?: number;
          auth_date: number;
          hash: string;
        };

        // Viewport
        viewportHeight: number;
        viewportStableHeight: number;
        isExpanded: boolean;

        // Platform
        platform: string;
        version: string;

        // Cloud Storage
        CloudStorage?: {
          setItem: (key: string, value: string, callback?: (error: Error | null, success?: boolean) => void) => void;
          getItem: (key: string, callback: (error: Error | null, value?: string) => void) => void;
          getItems: (keys: string[], callback: (error: Error | null, values?: Record<string, string>) => void) => void;
          removeItem: (key: string, callback?: (error: Error | null, success?: boolean) => void) => void;
          removeItems: (keys: string[], callback?: (error: Error | null, success?: boolean) => void) => void;
          getKeys: (callback: (error: Error | null, keys?: string[]) => void) => void;
        };

        // Biometric
        BiometricManager?: {
          isInited: boolean;
          isBiometricAvailable: boolean;
          biometricType: 'finger' | 'face' | 'unknown';
          isAccessRequested: boolean;
          isAccessGranted: boolean;
          isBiometricTokenSaved: boolean;
          deviceId: string;
          init: (callback?: () => void) => void;
          requestAccess: (params: { reason?: string }, callback?: (granted: boolean) => void) => void;
          authenticate: (params: { reason?: string }, callback?: (success: boolean, token?: string) => void) => void;
          updateBiometricToken: (token: string, callback?: (updated: boolean) => void) => void;
          openSettings: () => void;
        };

        // Events
        onEvent: (eventType: string, callback: () => void) => void;
        offEvent: (eventType: string, callback: () => void) => void;

        // Utils
        sendData: (data: string) => void;
        switchInlineQuery: (query: string, choose_chat_types?: string[]) => void;
        openLink: (url: string, options?: { try_instant_view?: boolean }) => void;
        openTelegramLink: (url: string) => void;
        openInvoice: (url: string, callback?: (status: 'paid' | 'cancelled' | 'failed' | 'pending') => void) => void;
        readTextFromClipboard: (callback?: (text: string | null) => void) => void;
        requestWriteAccess: (callback?: (granted: boolean) => void) => void;
        requestContact: (callback?: (shared: boolean) => void) => void;
        setHeaderColor: (color: 'bg_color' | 'secondary_bg_color' | string) => void;
        setBackgroundColor: (color: 'bg_color' | 'secondary_bg_color' | string) => void;
        enableClosingConfirmation: () => void;
        disableClosingConfirmation: () => void;
      };
    };
  }
}
