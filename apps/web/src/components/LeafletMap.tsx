import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Coords } from "@transitum/shared";

export interface MapPoint {
  coords: Coords;
  label: string;
  kind: "pickup" | "delivery" | "position";
}

const KIND_COLOR: Record<MapPoint["kind"], string> = {
  pickup: "#0ea5e9",
  delivery: "#22c55e",
  position: "#f59e0b",
};

const icon = (kind: MapPoint["kind"]) =>
  L.divIcon({
    className: "",
    html: `<span style="display:block;width:14px;height:14px;border-radius:50%;background:${KIND_COLOR[kind]};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });

/** Mapa OSM com marcadores de recolha/entrega e posição atual. */
export function LeafletMap({ points, className }: { points: MapPoint[]; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const map = L.map(ref.current, { scrollWheelZoom: false });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
      maxZoom: 19,
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const latlngs = points.map((p) => [p.coords.lat, p.coords.lng] as [number, number]);
    for (const p of points) {
      L.marker(p.coords, { icon: icon(p.kind) })
        .bindTooltip(p.label)
        .addTo(layer);
    }
    if (latlngs.length > 1) {
      L.polyline(latlngs, { color: "#64748b", weight: 3, dashArray: "6 6" }).addTo(layer);
    }
    if (latlngs.length === 1) {
      map.setView(latlngs[0], 13);
    } else if (latlngs.length > 1) {
      map.fitBounds(L.latLngBounds(latlngs).pad(0.2));
    }
  }, [points]);

  return <div ref={ref} className={className ?? "h-64 w-full rounded-md border border-border"} />;
}
