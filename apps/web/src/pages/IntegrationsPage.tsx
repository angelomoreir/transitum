import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, KeyRound, Plus, Trash2, Webhook } from "lucide-react";
import { toast } from "sonner";
import type { ApiKeyDto, WebhookDeliveryDto } from "@blujay/shared";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function IntegrationsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [keys, setKeys] = useState<ApiKeyDto[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDeliveryDto[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [k, d] = await Promise.all([
        api<{ items: ApiKeyDto[] }>("/api/integrations/keys"),
        api<{ items: WebhookDeliveryDto[] }>("/api/integrations/webhook-deliveries"),
      ]);
      setKeys(k.items);
      setDeliveries(d.items);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createKey() {
    setBusy(true);
    try {
      const res = await api<{ key: ApiKeyDto; secret: string }>("/api/integrations/keys", {
        method: "POST",
        body: { name },
      });
      setNewSecret(res.secret);
      setCopied(false);
      toast.success(t("integrations.keyCreated"));
      await load();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(k: ApiKeyDto) {
    if (!window.confirm(t("integrations.keyRevokeConfirm"))) return;
    try {
      await api(`/api/integrations/keys/${k.id}`, { method: "DELETE" });
      toast.success(t("integrations.keyRevoked"));
      await load();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    }
  }

  async function copySecret() {
    if (!newSecret) return;
    await navigator.clipboard.writeText(newSecret);
    setCopied(true);
  }

  const canWrite = can("integrations:write");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t("integrations.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("integrations.subtitle")}</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" />
            {t("integrations.apiKeys")}
          </CardTitle>
          {canWrite && (
            <Dialog
              open={open}
              onOpenChange={(o) => {
                setOpen(o);
                if (!o) {
                  setNewSecret(null);
                  setName("");
                }
              }}
            >
              <DialogTrigger asChild>
                <Button size="sm" data-testid="key-new">
                  <Plus className="h-4 w-4" />
                  {t("integrations.newKey")}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("integrations.newKey")}</DialogTitle>
                </DialogHeader>
                {newSecret ? (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      {t("integrations.keyCopyHint")}
                    </p>
                    <div className="flex items-center gap-2">
                      <Input readOnly value={newSecret} className="font-mono text-xs" data-testid="key-secret" />
                      <Button variant="outline" size="icon" onClick={() => void copySecret()}>
                        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="key-name">{t("integrations.keyName")}</Label>
                    <Input
                      id="key-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="ERP, TMS externo…"
                    />
                  </div>
                )}
                <DialogFooter>
                  {newSecret ? (
                    <Button onClick={() => setOpen(false)} data-testid="key-done">
                      {t("common.confirm")}
                    </Button>
                  ) : (
                    <>
                      <Button variant="outline" onClick={() => setOpen(false)}>
                        {t("common.cancel")}
                      </Button>
                      <Button
                        onClick={() => void createKey()}
                        disabled={busy || name.trim().length < 2}
                        data-testid="key-save"
                      >
                        {t("common.create")}
                      </Button>
                    </>
                  )}
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
                <TableHead>Prefixo</TableHead>
                <TableHead className="hidden md:table-cell">
                  {t("documents.uploadedBy")}
                </TableHead>
                <TableHead className="hidden md:table-cell">
                  {t("integrations.lastUsed")}
                </TableHead>
                <TableHead>{t("automations.active")}</TableHead>
                {canWrite && <TableHead className="w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="font-medium">{k.name}</TableCell>
                  <TableCell className="font-mono text-xs">{k.prefix}…</TableCell>
                  <TableCell className="hidden md:table-cell">
                    {k.createdByName ?? "—"}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {k.lastUsedAt
                      ? new Date(k.lastUsedAt).toLocaleString("pt-PT")
                      : t("integrations.never")}
                  </TableCell>
                  <TableCell>
                    <Badge variant={k.active ? "success" : "secondary"}>
                      {k.active ? t("common.yes") : t("common.no")}
                    </Badge>
                  </TableCell>
                  {canWrite && (
                    <TableCell>
                      {k.active && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("integrations.keyRevoke")}
                          onClick={() => void revoke(k)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {keys.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                    {t("integrations.emptyKeys")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <p className="border-t px-4 py-3 text-xs text-muted-foreground">
            {t("integrations.v1Docs")}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Webhook className="h-4 w-4" />
            {t("integrations.deliveries")}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>URL</TableHead>
                <TableHead>{t("automations.trigger")}</TableHead>
                <TableHead>HTTP</TableHead>
                <TableHead className="text-right">ms</TableHead>
                <TableHead className="hidden md:table-cell">Data</TableHead>
                <TableHead className="hidden md:table-cell">Erro</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deliveries.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="max-w-56 truncate font-mono text-xs">
                    {d.url}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{d.trigger}</TableCell>
                  <TableCell>
                    <Badge variant={d.success ? "success" : "destructive"}>
                      {d.statusCode ?? "—"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {d.durationMs ?? "—"}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {new Date(d.createdAt).toLocaleString("pt-PT")}
                  </TableCell>
                  <TableCell className="hidden max-w-40 truncate text-xs text-muted-foreground md:table-cell">
                    {d.error ?? ""}
                  </TableCell>
                </TableRow>
              ))}
              {deliveries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                    {t("integrations.emptyDeliveries")} {t("integrations.deliveriesHint")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
