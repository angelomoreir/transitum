import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Copy, MoreHorizontal, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { inviteUserSchema, type UserDto, type Role } from "@blujay/shared";
import { api, ApiRequestError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const PAGE_SIZE = 20;

const STATUS_VARIANT: Record<UserDto["status"], "success" | "warning" | "secondary"> = {
  active: "success",
  invited: "warning",
  suspended: "secondary",
};

export function UsersPage() {
  const { t } = useTranslation();
  const { user: me, can } = useAuth();
  const [data, setData] = useState<{ items: UserDto[]; total: number } | null>(null);
  const [q, setQ] = useState("");
  const [role, setRole] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    const res = await api<{ items: UserDto[]; total: number; page: number; pageSize: number }>(
      "/api/users",
      { params: { page, pageSize: PAGE_SIZE, q, role, status } },
    );
    setData(res);
  }, [page, q, role, status]);

  useEffect(() => {
    load().catch((e) => toast.error(e.message));
  }, [load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("users.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("users.subtitle")}</p>
        </div>
        {can("users:invite") && <InviteDialog onDone={load} />}
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          className="max-w-64"
          placeholder={t("users.search")}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <Select
          value={role}
          onValueChange={(v) => {
            setRole(v === "all" ? "" : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder={t("users.allRoles")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("users.allRoles")}</SelectItem>
            {(["admin", "manager", "operator", "viewer"] as const).map((r) => (
              <SelectItem key={r} value={r}>
                {t(`users.roles.${r}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v === "all" ? "" : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder={t("users.allStatuses")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("users.allStatuses")}</SelectItem>
            {(["invited", "active", "suspended"] as const).map((s) => (
              <SelectItem key={s} value={s}>
                {t(`users.statuses.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("auth.name")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("auth.email")}</TableHead>
              <TableHead>{t("users.role")}</TableHead>
              <TableHead>{t("users.status")}</TableHead>
              <TableHead className="hidden lg:table-cell">{t("users.lastLogin")}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : data.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  {t("users.empty")}
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.name}</TableCell>
                  <TableCell className="hidden md:table-cell">{u.email}</TableCell>
                  <TableCell>{t(`users.roles.${u.role}`)}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[u.status]}>
                      {t(`users.statuses.${u.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-muted-foreground">
                    {u.lastLoginAt
                      ? new Date(u.lastLoginAt).toLocaleString("pt-PT")
                      : t("users.never")}
                  </TableCell>
                  <TableCell>
                    <UserActions user={u} self={u.id === me?.id} onDone={load} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{t("common.results", { count: data?.total ?? 0 })}</span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {t("common.previous")}
          </Button>
          <span>{t("common.page", { page })}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("common.next")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function InviteDialog({ onDone }: { onDone: () => Promise<void> }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "operator" as Role });
  const [inviteUrl, setInviteUrl] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = inviteUserSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? t("common.error"));
      return;
    }
    setLoading(true);
    try {
      const res = await api<{ user: UserDto; inviteUrl: string }>("/api/users/invite", {
        method: "POST",
        body: parsed.data,
      });
      setInviteUrl(res.inviteUrl);
      toast.success(t("users.invitedSuccess", { email: res.user.email }));
      await onDone();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setInviteUrl("");
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="h-4 w-4" />
          {t("users.invite")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("users.inviteTitle")}</DialogTitle>
          <DialogDescription>{t("users.inviteDesc")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="invite-name">{t("auth.name")}</Label>
            <Input
              id="invite-name"
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">{t("auth.email")}</Label>
            <Input
              id="invite-email"
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("users.role")}</Label>
            <Select
              value={form.role}
              onValueChange={(v) => setForm((f) => ({ ...f, role: v as Role }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["manager", "operator", "viewer"] as const).map((r) => (
                  <SelectItem key={r} value={r}>
                    {t(`users.roles.${r}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {inviteUrl && (
            <div className="space-y-1.5">
              <Label>{t("users.inviteLink")}</Label>
              <div className="flex gap-2">
                <Input id="invite-url" readOnly value={inviteUrl} className="text-xs" />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    navigator.clipboard.writeText(inviteUrl);
                    toast.success(t("users.copied"));
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? t("common.loading") : t("users.invite")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UserActions({
  user,
  self,
  onDone,
}: {
  user: UserDto;
  self: boolean;
  onDone: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { can } = useAuth();

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await onDone();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    }
  };

  if (self && !can("users:update")) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {user.status === "invited" && can("users:invite") && (
          <DropdownMenuItem
            onClick={() =>
              run(async () => {
                const res = await api<{ inviteUrl: string }>(
                  `/api/users/${user.id}/resend-invite`,
                  { method: "POST" },
                );
                await navigator.clipboard.writeText(res.inviteUrl);
                toast.success(t("users.copied"));
              })
            }
          >
            {t("users.resendInvite")}
          </DropdownMenuItem>
        )}
        {can("users:update") && !self && (
          <>
            <DropdownMenuSeparator />
            {(["admin", "manager", "operator", "viewer"] as const)
              .filter((r) => r !== user.role)
              .map((r) => (
                <DropdownMenuItem
                  key={r}
                  onClick={() =>
                    run(() =>
                      api(`/api/users/${user.id}`, { method: "PATCH", body: { role: r } }),
                    )
                  }
                >
                  {t("users.changeRole")}: {t(`users.roles.${r}`)}
                </DropdownMenuItem>
              ))}
          </>
        )}
        {can("users:suspend") && !self && (
          <>
            <DropdownMenuSeparator />
            {user.status === "suspended" ? (
              <DropdownMenuItem
                onClick={() =>
                  run(() =>
                    api(`/api/users/${user.id}`, {
                      method: "PATCH",
                      body: { status: "active" },
                    }),
                  )
                }
              >
                {t("users.reactivate")}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                className="text-destructive"
                onClick={() =>
                  run(() => api(`/api/users/${user.id}`, { method: "DELETE" }))
                }
              >
                {t("users.suspend")}
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
