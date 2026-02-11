import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { RefreshCw, AlertTriangle, TrendingDown, Package, ShoppingCart, BarChart3 } from "lucide-react";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, LineChart, Line } from "recharts";

interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  stock_current: number;
  last_synced_at: string | null;
}

interface SaleRecord {
  id: string;
  sku: string;
  order_id: string | null;
  quantity: number;
  sale_date: string;
}

interface ForecastItem extends InventoryItem {
  totalSales30d: number;
  avgDailySales: number;
  daysRemaining: number;
  suggestedPurchase: number;
}

const SUPABASE_URL = "https://uxfwurwidepfgocrjble.supabase.co";

const Index = () => {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    const [invRes, salesRes] = await Promise.all([
      supabase.from("inventory").select("*"),
      supabase.from("sales_history").select("*"),
    ]);
    setInventory((invRes.data as InventoryItem[]) || []);
    setSales((salesRes.data as SaleRecord[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/shein-sync?action=sync`,
        {
          method: "POST",
        headers: {
            "Content-Type": "application/json",
            apikey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4Znd1cndpZGVwZmdvY3JqYmxlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4MTY2MTksImV4cCI6MjA4NjM5MjYxOX0.aEt1LSTGxswrhJ464OzhnXWB73vHYtBmn8ZzMFsmmec",
          },
        }
      );
      const data = await res.json();
      if (data.success) {
        toast({ title: "Sincronización completada", description: "Datos actualizados desde SHEIN." });
        await fetchData();
      } else {
        toast({ title: "Error", description: data.error || "No se pudo sincronizar.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Error de conexión", description: e.message, variant: "destructive" });
    }
    setSyncing(false);
  };

  const forecast: ForecastItem[] = useMemo(() => {
    return inventory.map((item) => {
      const itemSales = sales.filter((s) => s.sku === item.sku);
      const totalSales30d = itemSales.reduce((sum, s) => sum + s.quantity, 0);
      const avgDailySales = totalSales30d / 30;
      const daysRemaining = avgDailySales > 0 ? Math.round(item.stock_current / avgDailySales) : 999;
      const suggestedPurchase = Math.max(0, Math.ceil(avgDailySales * 30 - item.stock_current));
      return { ...item, totalSales30d, avgDailySales, daysRemaining, suggestedPurchase };
    });
  }, [inventory, sales]);

  const criticalItems = forecast.filter((f) => f.daysRemaining <= 7 && f.daysRemaining < 999);
  const warningItems = forecast.filter((f) => f.daysRemaining > 7 && f.daysRemaining <= 14);

  const salesChartData = useMemo(() => {
    const byDate: Record<string, number> = {};
    sales.forEach((s) => {
      const date = new Date(s.sale_date).toLocaleDateString("es-MX", { month: "short", day: "numeric" });
      byDate[date] = (byDate[date] || 0) + s.quantity;
    });
    return Object.entries(byDate)
      .map(([date, qty]) => ({ date, ventas: qty }))
      .slice(-14);
  }, [sales]);

  const stockChartData = useMemo(() => {
    return forecast
      .sort((a, b) => a.daysRemaining - b.daysRemaining)
      .slice(0, 10)
      .map((f) => ({
        name: f.sku.length > 12 ? f.sku.slice(0, 12) + "…" : f.sku,
        dias: f.daysRemaining === 999 ? 0 : f.daysRemaining,
        stock: f.stock_current,
      }));
  }, [forecast]);

  const chartConfig = {
    ventas: { label: "Ventas", color: "hsl(var(--primary))" },
    dias: { label: "Días restantes", color: "hsl(var(--destructive))" },
    stock: { label: "Stock", color: "hsl(var(--primary))" },
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <Package className="h-7 w-7 text-primary" />
            <div>
              <h1 className="text-xl font-bold text-foreground">SHEIN Inventory Manager</h1>
              <p className="text-sm text-muted-foreground">Forecast & Reposición Inteligente</p>
            </div>
          </div>
          <Button onClick={handleSync} disabled={syncing} size="sm">
            <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Sincronizando…" : "Sincronizar ahora"}
          </Button>
        </div>
      </header>

      <main className="container mx-auto space-y-6 px-4 py-6">
        {/* KPI Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total SKUs</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{inventory.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Ventas (30d)</CardTitle>
              <ShoppingCart className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{sales.reduce((s, r) => s + r.quantity, 0)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Alertas Críticas</CardTitle>
              <AlertTriangle className="h-4 w-4 text-destructive" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive">{criticalItems.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Advertencias</CardTitle>
              <TrendingDown className="h-4 w-4 text-orange-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-500">{warningItems.length}</div>
            </CardContent>
          </Card>
        </div>

        {/* Charts */}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" /> Ventas últimos 14 días
              </CardTitle>
            </CardHeader>
            <CardContent>
              {salesChartData.length > 0 ? (
                <ChartContainer config={chartConfig} className="h-[250px]">
                  <BarChart data={salesChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" fontSize={12} />
                    <YAxis fontSize={12} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="ventas" fill="var(--color-ventas)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              ) : (
                <p className="py-12 text-center text-muted-foreground">
                  Sin datos de ventas. Sincroniza para cargar.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingDown className="h-5 w-5" /> Días de inventario restantes (Top 10)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {stockChartData.length > 0 ? (
                <ChartContainer config={chartConfig} className="h-[250px]">
                  <BarChart data={stockChartData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" fontSize={12} />
                    <YAxis dataKey="name" type="category" width={90} fontSize={11} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="dias" fill="var(--color-dias)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ChartContainer>
              ) : (
                <p className="py-12 text-center text-muted-foreground">
                  Sin datos de inventario.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Suggested Purchases */}
        {criticalItems.length > 0 && (
          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" /> Compras Sugeridas — Urgente
              </CardTitle>
              <CardDescription>Productos que se agotarán en menos de 7 días</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead className="text-right">Venta/día</TableHead>
                    <TableHead className="text-right">Días restantes</TableHead>
                    <TableHead className="text-right">Compra sugerida</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {criticalItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-sm">{item.sku}</TableCell>
                      <TableCell>{item.name}</TableCell>
                      <TableCell className="text-right">{item.stock_current}</TableCell>
                      <TableCell className="text-right">{item.avgDailySales.toFixed(1)}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="destructive">{item.daysRemaining}d</Badge>
                      </TableCell>
                      <TableCell className="text-right font-bold">{item.suggestedPurchase}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Full Inventory Table */}
        <Card>
          <CardHeader>
            <CardTitle>Inventario Completo</CardTitle>
            <CardDescription>
              {inventory.length} productos • Última sincronización:{" "}
              {inventory[0]?.last_synced_at
                ? new Date(inventory[0].last_synced_at).toLocaleString("es-MX")
                : "Nunca"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="py-8 text-center text-muted-foreground">Cargando…</p>
            ) : forecast.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">
                No hay productos. Presiona "Sincronizar ahora" para importar desde SHEIN.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead className="text-right">Ventas 30d</TableHead>
                    <TableHead className="text-right">Venta/día</TableHead>
                    <TableHead className="text-right">Días restantes</TableHead>
                    <TableHead className="text-right">Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {forecast
                    .sort((a, b) => a.daysRemaining - b.daysRemaining)
                    .map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-mono text-sm">{item.sku}</TableCell>
                        <TableCell>{item.name}</TableCell>
                        <TableCell className="text-right">{item.stock_current}</TableCell>
                        <TableCell className="text-right">{item.totalSales30d}</TableCell>
                        <TableCell className="text-right">{item.avgDailySales.toFixed(1)}</TableCell>
                        <TableCell className="text-right">
                          {item.daysRemaining === 999 ? "∞" : item.daysRemaining}
                        </TableCell>
                        <TableCell className="text-right">
                          {item.daysRemaining <= 7 ? (
                            <Badge variant="destructive">Crítico</Badge>
                          ) : item.daysRemaining <= 14 ? (
                            <Badge variant="outline" className="border-orange-500 text-orange-500">Alerta</Badge>
                          ) : (
                            <Badge variant="secondary">OK</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default Index;
