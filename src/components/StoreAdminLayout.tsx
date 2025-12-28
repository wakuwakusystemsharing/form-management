'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { 
  LayoutDashboard, 
  FileText, 
  Calendar, 
  ClipboardList, 
  Settings, 
  Menu,
  LogOut,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

interface StoreAdminLayoutProps {
  children: React.ReactNode;
  storeId: string;
  storeName?: string;
  userEmail?: string;
  onLogout?: () => void;
}

const menuItems = [
  { id: 'dashboard', label: 'ダッシュボード', icon: LayoutDashboard },
  { id: 'reservations', label: '予約管理', icon: Calendar },
  { id: 'surveys', label: 'アンケート管理', icon: ClipboardList },
  { id: 'settings', label: '設定', icon: Settings },
];

interface MenuContentProps {
  onItemClick?: () => void;
  storeName?: string;
  userEmail?: string;
  activeTab: string;
  onTabChange: (tabId: string) => void;
  onLogout?: () => void;
  isCollapsed?: boolean;
}

const MenuContent = ({ onItemClick, storeName, userEmail, activeTab, onTabChange, onLogout, isCollapsed = false }: MenuContentProps) => (
    <div className="flex flex-col h-full">
      <div className={cn("border-b", isCollapsed ? "p-2" : "p-4")}>
        {isCollapsed ? (
          <div className="flex justify-center">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="text-xs">{storeName?.charAt(0) || 'S'}</AvatarFallback>
            </Avatar>
          </div>
        ) : (
          <div className="flex items-center space-x-3">
            <Avatar className="h-10 w-10">
              <AvatarFallback>{storeName?.charAt(0) || 'S'}</AvatarFallback>
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
                "w-full flex items-center rounded-lg text-sm font-medium transition-colors",
                isCollapsed ? "justify-center px-2 py-2" : "space-x-3 px-3 py-2",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <Icon className="h-5 w-5" />
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
            <LogOut className="h-5 w-5" />
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
}: StoreAdminLayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();
  
  // 現在のアクティブなタブを判定
  const activeTab = searchParams.get('tab') || 'dashboard';
  
  const handleTabChange = (tabId: string) => {
    router.push(`/${storeId}/admin?tab=${tabId}`);
    setMobileMenuOpen(false);
  };

  return (
    <div className="flex h-screen bg-background">
      {/* デスクトップサイドバー */}
      <aside className={cn(
        "hidden lg:flex lg:flex-col lg:border-r transition-all duration-300 relative",
        sidebarCollapsed ? "lg:w-16" : "lg:w-64"
      )}>
        <MenuContent 
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
            "absolute rounded-full border bg-background shadow-sm hover:bg-accent z-10 transition-all",
            sidebarCollapsed 
              ? "-right-3 top-4 h-6 w-6" 
              : "-right-3 top-4 h-6 w-6"
          )}
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          title={sidebarCollapsed ? "サイドバーを展開" : "サイドバーを折りたたむ"}
        >
          {sidebarCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </aside>

      {/* メインコンテンツ */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* モバイルヘッダー */}
        <header className="lg:hidden border-b bg-background">
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center space-x-3">
              <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-64 p-0">
                  <SheetTitle className="sr-only">メニュー</SheetTitle>
                  <MenuContent 
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
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

