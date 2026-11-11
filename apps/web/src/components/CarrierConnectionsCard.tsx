import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  CARRIER_PROVIDERS,
  type CarrierConnectionDto,
  type CarrierProvider,
  type PartnerDto,
} from "@transitum/shared";
import { api, ApiRequestError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ProviderMeta {
  id: CarrierProvider;
  label: string;
  credentialFields: string[];
  configFields: string[];
  liveSupported: boolean;
}

/** Ligações às APIs das transportadoras (CTT, DPD, Nacex). */
export function CarrierConnectionsCard() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [connections, setConnections] = useState<CarrierConnectionDto[] | null>(null);
  const [providers, setProviders] = useState<ProviderMeta[]>([]);
  const [carriers, setCarriers] = useState<PartnerDto[]>([]);
  const [form, setForm] = useState({ carrierId: "", provider: "nacex" as CarrierProvider, mode: "sandbox" });
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [config, setConfig] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<{ connections: CarrierConnectionDto[] }>("/api/carrier-connections/");
      setConnections(res.connections);
    } catch {
      setConnections([]);
    }
  }, []);

  useEffect(() => {
    load();
    api<{ providers: ProviderMeta[] }>("/api/carrier-connections/providers")
      .then((r) => setProviders(r.providers))
      .catch(() => {});
    api<{ items: PartnerDto[] }>("/api/partners", {
      params: { type: "carrier", active: "true", pageSize: 100 },
    })
      .then((r) => setCarriers(r.items))
      .catch(() => {});
  }, [load]);

  const provider = providers.find((p) => p.id === form.provider);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/carrier-connections/", {
        method: "POST",
        body: { ...form, credentials: secrets, config },
      });
      toast.success(t("carriers.saved"));
      setOpen(false);
      setSecrets({});
      setConfig({});
      await load();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (c: CarrierConnectionDto) => {
    try {
      await api(`/api/carrier-connections/${c.id}`, { method: "PATCH", body: { active: !c.active } });
      await load();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    }
  };

  const remove = async (c: CarrierConnectionDto) => {
    try {
      await api(`/api/carrier-connections/${c.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    }
  };

  if (connections === null) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{t("carriers.title")}</CardTitle>
        {can("partners:write") && (
          <Button variant="outline" size="sm" onClick={() => setOpen((o) => !o)}>
            <Plus className="h-4 w-4" />
            {t("carriers.new")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {connections.length === 0 && !open && (
          <p className="text-muted-foreground">{t("carriers.empty")}</p>
        )}
        <ul className="divide-y divide-border">
          {connections.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="font-medium">{c.carrierName}</span>
              <Badge variant="secondary">{c.provider}</Badge>
              <Badge variant={c.mode === "live" ? "default" : "outline"}>
                {t(`carriers.modes.${c.mode}`)}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {c.credentialKeys.join(", ") || "—"}
              </span>
              {can("partners:write") && (
                <span className="ml-auto flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => toggle(c)}>
                    {c.active ? t("carriers.deactivate") : t("carriers.activate")}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => remove(c)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>

        {open && can("partners:write") && (
          <form onSubmit={submit} className="space-y-3 rounded-md border border-border p-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>{t("shipments.carrier")}</Label>
                <Select value={form.carrierId} onValueChange={(v) => setForm((f) => ({ ...f, carrierId: v }))}>
                  <SelectTrigger><SelectValue placeholder={t("shipments.selectCarrier")} /></SelectTrigger>
                  <SelectContent>
                    {carriers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("carriers.provider")}</Label>
                <Select
                  value={form.provider}
                  onValueChange={(v) => setForm((f) => ({ ...f, provider: v as CarrierProvider }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CARRIER_PROVIDERS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {providers.find((m) => m.id === p)?.label ?? p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("carriers.mode")}</Label>
                <Select
                  value={form.mode}
                  onValueChange={(v) => setForm((f) => ({ ...f, mode: v }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sandbox">{t("carriers.modes.sandbox")}</SelectItem>
                    <SelectItem value="live" disabled={provider ? !provider.liveSupported : false}>
                      {t("carriers.modes.live")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {(provider?.credentialFields ?? []).map((field) => (
              <div key={field} className="space-y-1.5">
                <Label>{t(`carriers.fields.${field}`)} *</Label>
                <Input
                  type={/password|secret|key/i.test(field) ? "password" : "text"}
                  required={form.mode === "live"}
                  value={secrets[field] ?? ""}
                  onChange={(e) => setSecrets((s) => ({ ...s, [field]: e.target.value }))}
                />
              </div>
            ))}
            {(provider?.configFields ?? []).map((field) => (
              <div key={field} className="space-y-1.5">
                <Label>{t(`carriers.fields.${field}`)}</Label>
                <Input
                  value={config[field] ?? ""}
                  onChange={(e) => setConfig((c) => ({ ...c, [field]: e.target.value }))}
                />
              </div>
            ))}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={busy || !form.carrierId}>
                {busy ? t("common.loading") : t("settings.save")}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
