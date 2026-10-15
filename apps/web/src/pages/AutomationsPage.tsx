import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import {
  AUTOMATION_TRIGGERS,
  type AutomationDto,
  type AutomationTrigger,
} from "@blujay/shared";
import { api, ApiRequestError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

export function AutomationsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [items, setItems] = useState<AutomationDto[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<AutomationTrigger>("shipment.delivered");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<{ items: AutomationDto[] }>("/api/automations");
      setItems(res.items);
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
      await api("/api/automations", {
        method: "POST",
        body: { name, trigger, action: "notify" },
      });
      toast.success(t("automations.created"));
      setOpen(false);
      setName("");
      await load();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(rule: AutomationDto) {
    try {
      await api(`/api/automations/${rule.id}`, {
        method: "PATCH",
        body: { active: !rule.active },
      });
      toast.success(t("automations.updated"));
      await load();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    }
  }

  async function remove(rule: AutomationDto) {
    if (!window.confirm(t("automations.deleteConfirm"))) return;
    try {
      await api(`/api/automations/${rule.id}`, { method: "DELETE" });
      toast.success(t("automations.deleted"));
      await load();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("automations.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("automations.subtitle")}</p>
        </div>
        {can("automations:write") && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button data-testid="automation-new">
                <Plus className="h-4 w-4" />
                {t("automations.new")}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("automations.new")}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="rule-name">{t("automations.name")}</Label>
                  <Input
                    id="rule-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("automations.namePlaceholder")}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("automations.trigger")}</Label>
                  <Select
                    value={trigger}
                    onValueChange={(v) => setTrigger(v as AutomationTrigger)}
                  >
                    <SelectTrigger data-testid="automation-trigger">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AUTOMATION_TRIGGERS.map((tr) => (
                        <SelectItem key={tr} value={tr}>
                          {t(`automations.triggers.${tr}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t("automations.action")}: {t("automations.actions.notify")}
                </p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  {t("common.cancel")}
                </Button>
                <Button
                  onClick={() => void create()}
                  disabled={busy || name.trim().length < 2}
                  data-testid="automation-save"
                >
                  {t("common.create")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card>
        <CardContent className="divide-y p-0">
          {items.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3">
              <Zap
                className={`h-4 w-4 shrink-0 ${r.active ? "text-primary" : "text-muted-foreground"}`}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{r.name}</p>
                <p className="text-xs text-muted-foreground">
                  {t(`automations.triggers.${r.trigger}`)} →{" "}
                  {t(`automations.actions.${r.action}`)}
                </p>
              </div>
              {can("automations:write") ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void toggle(r)}
                  data-testid={`automation-toggle-${r.id}`}
                >
                  <Badge variant={r.active ? "success" : "secondary"}>
                    {r.active ? t("automations.active") : "—"}
                  </Badge>
                </Button>
              ) : (
                <Badge variant={r.active ? "success" : "secondary"}>
                  {r.active ? t("automations.active") : "—"}
                </Badge>
              )}
              {can("automations:write") && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("documents.delete")}
                  onClick={() => void remove(r)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
          {items.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {t("automations.empty")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
