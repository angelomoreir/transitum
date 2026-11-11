import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Download, FileText, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DOC_ENTITY_TYPES, type DocEntityType, type DocumentDto } from "@transitum/shared";
import { api, ApiRequestError, apiDownload, saveBlob } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

const fmtSize = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

function entityLink(d: DocumentDto): string | null {
  switch (d.entityType) {
    case "shipment":
      return `/shipments/${d.entityId}`;
    case "order":
      return `/orders/${d.entityId}`;
    case "purchase_order":
      return `/purchases/${d.entityId}`;
    case "route":
      return `/routes/${d.entityId}`;
    case "partner":
      return "/partners";
    default:
      return null;
  }
}

interface ListResponse {
  items: DocumentDto[];
  total: number;
  page: number;
  pageSize: number;
}

export function DocumentsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [data, setData] = useState<ListResponse | null>(null);
  const [q, setQ] = useState("");
  const [entityType, setEntityType] = useState<DocEntityType | "all">("all");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    try {
      const res = await api<ListResponse>("/api/documents", {
        params: {
          page,
          q: q || undefined,
          entityType: entityType === "all" ? undefined : entityType,
        },
      });
      setData(res);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t("common.error"));
    }
  }, [page, q, entityType, t]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("documents.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("documents.subtitle")}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder={t("common.search")}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <Select
          value={entityType}
          onValueChange={(v) => {
            setEntityType(v as DocEntityType | "all");
            setPage(1);
          }}
        >
          <SelectTrigger className="w-44" data-testid="doc-type-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("common.all")}</SelectItem>
            {DOC_ENTITY_TYPES.map((et) => (
              <SelectItem key={et} value={et}>
                {t(`documents.entityTypes.${et}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("documents.file")}</TableHead>
                <TableHead>{t("documents.entity")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("documents.uploadedBy")}</TableHead>
                <TableHead className="text-right">{t("documents.size")}</TableHead>
                <TableHead className="hidden md:table-cell">Data</TableHead>
                <TableHead className="w-20 text-right">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.items ?? []).map((d) => {
                const link = entityLink(d);
                return (
                  <TableRow key={d.id}>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{d.fileName}</span>
                      </span>
                    </TableCell>
                    <TableCell>
                      {link ? (
                        <Link to={link} className="hover:underline">
                          <Badge variant="outline">{t(`documents.entityTypes.${d.entityType}`)}</Badge>
                        </Link>
                      ) : (
                        <Badge variant="outline">{t(`documents.entityTypes.${d.entityType}`)}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {d.uploadedByName ?? "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {fmtSize(d.sizeBytes)}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {new Date(d.createdAt).toLocaleDateString("pt-PT")}
                    </TableCell>
                    <TableCell className="text-right">
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
                    </TableCell>
                  </TableRow>
                );
              })}
              {data && data.items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    {t("documents.empty")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {t("common.previous")}
          </Button>
          <span className="text-sm text-muted-foreground">
            {t("common.page", { page })} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("common.next")}
          </Button>
        </div>
      )}
    </div>
  );
}
