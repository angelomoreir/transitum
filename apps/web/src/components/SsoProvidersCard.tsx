import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { SsoProviderDto } from "@transitum/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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

const emptyForm = {
  name: "",
  domain: "",
  clientId: "",
  clientSecret: "",
  authorizeUrl: "",
  tokenUrl: "",
  userinfoUrl: "",
  autoProvision: false,
  defaultRole: "viewer",
};

/** Fornecedores SSO/OIDC do tenant — configuração por administrador. */
export function SsoProvidersCard() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const editable = can("tenant:update");
  const [items, setItems] = useState<SsoProviderDto[] | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!editable) {
      setItems([]);
      return;
    }
    const r = await api<{ items: SsoProviderDto[] }>("/api/sso-providers");
    setItems(r.items);
  }, [editable]);

  useEffect(() => {
    load().catch((e) => toast.error(e.message));
  }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api("/api/sso-providers", {
        method: "POST",
        body: {
          ...form,
          userinfoUrl: form.userinfoUrl || undefined,
        },
      });
      toast.success(t("sso.created"));
      setOpen(false);
      setForm(emptyForm);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  }

  async function toggle(p: SsoProviderDto) {
    try {
      await api(`/api/sso-providers/${p.id}`, { method: "PATCH", body: { enabled: !p.enabled } });
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    }
  }

  async function remove(p: SsoProviderDto) {
    try {
      await api(`/api/sso-providers/${p.id}`, { method: "DELETE" });
      toast.success(t("sso.deleted"));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    }
  }

  const copy = (v: string) => {
    void navigator.clipboard.writeText(v).then(() => toast.success(t("common.copied")));
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">{t("sso.title")}</CardTitle>
          <CardDescription>{t("sso.subtitle")}</CardDescription>
        </div>
        {editable && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            {t("sso.new")}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {!items ? null : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("sso.empty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("sso.name")}</TableHead>
                <TableHead>{t("sso.domain")}</TableHead>
                <TableHead>{t("sso.status")}</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="font-mono text-xs">{p.domain}</TableCell>
                  <TableCell>
                    <Badge variant={p.enabled ? "success" : "secondary"}>
                      {p.enabled ? t("sso.enabled") : t("sso.disabled")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => copy(p.redirectUri)}
                        title={p.redirectUri}
                      >
                        {t("sso.copyRedirect")}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void toggle(p)}>
                        {p.enabled ? t("sso.disable") : t("sso.enable")}
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => void remove(p)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("sso.new")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={create} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("sso.name")}</Label>
                <Input
                  required
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Ex.: Entra ID"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("sso.domain")}</Label>
                <Input
                  required
                  value={form.domain}
                  onChange={(e) => setForm((f) => ({ ...f, domain: e.target.value }))}
                  placeholder="empresa.pt"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("sso.clientId")}</Label>
                <Input
                  required
                  value={form.clientId}
                  onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("sso.clientSecret")}</Label>
                <Input
                  required
                  type="password"
                  minLength={4}
                  value={form.clientSecret}
                  onChange={(e) => setForm((f) => ({ ...f, clientSecret: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t("sso.authorizeUrl")}</Label>
              <Input
                required
                type="url"
                value={form.authorizeUrl}
                onChange={(e) => setForm((f) => ({ ...f, authorizeUrl: e.target.value }))}
                placeholder="https://idp.example.com/oauth2/v2.0/authorize"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("sso.tokenUrl")}</Label>
              <Input
                required
                type="url"
                value={form.tokenUrl}
                onChange={(e) => setForm((f) => ({ ...f, tokenUrl: e.target.value }))}
                placeholder="https://idp.example.com/oauth2/v2.0/token"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("sso.userinfoUrl")}</Label>
              <Input
                type="url"
                value={form.userinfoUrl}
                onChange={(e) => setForm((f) => ({ ...f, userinfoUrl: e.target.value }))}
                placeholder="https://idp.example.com/oauth2/v2.0/userinfo"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("sso.autoProvision")}</Label>
                <Select
                  value={form.autoProvision ? "yes" : "no"}
                  onValueChange={(v) => setForm((f) => ({ ...f, autoProvision: v === "yes" }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="no">{t("sso.autoProvisionOff")}</SelectItem>
                    <SelectItem value="yes">{t("sso.autoProvisionOn")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("sso.defaultRole")}</Label>
                <Select
                  value={form.defaultRole}
                  onValueChange={(v) => setForm((f) => ({ ...f, defaultRole: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["viewer", "operator", "manager"].map((r) => (
                      <SelectItem key={r} value={r}>
                        {t(`users.roles.${r}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={saving}>
                {saving ? t("common.loading") : t("sso.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
