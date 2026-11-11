import { useCallback, useEffect, useState } from "react";
import { Bell, Check, CheckCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { NotificationDto } from "@transitum/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface NotificationsResponse {
  items: NotificationDto[];
  unread: number;
}

export function NotificationsMenu() {
  const { t } = useTranslation();
  const [items, setItems] = useState<NotificationDto[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    api<NotificationsResponse>("/api/notifications?pageSize=15")
      .then((d) => {
        setItems(d.items);
        setUnread(d.unread);
      })
      .catch(() => {});
  }, []);

  // Pré-carregar para o badge; recarregar ao abrir
  useEffect(load, [load]);
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function markRead(n: NotificationDto) {
    if (n.readAt) return;
    setItems((prev) =>
      prev.map((i) => (i.id === n.id ? { ...i, readAt: new Date().toISOString() } : i)),
    );
    setUnread((u) => Math.max(0, u - 1));
    try {
      await api(`/api/notifications/${n.id}/read`, { method: "POST" });
    } catch {
      load();
    }
  }

  async function markAll() {
    setItems((prev) => prev.map((i) => ({ ...i, readAt: i.readAt ?? new Date().toISOString() })));
    setUnread(0);
    try {
      await api("/api/notifications/read-all", { method: "POST" });
    } catch {
      load();
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={t("common.notifications")}>
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96">
        <div className="flex items-center justify-between px-2 py-1">
          <DropdownMenuLabel className="p-0">{t("common.notifications")}</DropdownMenuLabel>
          {unread > 0 && (
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={markAll}>
              <CheckCheck className="h-3.5 w-3.5" />
              {t("notifications.markAll")}
            </Button>
          )}
        </div>
        <DropdownMenuSeparator />
        <div className="max-h-80 overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-2 py-4 text-center text-sm text-muted-foreground">
              {t("common.noNotifications")}
            </p>
          ) : (
            items.map((n) => {
              const body = (
                <div
                  className={cn(
                    "flex w-full items-start justify-between gap-2 rounded-md px-2 py-2 text-sm",
                    !n.readAt && "bg-accent/40",
                  )}
                >
                  <div className="min-w-0">
                    <p className={cn("truncate", !n.readAt ? "font-medium" : "text-muted-foreground")}>
                      {n.title}
                    </p>
                    {n.body && (
                      <p className="truncate text-xs text-muted-foreground">{n.body}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {new Date(n.createdAt).toLocaleString("pt-PT")}
                    </p>
                  </div>
                  {!n.readAt && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      aria-label={t("notifications.markRead")}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void markRead(n);
                      }}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              );
              return n.link ? (
                <Link
                  key={n.id}
                  to={n.link}
                  onClick={() => {
                    void markRead(n);
                    setOpen(false);
                  }}
                  className="block hover:bg-accent/50"
                >
                  {body}
                </Link>
              ) : (
                <div key={n.id} className="hover:bg-accent/50">
                  {body}
                </div>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
