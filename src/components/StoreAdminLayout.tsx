'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  FileText,
  Calendar,
  ClipboardList,
  Gift,
  Settings,
  Menu,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Users
} from 'lucide-react';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { applyUiStyle, applyM3Palette, clearUiStyle, UI_STYLE_CHANGE_EVENT } from '@/lib/ui-style';
import { resolveVisibleTabs, type StoreAdminTabId } from '@/lib/store-admin-tabs';

interface StoreAdminLayoutProps {
  children: React.ReactNode;
  storeId: string;
  storeName?: string;
  userEmail?: string;
  onLogout?: () => void;
  /** 店舗テーマカラー（HEX）。Material スタイル時のダイナミックカラーのシードに使う */
  themeColor?: string | null;
  /** 表示するタブ（stores.admin_visible_tabs）。null / 未指定 = すべて表示 */
  visibleTabs?: StoreAdminTabId[] | null;
}

const allMenuItems: { id: StoreAdminTabId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: 'ダッシュボード', icon: LayoutDashboard },
  { id: 'reservations', label: '予約管理', icon: Calendar },
  { id: 'customers', label: '顧客管理 β', icon: Users },
  { id: 'surveys', label: 'アンケート管理', icon: ClipboardList },
  { id: 'lotteries', label: '抽選管理', icon: Gift },
  { id: 'settings', label: '設定', icon: Settings },
];

interface MenuContentProps {
  menuItems: typeof allMenuItems;
  onItemClick?: () => void;
  storeName?: string;
  userEmail?: string;
  activeTab: string;
  onTabChange: (tabId: string) => void;
  onLogout?: () => void;
  isCollapsed?: boolean;
}

const MenuContent = ({ menuItems, onItemClick, storeName, userEmail, activeTab, onTabChange, onLogout, isCollapsed = false }: MenuContentProps) => (
    <div className="flex flex-col h-full">
      <div className={cn("border-b", isCollapsed ? "p-2" : "p-4")}>
        {isCollapsed ? (
          <div className="flex justify-center">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="text-xs bg-[rgb(244,144,49)] text-white">{storeName?.charAt(0) || 'S'}</AvatarFallback>
            </Avatar>
          </div>
        ) : (
          <div className="flex items-center space-x-3">
            <Avatar className="h-10 w-10">
              <AvatarFallback className="bg-[rgb(244,144,49)] text-white">{storeName?.charAt(0) || 'S'}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{storeName || '店舗'}</p>
              {userEmail && (
                <p className="text-xs text-muted-foreground truncate">{userEmail}</p>
              )}
            </div>
          </div>
        )}
      </div>
      
      <nav className={cn("flex-1 space-y-1", isCollapsed ? "p-2" : "p-4")}>
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          
          return (
            <button
              key={item.id}
              onClick={() => {
                onTabChange(item.id);
                onItemClick?.();
              }}
              title={isCollapsed ? item.label : undefined}
              className={cn(
                "w-full flex items-center rounded-lg text-sm font-medium transition-[background-color,color] duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
                isCollapsed ? "justify-center px-2 py-2" : "space-x-3 px-3 py-2",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              {!isCollapsed && <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>
      
      {onLogout && (
        <div className={cn("border-t", isCollapsed ? "p-2" : "p-4")}>
          <Button
            variant="ghost"
            className={cn(
              "w-full transition-colors",
              isCollapsed ? "justify-center px-2" : "justify-start"
            )}
            onClick={onLogout}
            title={isCollapsed ? "ログアウト" : undefined}
          >
            <LogOut className="h-5 w-5" aria-hidden="true" />
            {!isCollapsed && <span className="ml-3">ログアウト</span>}
          </Button>
        </div>
      )}
    </div>
  );

export default function StoreAdminLayout({
  children,
  storeId,
  storeName,
  userEmail,
  onLogout,
  themeColor,
  visibleTabs,
}: StoreAdminLayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();

  // 店舗設定で非表示にされたタブを除外（null = すべて表示）
  const visibleIds = resolveVisibleTabs(visibleTabs);
  const menuItems = allMenuItems.filter((item) => visibleIds.includes(item.id));

  // 表示スタイル（標準 / Material）を <html data-ui> に反映。画面幅の変化・設定変更にも追従し、離脱時に解除
  useEffect(() => {
    applyUiStyle();
    const onResize = () => applyUiStyle();
    const onChange = () => applyUiStyle();
    window.addEventListener('resize', onResize);
    window.addEventListener(UI_STYLE_CHANGE_EVENT, onChange);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener(UI_STYLE_CHANGE_EVENT, onChange);
      clearUiStyle();
    };
  }, []);

  // ダイナミックカラー: 店舗テーマカラーに合わせてパレットを差し替え（離脱時に既定へ戻す）
  useEffect(() => {
    applyM3Palette(themeColor);
    return () => applyM3Palette(null);
  }, [themeColor]);
  
  // 現在のアクティブなタブを判定
  const activeTab = searchParams.get('tab') || 'dashboard';

  // 非表示タブに URL で直接アクセスされた場合は、表示可能な先頭のタブへ移動
  const firstVisible = menuItems[0]?.id;
  const activeTabHidden = !menuItems.some((item) => item.id === activeTab);
  useEffect(() => {
    if (activeTabHidden && firstVisible) {
      router.replace(`/${storeId}/admin?tab=${firstVisible}`);
    }
  }, [activeTabHidden, firstVisible, router, storeId]);
  
  const handleTabChange = (tabId: string) => {
    router.push(`/${storeId}/admin?tab=${tabId}`);
    setMobileMenuOpen(false);
  };

  return (
    <div className="store-admin-bg flex h-dvh bg-background" data-slot="store-admin-root">
      {/* デスクトップサイドバー */}
      <aside className={cn(
        "hidden lg:flex lg:flex-col lg:border-r transition-[width] duration-300 relative bg-white",
        sidebarCollapsed ? "lg:w-16" : "lg:w-64"
      )}>
        <MenuContent
          menuItems={menuItems}
          storeName={storeName}
          userEmail={userEmail}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          onLogout={onLogout}
          isCollapsed={sidebarCollapsed}
        />
        {/* 折りたたみボタン */}
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "absolute rounded-full border border-[rgb(244,144,49)]/40 bg-[rgb(254,225,190)] text-[rgb(200,100,10)] shadow-sm hover:bg-[rgb(244,144,49)] hover:text-white hover:border-[rgb(244,144,49)] z-10 transition-all duration-150",
            sidebarCollapsed 
              ? "-right-3 top-4 h-6 w-6" 
              : "-right-3 top-4 h-6 w-6"
          )}
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          aria-label={sidebarCollapsed ? "サイドバーを展開" : "サイドバーを折りたたむ"}
        >
          {sidebarCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </aside>

      {/* メインコンテンツ */}
      <div className="flex-1 min-w-0 w-full flex flex-col overflow-hidden">
        {/* モバイルヘッダー */}
        <header className="lg:hidden border-b bg-white shadow-sm" data-slot="mobile-header">
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center space-x-3">
              <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="メニューを開く">
                    <Menu className="h-5 w-5" aria-hidden="true" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-64 p-0">
                  <SheetTitle className="sr-only">メニュー</SheetTitle>
                  <MenuContent
                    menuItems={menuItems}
                    onItemClick={() => setMobileMenuOpen(false)}
                    storeName={storeName}
                    userEmail={userEmail}
                    activeTab={activeTab}
                    onTabChange={handleTabChange}
                    onLogout={onLogout}
                  />
                </SheetContent>
              </Sheet>
              <div>
                <h1 className="text-lg font-semibold">{storeName || '店舗管理'}</h1>
                {userEmail && (
                  <p className="text-xs text-muted-foreground">{userEmail}</p>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* コンテンツエリア */}
        <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden overscroll-y-contain">
          {children}
        </main>

        {/* モバイル下部ナビゲーション（片手操作用。PC はサイドバー） */}
        <nav
          className="lg:hidden shrink-0 border-t bg-white pb-[env(safe-area-inset-bottom)]"
          aria-label="主要メニュー"
          data-slot="mobile-nav"
        >
          <ul className="grid" style={{ gridTemplateColumns: `repeat(${menuItems.length}, minmax(0, 1fr))` }}>
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => handleTabChange(item.id)}
                    aria-current={isActive ? 'page' : undefined}
                    data-slot="mobile-nav-item"
                    data-active={isActive ? 'true' : undefined}
                    className={cn(
                      "w-full min-h-14 flex flex-col items-center justify-center gap-0.5 px-1 py-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                      isActive ? "text-primary" : "text-muted-foreground"
                    )}
                  >
                    <span data-slot="mobile-nav-indicator" className={cn(
                      "flex items-center justify-center h-7 w-12 rounded-full transition-colors",
                      isActive && "bg-primary/15"
                    )}>
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="truncate max-w-full">{item.label.replace(' β', '')}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );
}

