import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, FileText, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { DOC_MAX_BYTES, type DocEntityType, type DocumentDto } from "@blujay/shared";
import { api, ApiRequestError, apiDownload, fileToBase64, saveBlob } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const fmtSize = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function DocumentsCard({
  entityType,
  entityId,
}: {
  entityType: DocEntityType;
  entityId: string;
}) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [docs, setDocs] = useState<DocumentDto[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ items: DocumentDto[] }>("/api/documents", {
        params: { entityType, entityId, pageSize: 50 },
      });
      setDocs(res.items);
    } catch {
      /* silencioso */
    }
  }, [entityType, entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload(file: File) {
    if (file.size > DOC_MAX_BYTES) {
      toast.error(t("documents.tooLarge"));
      return;
    }
    setBusy(true);
    try {
      await api("/api/documents", {
        method: "POST",
        body: {
          entityType,
          entityId,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          contentBase64: await fileToBase64(file),
        },
      });
      toast.success(t("documents.created"));
      await load();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function download(doc: DocumentDto) {
    try {
      saveBlob(await apiDownload(`/api/documents/${doc.id}/download`), doc.fileName);
    } catch {
      toast.error(t("common.error"));
    }
  }

  async function remove(doc: DocumentDto) {
    if (!window.confirm(t("documents.deleteConfirm"))) return;
    try {
      await api(`/api/documents/${doc.id}`, { method: "DELETE" });
      toast.success(t("documents.deleted"));
      await load();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{t("documents.title")}</CardTitle>
        {can("documents:write") && (
          <>
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              data-testid="doc-file-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              data-testid="doc-upload"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {t("documents.new")}
            </Button>
          </>
        )}
      </CardHeader>
      <CardContent>
        {docs.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{t("documents.emptyEntity")}</p>
        ) : (
          <ul className="divide-y">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-2 text-sm">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{d.fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {fmtSize(d.sizeBytes)} · {d.uploadedByName ?? "—"} ·{" "}
                    {new Date(d.createdAt).toLocaleDateString("pt-PT")}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("documents.download")}
                  onClick={() => void download(d)}
                >
                  <Download className="h-4 w-4" />
                </Button>
                {can("documents:write") && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("documents.delete")}
                    onClick={() => void remove(d)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
