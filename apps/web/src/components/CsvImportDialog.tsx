import { useState, type ChangeEvent, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { api, ApiRequestError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface ImportResult {
  imported: number;
  errors: { row: number; message: string }[];
}

/**
 * Diálogo de importação CSV em massa. `endpoint` recebe `{ csv }` e devolve
 * `{ imported, errors }`. `template` mostra o cabeçalho esperado ao utilizador.
 */
export function CsvImportDialog({
  open,
  onOpenChange,
  endpoint,
  template,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  endpoint: string;
  template: string;
  onDone: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result ?? ""));
    reader.readAsText(file);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const res = await api<ImportResult>(endpoint, { method: "POST", body: { csv } });
      setResult(res);
      if (res.imported > 0) await onDone();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("import.title")}</DialogTitle>
          <DialogDescription>{t("import.hint")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <p className="rounded bg-muted px-2 py-1 font-mono text-xs">{template}</p>
          <div className="space-y-1.5">
            <Label htmlFor="csv-file">{t("import.file")}</Label>
            <Input id="csv-file" type="file" accept=".csv,text/csv,text/plain" onChange={onFile} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="csv-paste">{t("import.paste")}</Label>
            <Textarea
              id="csv-paste"
              rows={6}
              className="font-mono text-xs"
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              required
            />
          </div>
          {result && (
            <div className="space-y-1 text-sm">
              <p className="font-medium">
                {t("import.result", { imported: result.imported, failed: result.errors.length })}
              </p>
              <ul className="max-h-32 space-y-0.5 overflow-y-auto text-xs text-destructive">
                {result.errors.slice(0, 20).map((er) => (
                  <li key={er.row}>{t("import.rowError", { row: er.row, message: er.message })}</li>
                ))}
              </ul>
            </div>
          )}
          <DialogFooter>
            <Button type="submit" disabled={loading || !csv.trim()}>
              <Upload className="h-4 w-4" />
              {loading ? t("common.loading") : t("import.run")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
