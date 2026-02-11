import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { syncSheinData } from "@/lib/shein-sync";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, AlertTriangle, TrendingDown, Package, ShoppingCart, BarChart3, Activity, ArrowUpRight } from "lucide-react";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line, AreaChart, Area } from "recharts";

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
      const result = await syncSheinData();
      toast({
        title: "Sincronización completada",
        description: `${result.products} productos y ${result.orders} órdenes sincronizados.`,
      });
      await fetchData();
    } catch (e: any) {
      toast({
        title: "Error de sincronización",
        description: e.message || "No se pudo conectar con SHEIN. Verifica las credenciales.",
        variant: "destructive",
      });
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
  const totalStock = inventory.reduce((sum, i) => sum + i.stock_current, 0);
  const totalSales = sales.reduce((s, r) => s + r.quantity, 0);

  const salesChartData = useMemo(() => {
    const byDate: Record<string, number> = {};
    sales.forEach((s) => {
      const d = new Date(s.sale_date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      byDate[key] = (byDate[key] || 0) + s.quantity;
    });
    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-14)
      .map(([date, qty]) => ({
        date: new Date(date).toLocaleDateString("es-MX", { month: "short", day: "numeric" }),
        ventas: qty,
      }));
  }, [sales]);

  const stockDepletionData = useMemo(() => {
    return forecast
      .filter((f) => f.daysRemaining < 999 && f.avgDailySales > 0)
      .sort((a, b) => a.daysRemaining - b.daysRemaining)
      .slice(0, 10)
      .map((f) => ({
        name: f.name.length > 18 ? f.name.slice(0, 18) + "…" : f.name,
        sku: f.sku,
        dias: f.daysRemaining,
        stock: f.stock_current,
      }));
  }, [forecast]);

  const cumulativeSalesData = useMemo(() => {
    const byDate: Record<string, number> = {};
    sales.forEach((s) => {
      const d = new Date(s.sale_date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      byDate[key] = (byDate[key] || 0) + s.quantity;
    });
    let cumulative = 0;
    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-30)
      .map(([date, qty]) => {
        cumulative += qty;
        return {
          date: new Date(date).toLocaleDateString("es-MX", { month: "short", day: "numeric" }),
          acumulado: cumulative,
          diario: qty,
        };
      });
  }, [sales]);

  const chartConfig = {
    ventas: { label: "Ventas", color: "hsl(var(--primary))" },
    dias: { label: "Días restantes", color: "hsl(var(--destructive))" },
    stock: { label: "Stock", color: "hsl(var(--primary))" },
    acumulado: { label: "Acumulado", color: "hsl(var(--primary))" },
    diario: { label: "Diario", color: "hsl(var(--muted-foreground))" },
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card shadow-sm">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
              <Package className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">SHEIN Inventory Manager</h1>
              <p className="text-xs text-muted-foreground">Forecast & Reposición Inteligente</p>
            </div>
          </div>
          <Button onClick={handleSync} disabled={syncing} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Sincronizando…" : "Sincronizar SHEIN"}
          </Button>
        </div>
      </header>

      <main className="container mx-auto space-y-6 px-4 py-6">
        {/* KPI Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total SKUs</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{inventory.length}</div>
              <p className="text-xs text-muted-foreground mt-1">{totalStock} unidades en stock</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Ventas (30d)</CardTitle>
              <ShoppingCart className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{totalSales}</div>
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <ArrowUpRight className="h-3 w-3" />
                {(totalSales / 30).toFixed(1)} / día promedio
              </p>
            </CardContent>
          </Card>
          <Card className={criticalItems.length > 0 ? "border-destructive/50 bg-destructive/5" : ""}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Alertas Críticas</CardTitle>
              <AlertTriangle className={`h-4 w-4 ${criticalItems.length > 0 ? "text-destructive" : "text-muted-foreground"}`} />
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold ${criticalItems.length > 0 ? "text-destructive" : ""}`}>
                {criticalItems.length}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Productos con &lt;7 días de stock</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Advertencias</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{warningItems.length}</div>
              <p className="text-xs text-muted-foreground mt-1">Productos con 7-14 días de stock</p>
            </CardContent>
          </Card>
        </div>

        {/* Tabs for different views */}
        <Tabs defaultValue="forecast" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3 lg:w-auto lg:inline-grid">
            <TabsTrigger value="forecast" className="gap-2">
              <TrendingDown className="h-4 w-4" /> Forecast
            </TabsTrigger>
            <TabsTrigger value="ventas" className="gap-2">
              <BarChart3 className="h-4 w-4" /> Ventas
            </TabsTrigger>
            <TabsTrigger value="inventario" className="gap-2">
              <Package className="h-4 w-4" /> Inventario
            </TabsTrigger>
          </TabsList>

          {/* FORECAST TAB */}
          <TabsContent value="forecast" className="space-y-6">
            {/* Depletion Chart */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingDown className="h-5 w-5 text-destructive" />
                  Proyección de Agotamiento de Stock
                </CardTitle>
                <CardDescription>Días de inventario restantes por producto (ordenado por urgencia)</CardDescription>
              </CardHeader>
              <CardContent>
                {stockDepletionData.length > 0 ? (
                  <ChartContainer config={chartConfig} className="h-[300px]">
                    <BarChart data={stockDepletionData} layout="vertical" margin={{ left: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" fontSize={12} />
                      <YAxis dataKey="name" type="category" width={140} fontSize={11} tick={{ fill: "hsl(var(--foreground))" }} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar
                        dataKey="dias"
                        radius={[0, 4, 4, 0]}
                        fill="hsl(var(--destructive))"
                      />
                    </BarChart>
                  </ChartContainer>
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                    <Package className="h-12 w-12 mb-3 opacity-30" />
                    <p>Sin datos de inventario. Sincroniza para cargar.</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Suggested Purchases Table */}
            <Card className={criticalItems.length > 0 ? "border-destructive/40" : ""}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className={`h-5 w-5 ${criticalItems.length > 0 ? "text-destructive" : "text-muted-foreground"}`} />
                  Compras Sugeridas
                </CardTitle>
                <CardDescription>
                  {criticalItems.length > 0
                    ? `${criticalItems.length} productos necesitan reabastecimiento urgente`
                    : "No hay productos en estado crítico"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {forecast.filter((f) => f.daysRemaining < 999 && f.suggestedPurchase > 0).length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>SKU</TableHead>
                        <TableHead>Producto</TableHead>
                        <TableHead className="text-right">Stock Actual</TableHead>
                        <TableHead className="text-right">Venta/día</TableHead>
                        <TableHead className="text-right">Días Restantes</TableHead>
                        <TableHead className="text-right">Compra Sugerida (30d)</TableHead>
                        <TableHead className="text-center">Estado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {forecast
                        .filter((f) => f.daysRemaining < 999 && f.suggestedPurchase > 0)
                        .sort((a, b) => a.daysRemaining - b.daysRemaining)
                        .map((item) => (
                          <TableRow key={item.id} className={item.daysRemaining <= 7 ? "bg-destructive/5" : ""}>
                            <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                            <TableCell className="font-medium">{item.name}</TableCell>
                            <TableCell className="text-right">{item.stock_current}</TableCell>
                            <TableCell className="text-right">{item.avgDailySales.toFixed(1)}</TableCell>
                            <TableCell className="text-right">
                              {item.daysRemaining <= 7 ? (
                                <Badge variant="destructive">{item.daysRemaining}d</Badge>
                              ) : (
                                <Badge variant="outline">{item.daysRemaining}d</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-bold text-lg">{item.suggestedPurchase}</TableCell>
                            <TableCell className="text-center">
                              {item.daysRemaining <= 3 ? (
                                <Badge variant="destructive">🔴 Urgente</Badge>
                              ) : item.daysRemaining <= 7 ? (
                                <Badge variant="destructive">Crítico</Badge>
                              ) : item.daysRemaining <= 14 ? (
                                <Badge variant="outline" className="border-amber-500 text-amber-600">⚠️ Alerta</Badge>
                              ) : (
                                <Badge variant="secondary">Planificar</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <p>No hay compras sugeridas por el momento.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* VENTAS TAB */}
          <TabsContent value="ventas" className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5" /> Ventas Diarias (14 días)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {salesChartData.length > 0 ? (
                    <ChartContainer config={chartConfig} className="h-[280px]">
                      <BarChart data={salesChartData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="date" fontSize={12} />
                        <YAxis fontSize={12} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Bar dataKey="ventas" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ChartContainer>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                      <ShoppingCart className="h-12 w-12 mb-3 opacity-30" />
                      <p>Sin datos de ventas. Sincroniza para cargar.</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5" /> Ventas Acumuladas (30 días)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {cumulativeSalesData.length > 0 ? (
                    <ChartContainer config={chartConfig} className="h-[280px]">
                      <AreaChart data={cumulativeSalesData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="date" fontSize={12} />
                        <YAxis fontSize={12} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Area
                          dataKey="acumulado"
                          type="monotone"
                          fill="hsl(var(--primary) / 0.15)"
                          stroke="hsl(var(--primary))"
                          strokeWidth={2}
                        />
                      </AreaChart>
                    </ChartContainer>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                      <Activity className="h-12 w-12 mb-3 opacity-30" />
                      <p>Sin datos acumulados.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Sales breakdown by SKU */}
            <Card>
              <CardHeader>
                <CardTitle>Ventas por Producto (30 días)</CardTitle>
              </CardHeader>
              <CardContent>
                {forecast.filter((f) => f.totalSales30d > 0).length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>SKU</TableHead>
                        <TableHead>Producto</TableHead>
                        <TableHead className="text-right">Ventas Totales</TableHead>
                        <TableHead className="text-right">Promedio/día</TableHead>
                        <TableHead className="text-right">Stock Actual</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {forecast
                        .filter((f) => f.totalSales30d > 0)
                        .sort((a, b) => b.totalSales30d - a.totalSales30d)
                        .map((item) => (
                          <TableRow key={item.id}>
                            <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                            <TableCell className="font-medium">{item.name}</TableCell>
                            <TableCell className="text-right font-bold">{item.totalSales30d}</TableCell>
                            <TableCell className="text-right">{item.avgDailySales.toFixed(1)}</TableCell>
                            <TableCell className="text-right">{item.stock_current}</TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="py-8 text-center text-muted-foreground">Sin ventas registradas.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* INVENTARIO TAB */}
          <TabsContent value="inventario" className="space-y-4">
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
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                    <Package className="h-12 w-12 mb-3 opacity-30" />
                    <p>No hay productos. Presiona "Sincronizar SHEIN" para importar.</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>SKU</TableHead>
                        <TableHead>Producto</TableHead>
                        <TableHead className="text-right">Stock</TableHead>
                        <TableHead className="text-right">Ventas 30d</TableHead>
                        <TableHead className="text-right">Venta/día</TableHead>
                        <TableHead className="text-right">Días Restantes</TableHead>
                        <TableHead className="text-center">Estado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {forecast
                        .sort((a, b) => a.daysRemaining - b.daysRemaining)
                        .map((item) => (
                          <TableRow key={item.id} className={item.daysRemaining <= 7 && item.daysRemaining < 999 ? "bg-destructive/5" : ""}>
                            <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                            <TableCell className="font-medium">{item.name}</TableCell>
                            <TableCell className="text-right">{item.stock_current}</TableCell>
                            <TableCell className="text-right">{item.totalSales30d}</TableCell>
                            <TableCell className="text-right">{item.avgDailySales.toFixed(1)}</TableCell>
                            <TableCell className="text-right">
                              {item.daysRemaining === 999 ? "∞" : `${item.daysRemaining}d`}
                            </TableCell>
                            <TableCell className="text-center">
                              {item.daysRemaining <= 7 && item.daysRemaining < 999 ? (
                                <Badge variant="destructive">Crítico</Badge>
                              ) : item.daysRemaining <= 14 ? (
                                <Badge variant="outline" className="border-amber-500 text-amber-600">Alerta</Badge>
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
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Index;
