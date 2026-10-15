import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { NotificationDto } from "@blujay/shared";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const READ_KEY = "blujay:notifications:read";

const ACTION_LABELS: Record<string, string> = {
  "tenant.registered": "Empresa registada",
  "auth.login": "Início de sessão",
  "auth.password_reset_requested": "Recuperação de palavra-passe pedida",
  "auth.password_reset": "Palavra-passe redefinida",
  "auth.password_changed": "Palavra-passe alterada",
  "users.invited": "Utilizador convidado",
  "users.invite_accepted": "Convite aceite",
  "users.invite_resent": "Convite reenviado",
  "users.updated": "Utilizador atualizado",
  "users.suspended": "Utilizador suspenso",
  "tenant.updated": "Empresa atualizada",
};

export function NotificationsMenu() {
  const { t } = useTranslation();
  const [items, setItems] = useState<NotificationDto[]>([]);
  const [open, setOpen] = useState(false);
  const [lastRead, setLastRead] = useState<string>(() => localStorage.getItem(READ_KEY) ?? "");

  useEffect(() => {
    if (!open) return;
    api<{ items: NotificationDto[] }>("/api/notifications")
      .then((d) => {
        setItems(d.items);
        const newest = d.items[0]?.createdAt;
        if (newest) {
          setLastRead(newest);
          localStorage.setItem(READ_KEY, newest);
        }
      })
      .catch(() => {});
  }, [open]);

  // Pré-carregar para o badge sem abrir
  useEffect(() => {
    api<{ items: NotificationDto[] }>("/api/notifications")
      .then((d) => setItems(d.items))
      .catch(() => {});
  }, []);

  const unread = items.filter((i) => !lastRead || i.createdAt > lastRead).length;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>{t("common.notifications")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="max-h-80 overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-2 py-4 text-center text-sm text-muted-foreground">
              {t("common.noNotifications")}
            </p>
          ) : (
            items.map((n) => (
              <div key={n.id} className="px-2 py-2 text-sm">
                <p className="font-medium">{ACTION_LABELS[n.action] ?? n.action}</p>
                <p className="text-xs text-muted-foreground">
                  {n.actorName ?? "Sistema"} · {new Date(n.createdAt).toLocaleString("pt-PT")}
                </p>
              </div>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
