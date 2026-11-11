import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Plug, Plus } from "lucide-react";
import { toast } from "sonner";
import type { InboundChannelDto } from "@transitum/shared";
import { api, ApiRequestError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const SOURCES = ["shopify", "woocommerce", "edifact", "generic"] as const;

/** Canais de entrada — URLs de webhook para Shopify/WooCommerce/EDI genérico. */
export function InboundChannelsCard() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [channels, setChannels] = useState<InboundChannelDto[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [source, setSource] = useState<(typeof SOURCES)[number]>("shopify");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ items: InboundChannelDto[] }>(
        "/api/integrations/inbound-channels",
      );
      setChannels(res.items);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    try {
      await api("/api/integrations/inbound-channels", {
        method: "POST",
        body: { name, source, secret },
      });
      toast.success(t("integrations.channelCreated"));
      setOpen(false);
      setName("");
      setSecret("");
      await load();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(c: InboundChannelDto) {
    try {
      await api(`/api/integrations/inbound-channels/${c.id}`, {
        method: "PATCH",
        body: { active: !c.active },
      });
      await load();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    }
  }

  async function copyUrl(c: InboundChannelDto) {
    const url = `${window.location.origin.replace(/\/$/, "")}${c.url}`;
    await navigator.clipboard.writeText(url);
    setCopiedId(c.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  const canWrite = can("integrations:write");
  const sourceLabel = (s: string) =>
    s === "generic"
      ? t("integrations.sourceGeneric")
      : s === "woocommerce"
        ? "WooCommerce"
        : s === "edifact"
          ? "EDIFACT"
          : "Shopify";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Plug className="h-4 w-4" />
          {t("integrations.channels")}
        </CardTitle>
        {canWrite && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="channel-new">
                <Plus className="h-4 w-4" />
                {t("integrations.newChannel")}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("integrations.newChannel")}</DialogTitle>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="ch-name">{t("integrations.keyName")}</Label>
                <Input
                  id="ch-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Loja Shopify…"
                />
                <Label>{t("integrations.channelSource")}</Label>
                <Select value={source} onValueChange={(v) => setSource(v as typeof source)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SOURCES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {sourceLabel(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Label htmlFor="ch-secret">{t("integrations.channelSecret")}</Label>
                <Input
                  id="ch-secret"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  type="password"
                />
                <p className="text-xs text-muted-foreground">
                  {t(`integrations.secretHint.${source}`)}
                </p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  {t("common.cancel")}
                </Button>
                <Button
                  onClick={() => void create()}
                  disabled={busy || name.trim().length < 2 || secret.trim().length < 8}
                  data-testid="channel-save"
                >
                  {t("common.create")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("integrations.keyName")}</TableHead>
              <TableHead>{t("integrations.channelSource")}</TableHead>
              <TableHead className="hidden md:table-cell">URL</TableHead>
              <TableHead className="hidden md:table-cell">
                {t("integrations.lastReceived")}
              </TableHead>
              <TableHead>{t("automations.active")}</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {channels.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell>{sourceLabel(c.source)}</TableCell>
                <TableCell className="hidden max-w-56 md:table-cell">
                  <code className="text-xs">{c.url}</code>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {c.lastReceivedAt
                    ? new Date(c.lastReceivedAt).toLocaleString("pt-PT")
                    : t("integrations.never")}
                </TableCell>
                <TableCell>
                  <Badge variant={c.active ? "success" : "secondary"}>
                    {c.active ? t("common.yes") : t("common.no")}
                  </Badge>
                </TableCell>
                <TableCell className="flex justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("integrations.copyUrl")}
                    onClick={() => void copyUrl(c)}
                  >
                    {copiedId === c.id ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                  {canWrite && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void toggle(c)}
                    >
                      {c.active ? t("automations.deactivate") : t("automations.activate")}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {channels.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                  {t("integrations.emptyChannels")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <p className="border-t px-4 py-3 text-xs text-muted-foreground">
          {t("integrations.channelsHint")}
        </p>
      </CardContent>
    </Card>
  );
}
