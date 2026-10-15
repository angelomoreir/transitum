import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Package, Route as RouteIcon, Truck, User as UserIcon, Users } from "lucide-react";
import { api } from "@/lib/api";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SearchResults {
  users: { id: string; name: string; email: string }[];
  partners: { id: string; name: string; code: string; types: string[] }[];
  orders: { id: string; number: string; status: string }[];
  shipments: { id: string; number: string; status: string }[];
  routes: { id: string; number: string; name: string; status: string }[];
  purchaseOrders: { id: string; number: string; status: string }[];
  items: { id: string; sku: string; name: string }[];
}

const EMPTY: SearchResults = {
  users: [],
  partners: [],
  orders: [],
  shipments: [],
  routes: [],
  purchaseOrders: [],
  items: [],
};

export function SearchPalette({ open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY);

  // Ctrl+K / Cmd+K abre a pesquisa
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!query.trim()) {
      setResults(EMPTY);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const data = await api<SearchResults>("/api/search", {
          params: { q: query },
        });
        setResults(data);
      } catch {
        setResults(EMPTY);
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  const go = useCallback(
    (to: string) => {
      onOpenChange(false);
      navigate(to);
    },
    [navigate, onOpenChange],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={() => onOpenChange(false)} />
      <div className="absolute left-1/2 top-24 w-full max-w-lg -translate-x-1/2 px-4">
        <Command className="rounded-lg border border-border shadow-lg" shouldFilter={false}>
          <CommandInput
            placeholder={t("common.searchPlaceholder")}
            value={query}
            onValueChange={setQuery}
            autoFocus
          />
          <CommandList>
            <CommandEmpty>{t("common.results", { count: 0 })}</CommandEmpty>
            {results.users.length > 0 && (
              <CommandGroup heading={t("nav.users")}>
                {results.users.map((u) => (
                  <CommandItem key={u.id} onSelect={() => go("/users")}>
                    <UserIcon className="h-4 w-4 text-muted-foreground" />
                    <span>{u.name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{u.email}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {results.partners.length > 0 && (
              <CommandGroup heading={t("nav.partners")}>
                {results.partners.map((p) => (
                  <CommandItem key={p.id} onSelect={() => go("/partners")}>
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span>{p.name}</span>
                    <span className="ml-auto font-mono text-xs text-muted-foreground">
                      {p.code}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {results.orders.length > 0 && (
              <CommandGroup heading={t("nav.orders")}>
                {results.orders.map((o) => (
                  <CommandItem key={o.id} onSelect={() => go(`/orders/${o.id}`)}>
                    <Package className="h-4 w-4 text-muted-foreground" />
                    <span className="font-mono text-xs">{o.number}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {t(`orders.statuses.${o.status}`)}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {results.shipments.length > 0 && (
              <CommandGroup heading={t("nav.shipments")}>
                {results.shipments.map((s) => (
                  <CommandItem key={s.id} onSelect={() => go(`/shipments/${s.id}`)}>
                    <Truck className="h-4 w-4 text-muted-foreground" />
                    <span className="font-mono text-xs">{s.number}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {t(`shipments.statuses.${s.status}`)}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {results.routes.length > 0 && (
              <CommandGroup heading={t("nav.routes")}>
                {results.routes.map((r) => (
                  <CommandItem key={r.id} onSelect={() => go(`/routes/${r.id}`)}>
                    <RouteIcon className="h-4 w-4 text-muted-foreground" />
                    <span className="font-mono text-xs">{r.number}</span>
                    <span>{r.name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {t(`routes.statuses.${r.status}`)}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {results.purchaseOrders.length > 0 && (
              <CommandGroup heading={t("nav.purchases")}>
                {results.purchaseOrders.map((p) => (
                  <CommandItem key={p.id} onSelect={() => go(`/purchases/${p.id}`)}>
                    <Truck className="h-4 w-4 text-muted-foreground" />
                    <span className="font-mono text-xs">{p.number}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {t(`purchases.statuses.${p.status}`)}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {results.items.length > 0 && (
              <CommandGroup heading={t("nav.inventory")}>
                {results.items.map((i) => (
                  <CommandItem key={i.id} onSelect={() => go("/inventory")}>
                    <Package className="h-4 w-4 text-muted-foreground" />
                    <span className="font-mono text-xs">{i.sku}</span>
                    <span>{i.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandGroup heading={t("app.name")}>
              <CommandItem onSelect={() => go("/")}>{t("nav.dashboard")}</CommandItem>
              <CommandItem onSelect={() => go("/partners")}>{t("nav.partners")}</CommandItem>
              <CommandItem onSelect={() => go("/orders")}>{t("nav.orders")}</CommandItem>
              <CommandItem onSelect={() => go("/shipments")}>{t("nav.shipments")}</CommandItem>
              <CommandItem onSelect={() => go("/routes")}>{t("nav.routes")}</CommandItem>
              <CommandItem onSelect={() => go("/rates")}>{t("nav.rates")}</CommandItem>
              <CommandItem onSelect={() => go("/warehouses")}>{t("nav.warehouses")}</CommandItem>
              <CommandItem onSelect={() => go("/inventory")}>{t("nav.inventory")}</CommandItem>
              <CommandItem onSelect={() => go("/purchases")}>{t("nav.purchases")}</CommandItem>
              <CommandItem onSelect={() => go("/users")}>{t("nav.users")}</CommandItem>
              <CommandItem onSelect={() => go("/settings")}>{t("nav.settings")}</CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </div>
    </div>
  );
}
