import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type {
  PickWaveRecordDetailDto,
  PickWaveRecordDto,
  PickWaveStatus,
  UserDto,
} from "@transitum/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
const STATUSES: PickWaveStatus[] = ["open", "in_progress", "done", "cancelled"];
const VARIANT: Record<PickWaveStatus, "secondary" | "outline" | "success" | "destructive"> = {
  open: "secondary",
  in_progress: "outline",
  done: "success",
  cancelled: "destructive",
};

interface ListResponse {
  items: PickWaveRecordDto[];
  total: number;
}

/** Waves de picking persistidas — atribuição a operador e registo por linha. */
export function PickWavesPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [data, setData] = useState<ListResponse | null>(null);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<PickWaveRecordDetailDto | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [users, setUsers] = useState<UserDto[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setData(
      await api<ListResponse>("/api/pick-waves", {
        params: { page, pageSize: PAGE_SIZE, status: status || undefined },
      }),
    );
  }, [page, status]);

  useEffect(() => {
    load().catch((e) => toast.error(e.message));
  }, [load]);

  // Lista de operadores para atribuição — falha silenciosa sem users:read
  useEffect(() => {
    api<{ items: UserDto[] }>("/api/users", { params: { pageSize: 100 } })
      .then((r) => setUsers(r.items.filter((u) => u.status === "active")))
      .catch(() => setUsers([]));
  }, []);

  async function openDetail(id: string) {
    try {
      const r = await api<{ wave: PickWaveRecordDetailDto }>(`/api/pick-waves/${id}`);
      setDetail(r.wave);
      setPicked(Object.fromEntries(r.wave.lines.map((l) => [l.id, String(l.pickedQty)])));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.error"));
    }
  }

  async function patch(action: () => Promise<{ wave: PickWaveRecordDetailDto }>) {
    setBusy(true);
    try {
      const r = await action();
      setDetail(r.wave);
      setPicked(Object.fromEntries(r.wave.lines.map((l) => [l.id, String(l.pickedQty)])));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  const assign = (userId: string | null) =>
    patch(() =>
      api<{ wave: PickWaveRecordDetailDto }>(`/api/pick-waves/${detail!.id}`, {
        method: "PATCH",
        body: { assignedTo: userId },
      }),
    );

  const transition = (next: "in_progress" | "done" | "cancelled") =>
    patch(() =>
      api<{ wave: PickWaveRecordDetailDto }>(`/api/pick-waves/${detail!.id}`, {
        method: "PATCH",
        body: { status: next },
      }),
    );

  const savePicked = () =>
    patch(() =>
      api<{ wave: PickWaveRecordDetailDto }>(`/api/pick-waves/${detail!.id}/lines`, {
        method: "PATCH",
        body: {
          lines: detail!.lines.map((l) => ({ id: l.id, pickedQty: Number(picked[l.id]) || 0 })),
        },
      }),
    );

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const editable = can("orders:write") && detail && ["open", "in_progress"].includes(detail.status);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("pickWaves.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("pickWaves.subtitle")}</p>
        </div>
      </div>

      <Select
        value={status || "all"}
        onValueChange={(v) => {
          setStatus(v === "all" ? "" : v);
          setPage(1);
        }}
      >
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("pickWaves.allStatuses")}</SelectItem>
          {STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {t(`pickWaves.statuses.${s}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("pickWaves.number")}</TableHead>
              <TableHead>{t("pickWaves.assignedTo")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("pickWaves.progress")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("pickWaves.createdAt")}</TableHead>
              <TableHead>{t("pickWaves.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : data.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  {t("pickWaves.empty")}
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((w) => (
                <TableRow
                  key={w.id}
                  className="cursor-pointer"
                  onClick={() => void openDetail(w.id)}
                >
                  <TableCell className="font-mono text-xs font-medium">{w.number}</TableCell>
                  <TableCell>{w.assignedToName ?? "—"}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    {w.pickedCount}/{w.lineCount}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground">
                    {new Date(w.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Badge variant={VARIANT[w.status]}>{t(`pickWaves.statuses.${w.status}`)}</Badge>
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
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
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

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {detail.number} — {t(`pickWaves.statuses.${detail.status}`)}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  <span>
                    {t("pickWaves.progress")}: {detail.pickedCount}/{detail.lineCount}
                  </span>
                  {detail.createdByName && (
                    <span>
                      {t("pickWaves.createdBy")}: {detail.createdByName}
                    </span>
                  )}
                  {editable && users.length > 0 && (
                    <Select
                      value={detail.assignedTo ?? "none"}
                      onValueChange={(v) => void assign(v === "none" ? null : v)}
                    >
                      <SelectTrigger className="w-52">
                        <SelectValue placeholder={t("pickWaves.assign")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t("pickWaves.unassigned")}</SelectItem>
                        {users.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {!editable && detail.assignedToName && (
                    <span>
                      {t("pickWaves.assignedTo")}: {detail.assignedToName}
                    </span>
                  )}
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("orders.location")}</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>{t("orders.item")}</TableHead>
                      <TableHead>{t("orders.number")}</TableHead>
                      <TableHead className="text-right">{t("pickWaves.expected")}</TableHead>
                      <TableHead className="w-24 text-right">{t("pickWaves.picked")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.lines.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="font-mono text-xs">{l.location ?? "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{l.sku ?? "—"}</TableCell>
                        <TableCell className="text-sm">{l.itemName}</TableCell>
                        <TableCell className="font-mono text-xs">{l.orderNumber}</TableCell>
                        <TableCell className="text-right font-medium">{l.quantity}</TableCell>
                        <TableCell className="text-right">
                          {editable ? (
                            <Input
                              type="number"
                              min={0}
                              max={l.quantity}
                              className="ml-auto w-20 text-right"
                              value={picked[l.id] ?? "0"}
                              onChange={(e) =>
                                setPicked((p) => ({ ...p, [l.id]: e.target.value }))
                              }
                            />
                          ) : (
                            l.pickedQty
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <DialogFooter className="gap-2">
                  {editable && (
                    <>
                      <Button size="sm" onClick={() => void savePicked()} disabled={busy}>
                        {t("pickWaves.saveProgress")}
                      </Button>
                      {detail.status === "open" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void transition("in_progress")}
                          disabled={busy}
                        >
                          {t("pickWaves.start")}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => void transition("cancelled")}
                        disabled={busy}
                      >
                        {t("pickWaves.cancel")}
                      </Button>
                    </>
                  )}
                  <Button variant="outline" size="sm" onClick={() => window.print()}>
                    {t("orders.wavePrint")}
                  </Button>
                </DialogFooter>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
